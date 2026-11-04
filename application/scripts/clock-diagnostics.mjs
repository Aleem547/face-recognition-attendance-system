// Read-only metadata: never calls the clock, creates marks, or runs migrations.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {clockFailure} from '../lib/automation/failure.ts';
const clean=value=>value.replace(/\r\n/g,'\n').trim();
export function runtimeAddress(value){
 try{
  const address=new URL(value??'');
  if(!['postgres:','postgresql:'].includes(address.protocol)||decodeURIComponent(address.username)!=='attendai_app')throw Error();
  address.searchParams.set('sslmode','verify-full');return address.toString();
 }catch{throw Object.assign(Error('Invalid database configuration.'),{code:'FRAS_BAD_DATABASE_URL'});}
}
export async function diagnoseClock(pool){
 const report={status:'failed',databaseConnection:'not_checked',restrictedRole:false,safeRole:false,schemaPresent:false,clockTablePresent:false,clockFunctionPresent:false,clockExecutable:false,securityDefiner:false,sourceMatches:false,definerCanWriteHeartbeat:false,issues:[],clockExecuted:false,attendanceChanges:'none'};
 let db;
 try{
  db=await pool.connect();report.databaseConnection='passed';
  await db.query('BEGIN READ ONLY');await db.query("SET LOCAL statement_timeout='5s'");await db.query("SET LOCAL lock_timeout='2s'");
  const role=(await db.query('SELECT current_user AS name,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication FROM pg_roles WHERE rolname=current_user')).rows[0];
  report.restrictedRole=role?.name==='attendai_app';report.safeRole=Boolean(role)&&!['rolsuper','rolbypassrls','rolcreaterole','rolcreatedb','rolreplication'].some(k=>role[k]);
  if(!report.restrictedRole||!report.safeRole){report.issues.push('unexpected_runtime_role');return report;}
  const objects=(await db.query("SELECT to_regnamespace('attendai') IS NOT NULL AS schema_present,to_regclass('attendai.class_clock_state') IS NOT NULL AS clock_table")).rows[0];
  report.schemaPresent=objects.schema_present;report.clockTablePresent=objects.clock_table;
  if(!report.schemaPresent||!report.clockTablePresent){report.issues.push('missing_migration_009_objects');return report;}
  const fn=(await db.query(`SELECT p.prosecdef,p.prosrc,has_function_privilege(current_user,p.oid,'EXECUTE') AS executable,
   (has_table_privilege(p.proowner,'attendai.class_clock_state','SELECT') AND has_table_privilege(p.proowner,'attendai.class_clock_state','INSERT') AND has_table_privilege(p.proowner,'attendai.class_clock_state','UPDATE')) AS heartbeat_write
   FROM pg_proc p WHERE p.oid=to_regprocedure('attendai.tick_session_automation()')`)).rows[0];
  report.clockFunctionPresent=Boolean(fn);report.clockExecutable=fn?.executable===true;report.securityDefiner=fn?.prosecdef===true;report.definerCanWriteHeartbeat=fn?.heartbeat_write===true;
  const migration=await readFile(new URL('../db/migrations/009_class_automation.sql',import.meta.url),'utf8');
  const body=migration.match(/CREATE FUNCTION attendai\.tick_session_automation\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/)?.[1];
  report.sourceMatches=Boolean(body&&fn&&clean(body)===clean(fn.prosrc));
  if(!report.clockFunctionPresent)report.issues.push('missing_clock_function');
  if(!report.clockExecutable)report.issues.push('clock_execute_grant_missing');
  if(!report.securityDefiner)report.issues.push('unexpected_clock_security');
  if(!report.sourceMatches)report.issues.push('clock_function_differs_from_source');
  if(!report.definerCanWriteHeartbeat)report.issues.push('clock_definer_permissions_missing');
  report.status=report.issues.length?'failed':'read_only_preflight_passed';
 }catch(error){report.failure=clockFailure(error);report.issues.push('database_check_failed');}
 finally{if(db){try{await db.query('ROLLBACK');}catch{}db.release();}}
 return report;
}
export async function clockReport(env=process.env){
 let pool;
 try{pool=new Pool({connectionString:runtimeAddress(env.APP_DATABASE_URL),max:1,connectionTimeoutMillis:15000});pool.on('error',()=>{});return await diagnoseClock(pool);}
 catch(error){return {status:'failed',failure:clockFailure(error),clockExecuted:false,attendanceChanges:'none'};}
 finally{if(pool)await pool.end().catch(()=>{});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--output'))throw Error('Use optional --output NEW_REPORT.json.');
  const report={schema:'fras-clock-diagnostic-v1',checkedAt:new Date().toISOString(),...await clockReport()};
  if(args.length)await writeFile(resolve(args[1]),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify(report,null,2));
  if(report.status!=='read_only_preflight_passed')process.exitCode=1;
 }catch{console.error('The diagnostic could not save its report. Choose a new private output path.');process.exitCode=1;}
}
