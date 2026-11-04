// Runs against an isolated, in-memory PostgreSQL engine. No .env or Neon access.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { PostgresDialect } from 'kysely';
import { getMigrations } from 'better-auth/db/migration';
import { createAttendAuth } from '../lib/auth/core.ts';
import { resolveIdentity, permissionStatus } from '../lib/auth/identity.ts';
import { createTestDatabase } from './pglite-pool.mjs';

let checked = 0;
async function check(name, callback) {
  await callback();
  checked++;
  console.log(`PASS ${checked}: ${name}`);
}
const {db,pool} = await createTestDatabase();
const origin = 'http://localhost:3000';
const secret = randomBytes(48).toString('base64url');
const password = 'Synthetic-' + randomBytes(20).toString('hex');
const database = () => ({dialect:new PostgresDialect({pool}),type:'postgres',schemaName:'attendai_auth'});
const makeAuth = (bootstrap = false, baseURL = origin) => createAttendAuth({database:database(),baseURL,secret,bootstrap});
let auth;
const accounts = {};

async function http(path, {body,cookie,ip='192.0.2.50',baseURL=origin,requestOrigin=baseURL,instance=auth}={}) {
  const headers = new Headers({'Origin':requestOrigin,'X-Forwarded-For':ip});
  if (body) headers.set('Content-Type','application/json');
  if (cookie) headers.set('Cookie',cookie);
  return instance.handler(new Request(baseURL+'/api/auth'+path, {
    method:body ? 'POST' : 'GET',headers,body:body ? JSON.stringify(body) : undefined,
  }));
}
function cookies(response) {
  return response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
}
async function identity(cookie, instance = auth) {
  return resolveIdentity(new Headers(cookie ? {Cookie:cookie} : {}), {
    session:headers=>instance.api.getSession({headers}),
    profile:async id=>(await db.query(
      `SELECT id, display_name, email, role, is_active, auth_subject
       FROM attendai.app_users WHERE auth_provider = $1 AND auth_subject = $2`, ['better-auth',id],
    )).rows[0] ?? null,
  });
}
async function asOwner(callback) {
  await db.exec('RESET ROLE');
  try { return await callback(); } finally { await db.exec('SET ROLE attendai_app'); }
}

try {
  const migration = await readFile(new URL('../db/migrations/001_initial_schema.sql',import.meta.url),'utf8');
  const oldTests = await readFile(new URL('../db/tests/001_integrity.sql',import.meta.url),'utf8');
  await db.exec(migration);
  await check('existing 23 database integrity checks still pass',async()=>{
    const rows=(await db.exec(oldTests)).flatMap(result=>result.rows ?? []);
    assert.equal(rows.find(row=>row.result === 'PASS')?.checks_passed,23);
  });
  await check('migration 002 creates five auth tables',async()=>{
    const sql=await readFile(new URL('../db/migrations/002_authentication.sql',import.meta.url),'utf8');
    const rows=(await db.exec(sql)).flatMap(result=>result.rows ?? []);
    assert.equal(rows.find(row=>row.result === 'Schema 002 applied')?.auth_tables_created,5);
  });
  auth=makeAuth();
  await check('auth schema matches the pinned Better Auth configuration',async()=>{
    const plan=await getMigrations(auth.options);
    assert.deepEqual(plan.toBeCreated,[]);
    assert.deepEqual(plan.toBeAdded,[]);
    assert.deepEqual(plan.toBeAddedIndexes,[]);
    assert.deepEqual(plan.unsafeChanges,[]);
    assert.deepEqual(plan.schemaProblems,[]);
  });
  const bootstrap=makeAuth(true);
  await check('trusted provisioning creates three roles and an unprovisioned auth user',async()=>{
    for(const role of ['admin','teacher','student','orphan']) {
      const email=role+'@example.test';
      const response=await bootstrap.api.signUpEmail({body:{email,password,name:'Synthetic '+role}});
      accounts[role]={id:response.user.id,email};
      if(role !== 'orphan') await db.query(
        `INSERT INTO attendai.app_users (auth_provider,auth_subject,display_name,email,role)
         VALUES ($1,$2,$3,$4,$5)`, ['better-auth',response.user.id,'Synthetic '+role,email,role],
      );
    }
    assert.equal((await db.query('SELECT count(*)::int AS n FROM attendai_auth.users')).rows[0].n,4);
  });
  await db.exec('SET ROLE attendai_app');
  await check('runtime is an ordinary role with no role/database creation or RLS bypass',async()=>{
    const {rows:[role]}=await db.query(`SELECT current_user,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls
        FROM pg_roles WHERE rolname=current_user`);
    assert.equal(role.current_user,'attendai_app');
    for(const field of ['rolsuper','rolcreaterole','rolcreatedb','rolbypassrls']) assert.equal(role[field],false);
  });
  await check('runtime cannot change application roles',async()=>{
    await assert.rejects(db.query("UPDATE attendai.app_users SET role='admin' WHERE role='student'"),e=>e.code === '42501');
  });
  await check('runtime cannot create authentication tables',async()=>{
    await assert.rejects(db.exec('CREATE TABLE attendai_auth.forbidden_table(id integer)'),e=>e.code === '42501');
  });
  await check('runtime cannot read the attendance student roster yet',async()=>{
    await assert.rejects(db.query('SELECT * FROM attendai.students'),e=>e.code === '42501');
  });
  await check('runtime can read mapped application profiles through RLS',async()=>{
    assert.equal((await db.query('SELECT count(*)::int AS n FROM attendai.app_users')).rows[0].n,3);
  });
  await check('anonymous requests have no application access',async()=>{
    assert.equal(permissionStatus(await identity()),401);
  });
  await check('forged session cookies are rejected',async()=>{
    assert.equal(permissionStatus(await identity('attendai.session_token=forged.signature')),401);
  });
  await check('public signup, including a requested admin role, is rejected',async()=>{
    const result=await http('/sign-up/email',{body:{email:'intruder@example.test',password,name:'Intruder',role:'admin'}});
    assert.ok(result.status >= 400 && result.status < 500);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM attendai_auth.users')).rows[0].n,4);
  });
  await check('incorrect passwords do not produce a session cookie',async()=>{
    const result=await http('/sign-in/email',{body:{email:accounts.admin.email,password:'incorrect password'},ip:'192.0.2.51'});
    assert.equal(result.status,401);
    assert.ok(!cookies(result).includes('session_token='));
  });
  await check('all three roles can authenticate with valid credentials',async()=>{
    let n=60;
    for(const role of ['admin','teacher','student']) {
      const result=await http('/sign-in/email',{body:{email:accounts[role].email,password,rememberMe:false},ip:`192.0.2.${n++}`});
      assert.equal(result.status,200);
      accounts[role].cookie=cookies(result);
      assert.ok(accounts[role].cookie.includes('session_token='));
      assert.match(result.headers.getSetCookie().join(';'),/HttpOnly/i);
      assert.match(result.headers.getSetCookie().join(';'),/SameSite=Lax/i);
      const resolved=await identity(accounts[role].cookie);
      assert.equal(resolved.kind,'authenticated');
      assert.equal(resolved.account.role,role);
    }
  });
  await check('only admins receive admin permission',async()=>{
    assert.equal(permissionStatus(await identity(accounts.admin.cookie),['admin']),200);
    assert.equal(permissionStatus(await identity(accounts.teacher.cookie),['admin']),403);
    assert.equal(permissionStatus(await identity(accounts.student.cookie),['admin']),403);
  });
  await check('student accounts cannot obtain staff permission',async()=>{
    assert.equal(permissionStatus(await identity(accounts.student.cookie),['admin','teacher']),403);
    assert.equal(permissionStatus(await identity(accounts.teacher.cookie),['admin','teacher']),200);
  });
  await check('client role fields cannot promote a student',async()=>{
    await http('/update-user',{body:{role:'admin',name:'Synthetic Student'},cookie:accounts.student.cookie,ip:'192.0.2.70'});
    assert.equal((await identity(accounts.student.cookie)).account.role,'student');
  });
  await check('untrusted origins cannot sign out an authenticated user',async()=>{
    const result=await http('/sign-out',{body:{},cookie:accounts.admin.cookie,requestOrigin:'https://untrusted.example',ip:'192.0.2.71'});
    assert.equal(result.status,403);
    assert.equal((await identity(accounts.admin.cookie)).kind,'authenticated');
  });
  await check('sessions remain valid across auth instance recreation',async()=>{
    assert.equal((await identity(accounts.admin.cookie,makeAuth())).account.role,'admin');
  });
  await check('inactive profiles are denied even with a valid session',async()=>{
    await asOwner(()=>db.query('UPDATE attendai.app_users SET is_active=false WHERE auth_subject=$1',[accounts.student.id]));
    assert.equal(permissionStatus(await identity(accounts.student.cookie)),403);
    await asOwner(()=>db.query('UPDATE attendai.app_users SET is_active=true WHERE auth_subject=$1',[accounts.student.id]));
  });
  await check('authentication users without an application profile are denied',async()=>{
    const result=await http('/sign-in/email',{body:{email:accounts.orphan.email,password},ip:'192.0.2.72'});
    assert.equal(result.status,200);
    assert.equal(permissionStatus(await identity(cookies(result))),403);
  });
  await check('expired database sessions are rejected',async()=>{
    await db.query('UPDATE attendai_auth.sessions SET "expiresAt"=current_timestamp - interval \'1 second\' WHERE "userId"=$1',[accounts.teacher.id]);
    assert.equal(permissionStatus(await identity(accounts.teacher.cookie)),401);
  });
  await check('logout invalidates replay of the previous session cookie',async()=>{
    const result=await http('/sign-out',{body:{},cookie:accounts.admin.cookie,ip:'192.0.2.73'});
    assert.equal(result.status,200);
    assert.equal(permissionStatus(await identity(accounts.admin.cookie)),401);
  });
  await check('failed login attempts are limited in database storage',async()=>{
    for(let attempt=0;attempt<5;attempt++) {
      const result=await http('/sign-in/email',{body:{email:accounts.admin.email,password:'wrong-password'},ip:'198.51.100.99'});
      assert.equal(result.status,401);
    }
    const result=await http('/sign-in/email',{body:{email:accounts.admin.email,password:'wrong-password'},ip:'198.51.100.99'});
    assert.equal(result.status,429);
    assert.ok((await db.query('SELECT count(*)::int AS n FROM attendai_auth.rate_limits')).rows[0].n>0);
  });
  await check('HTTPS configuration sets Secure and HttpOnly session cookies',async()=>{
    const result=await http('/sign-in/email',{
      body:{email:accounts.admin.email,password},baseURL:'https://attendai.example',
      instance:makeAuth(false,'https://attendai.example'),ip:'192.0.2.74',
    });
    assert.equal(result.status,200);
    const values=result.headers.getSetCookie().join(';');
    assert.match(values,/; Secure/i);
    assert.match(values,/HttpOnly/i);
  });
  await check('non-local HTTP auth origins are refused',async()=>{
    assert.throws(()=>makeAuth(false,'http://attendai.example'),/HTTPS/);
  });
  console.log(`Authentication checks passed: ${checked}. Existing database checks passed: 23.`);
} catch(error) {
  console.error('TEST FAILED:',error.message);
  process.exitCode=1;
} finally {
  await db.close();
}
