import { Pool } from 'pg';
import { PostgresDialect } from 'kysely';
import { verifyPassword } from 'better-auth/crypto';
import { createAttendAuth } from '../lib/auth/core.ts';

let pool;
let gate;
let newlyCreatedId;

try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 16000) throw new Error('Invalid account input.');
  }
  const data = JSON.parse(Buffer.from(input.trim(),'base64').toString('utf8'));
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const password = data.password;
  const role = data.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
      || !name || name.length > 100 || typeof password !== 'string'
      || password.length < 12 || password.length > 128
      || !['admin','teacher','student'].includes(role)) throw new Error('Invalid account input.');
  const ownerAddress = new URL(process.env.DATABASE_URL ?? '');
  if (decodeURIComponent(ownerAddress.username) === 'attendai_app') throw new Error('Owner connection required.');
  ownerAddress.searchParams.set('sslmode','verify-full');
  pool = new Pool({connectionString:ownerAddress.toString(),max:3,connectionTimeoutMillis:15000});
  gate = await pool.connect();
  await gate.query('BEGIN');
  // Transaction-scoped lock works with Neon's transaction pooler.
  await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',['attendai:create:'+email]);
  const version = await gate.query("SELECT version FROM attendai.schema_migrations WHERE version = '002'");
  if (!version.rowCount) throw new Error('Migration 002 is missing.');
  const {rows:existingProfiles} = await gate.query(
    'SELECT role FROM attendai.app_users WHERE lower(btrim(email)) = $1',[email],
  );
  if (existingProfiles.length) throw new Error('This email already has an application profile. No account or role was changed.');

  const auth = createAttendAuth({
    database:{dialect:new PostgresDialect({pool}),type:'postgres',schemaName:'attendai_auth'},
    baseURL:process.env.BETTER_AUTH_URL ?? '',secret:process.env.BETTER_AUTH_SECRET ?? '',
    bootstrap:true,
  });
  const {rows:existingUsers} = await gate.query('SELECT id FROM attendai_auth.users WHERE email = $1',[email]);
  let authUserId;
  if (existingUsers.length) {
    // Recover a previous interrupted provisioning attempt only after the
    // supplied password proves access to its existing credential account.
    const {rows:credentials} = await gate.query(
      'SELECT password FROM attendai_auth.accounts WHERE "userId" = $1 AND "providerId" = $2',
      [existingUsers[0].id,'credential'],
    );
    if (!credentials[0]?.password || !await verifyPassword({hash:credentials[0].password,password})) {
      throw new Error('Existing authentication account could not be verified.');
    }
    authUserId = existingUsers[0].id;
  } else {
    const created = await auth.api.signUpEmail({body:{email,password,name}});
    authUserId = created.user.id;
    newlyCreatedId = authUserId;
  }
  await gate.query(
    `INSERT INTO attendai.app_users (auth_provider, auth_subject, display_name, email, role)
     VALUES ($1,$2,$3,$4,$5)`,['better-auth',authUserId,name,email,role],
  );
  await gate.query('COMMIT');
  newlyCreatedId = undefined;
  console.log(`Created ${role} account. Sign in using the email and password you entered.`);
} catch (error) {
  await gate?.query('ROLLBACK').catch(()=>{});
  if (newlyCreatedId && pool) {
    await pool.query(
      `DELETE FROM attendai_auth.users WHERE id = $1 AND NOT EXISTS
       (SELECT 1 FROM attendai.app_users WHERE auth_provider = 'better-auth' AND auth_subject = $1)`,
      [newlyCreatedId],
    ).catch(()=>console.error('Incomplete account cleanup requires owner review.'));
  }
  const safe = [
    'Invalid account input.', 'Owner connection required.', 'Migration 002 is missing.',
    'This email already has an application profile. No account or role was changed.',
    'Existing authentication account could not be verified.',
  ];
  console.error(safe.includes(error.message) ? error.message : 'Account creation failed. Verify authentication setup and try again.');
  process.exitCode = 1;
} finally {
  gate?.release();
  await pool?.end();
}
