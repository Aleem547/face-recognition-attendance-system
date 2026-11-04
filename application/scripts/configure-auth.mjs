import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';

const file = resolve('.env.local');
const temporary = resolve('.env.local.attendai-tmp');
let owner;
let runtime;

function databaseAddress(value) {
  const parsed = new URL(value ?? '');
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('Invalid database URL.');
  parsed.searchParams.set('sslmode', 'verify-full');
  return parsed;
}

try {
  const original = await readFile(file, 'utf8');
  const ownerAddress = databaseAddress(process.env.DATABASE_URL);
  if (decodeURIComponent(ownerAddress.username) === 'attendai_app') {
    throw new Error('DATABASE_URL must remain the owner connection used for setup.');
  }
  owner = new Pool({ connectionString: ownerAddress.toString(), max: 1, connectionTimeoutMillis: 15000 });
  const applied = await owner.query("SELECT version FROM attendai.schema_migrations WHERE version = '002'");
  if (!applied.rowCount) throw new Error('Apply migration 002 in the development branch first.');

  let appAddress;
  if (process.env.APP_DATABASE_URL) {
    appAddress = databaseAddress(process.env.APP_DATABASE_URL);
    if (decodeURIComponent(appAddress.username) !== 'attendai_app'
        || appAddress.hostname !== ownerAddress.hostname || appAddress.pathname !== ownerAddress.pathname) {
      throw new Error('Existing APP_DATABASE_URL does not match this database and runtime role.');
    }
  } else {
    const password = randomBytes(32).toString('hex');
    // The password is generated hex, never caller-supplied SQL. PostgreSQL
    // utility statements do not accept a query parameter for this position.
    if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Password generation failed.');
    await owner.query(`ALTER ROLE attendai_app WITH LOGIN PASSWORD '${password}'`);
    appAddress = new URL(ownerAddress);
    appAddress.username = 'attendai_app';
    appAddress.password = password;
  }

  const baseURL = process.env.BETTER_AUTH_URL || 'http://localhost:3000';
  const origin = new URL(baseURL);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/'
      || !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) {
    throw new Error('BETTER_AUTH_URL must be an HTTPS origin or HTTP localhost.');
  }
  const secret = process.env.BETTER_AUTH_SECRET || randomBytes(48).toString('base64url');
  if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error('Existing auth secret is too short.');

  // Persist the new credential before the second connection is attempted, so a
  // temporary network failure can be retried without changing its password.
  const settings = new Map([
    ['APP_DATABASE_URL', appAddress.toString()],
    ['BETTER_AUTH_SECRET', secret],
    ['BETTER_AUTH_URL', origin.origin],
  ]);
  const lines = original.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => {
    const key = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/)?.[1];
    return !settings.has(key);
  });
  while (lines.length && lines.at(-1) === '') lines.pop();
  for (const [key, value] of settings) lines.push(`${key}=${JSON.stringify(value)}`);
  await writeFile(temporary, lines.join('\n')+'\n', {mode:0o600});
  await rename(temporary, file);

  runtime = new Pool({ connectionString: appAddress.toString(), max:1, connectionTimeoutMillis:15000 });
  const {rows:[role]} = await runtime.query(`
    SELECT current_user AS name, r.rolsuper, r.rolcreaterole, r.rolcreatedb,
           r.rolreplication, r.rolbypassrls,
           EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS has_memberships,
           has_schema_privilege(current_user, 'attendai_auth', 'CREATE') AS can_create_auth,
           has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public,
           has_table_privilege(current_user, 'attendai.app_users', 'UPDATE') AS can_change_roles
    FROM pg_roles r WHERE r.rolname = current_user
  `);
  if (role.name !== 'attendai_app' || Object.entries(role).some(([key,value]) => key !== 'name' && value)) {
    throw new Error('Runtime role has unexpected privileges.');
  }
  await runtime.query('SELECT id FROM attendai_auth.users LIMIT 1');
  await runtime.query('SELECT id FROM attendai.app_users LIMIT 1');
  console.log('Authentication configuration saved.');
  console.log('Runtime connection: attendai_app; restricted privileges verified.');
  console.log('Next: create your administrator account.');
} catch (error) {
  // Do not print query objects, connection URLs, environment contents, or stacks.
  const safe = [
    'Invalid database URL.',
    'DATABASE_URL must remain the owner connection used for setup.',
    'Apply migration 002 in the development branch first.',
    'Existing APP_DATABASE_URL does not match this database and runtime role.',
    'BETTER_AUTH_URL must be an HTTPS origin or HTTP localhost.',
    'Existing auth secret is too short.',
    'Runtime role has unexpected privileges.',
  ];
  console.error(safe.includes(error.message) ? error.message : 'Authentication configuration failed. Check migration 002 and the owner connection, then retry.');
  if (/^[A-Z0-9]{5}$/.test(error.code ?? '')) console.error('Database error code:',error.code);
  process.exitCode = 1;
} finally {
  await runtime?.end();
  await owner?.end();
  await unlink(temporary).catch(()=>{});
}
