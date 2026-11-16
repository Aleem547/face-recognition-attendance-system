// Trusted, one-time owner operation. Never run with owner credentials on Render.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';

export function registrationAddresses(env){
  let owner,app;
  try{owner=new URL(env.DATABASE_URL);app=new URL(env.APP_DATABASE_URL);}catch{throw Error('A private owner DATABASE_URL and restricted APP_DATABASE_URL are required.');}
  for(const address of [owner,app]){
    if(!['postgres:','postgresql:'].includes(address.protocol)||!address.hostname||address.pathname==='/')throw Error('Invalid database configuration.');
    address.searchParams.set('sslmode','verify-full');
  }
  if(decodeURIComponent(owner.username)==='attendai_app'||decodeURIComponent(app.username)!=='attendai_app')throw Error('Use an owner connection for the migration and attendai_app for the runtime connection.');
  const databaseKey=address=>[address.hostname.replace(/-pooler(?=\.)/,''),address.port||'5432',decodeURIComponent(address.pathname)].join('|');
  if(databaseKey(owner)!==databaseKey(app))throw Error('Owner and application settings must identify the same database.');
  return {owner:owner.toString(),app:app.toString()};
}

export async function applyStudentRegistration(client){
  const {rows}=await client.query(`SELECT EXISTS(SELECT 1 FROM attendai.schema_migrations WHERE version='010') AS applied,
    to_regclass('attendai.student_registrations') IS NOT NULL AS table_ready,
    to_regprocedure('attendai.register_student_account(text,text)') IS NOT NULL AS register_ready,
    to_regprocedure('attendai.student_registration_status(text)') IS NOT NULL AS status_ready,
    to_regprocedure('attendai.review_student_registration(uuid,text,uuid)') IS NOT NULL AS review_ready`);
  if(rows[0].applied){
    if(!['table_ready','register_ready','status_ready','review_ready'].every(key=>rows[0][key]))throw Error('Migration 010 is incomplete. Preserve the database and review its schema.');
    return 'already_applied';
  }
  if(rows[0].table_ready||rows[0].register_ready||rows[0].status_ready||rows[0].review_ready)throw Error('Unrecorded registration objects exist. Preserve the database and review its schema.');
  const sql=await readFile(new URL('../db/migrations/010_student_registration.sql',import.meta.url),'utf8');
  try{await client.query(sql);}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  return 'applied';
}

export async function runStudentRegistrationMigration(env){
  const addresses=registrationAddresses(env);
  const owner=new Pool({connectionString:addresses.owner,max:1,connectionTimeoutMillis:15000});
  const app=new Pool({connectionString:addresses.app,max:1,connectionTimeoutMillis:15000});
  owner.on('error',()=>{});app.on('error',()=>{});
  let client;
  try{
    // Check the runtime identity before making any owner schema changes.
    const identity=(await app.query('SELECT current_user AS role')).rows[0];
    if(identity.role!=='attendai_app')throw Error('The runtime database identity is not attendai_app.');
    client=await owner.connect();
    const role=(await client.query('SELECT current_user AS role')).rows[0];
    if(role.role==='attendai_app')throw Error('A database owner connection is required.');
    const status=await applyStudentRegistration(client);
    const ready=(await app.query(`SELECT has_function_privilege(current_user,'attendai.register_student_account(text,text)','EXECUTE') AS register_ready,
      has_function_privilege(current_user,'attendai.review_student_registration(uuid,text,uuid)','EXECUTE') AS review_ready,
      has_table_privilege(current_user,'attendai.app_users','INSERT') AS profile_insert,
      has_table_privilege(current_user,'attendai.app_users','UPDATE') AS profile_update`)).rows[0];
    if(!ready.register_ready||!ready.review_ready||ready.profile_insert||ready.profile_update)throw Error('Review the restricted runtime privileges before deployment.');
    return status;
  }finally{client?.release();await Promise.all([owner.end(),app.end()]);}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==2)throw Error('Run this helper without extra arguments.');
    const status=await runStudentRegistrationMigration(process.env);
    console.log('Student registration migration 010: '+status+'. Runtime privileges verified.');
  }catch{
    console.error('Student registration setup did not complete. Check the private owner/runtime settings and migration state in your database provider. Credentials were not printed. Do not reset the database or add an owner URL to Render.');
    process.exitCode=1;
  }
}
