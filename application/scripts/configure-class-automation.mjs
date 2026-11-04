// Owner-only additive setup. Never starts the class clock, creates marks,
// changes keys or opts a class into automation.
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
let owner,runtime,applied=false;
try{
 const pkg=JSON.parse((await readFile('package.json','utf8')).replace(/^\uFEFF/,''));
 if(pkg.name!=='face-recognition-attendance-system'||pkg.version!=='0.6.0')throw Error('Wrong project.');
 const address=value=>{const u=new URL(value??'');if(!['postgres:','postgresql:'].includes(u.protocol))throw Error('Invalid database configuration.');u.searchParams.set('sslmode','verify-full');return u;};
 const a=address(process.env.DATABASE_URL),b=address(process.env.APP_DATABASE_URL);
 if(decodeURIComponent(a.username)==='attendai_app'||decodeURIComponent(b.username)!=='attendai_app'||a.hostname!==b.hostname||a.port!==b.port||a.pathname!==b.pathname)throw Error('Use matching owner and restricted runtime database settings.');
 owner=new Pool({connectionString:a.toString(),max:1,connectionTimeoutMillis:15000});runtime=new Pool({connectionString:b.toString(),max:1,connectionTimeoutMillis:15000});
 const role=(await runtime.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
 if(role?.name!=='attendai_app'||role.rolsuper||role.rolbypassrls)throw Error('Unexpected runtime database role.');
 if(!(await owner.query("SELECT version FROM attendai.schema_migrations WHERE version='008'")).rowCount)throw Error('Apply migration 008 first.');
 if(!(await owner.query("SELECT version FROM attendai.schema_migrations WHERE version='009'")).rowCount){
  await owner.query((await readFile('db/migrations/009_class_automation.sql','utf8')).replace(/^\uFEFF/,''));applied=true;console.log('Migration 009 applied. Existing attendance and encrypted templates were preserved.');
 }else console.log('Migration 009 already recorded; it was not rerun.');
 const p=(await runtime.query(`SELECT has_function_privilege(current_user,'attendai.tick_session_automation()','EXECUTE') AS clock,
  has_function_privilege(current_user,'attendai.configure_session_automation(uuid,integer,boolean,text)','EXECUTE') AS configure,
  has_table_privilege(current_user,'attendai.session_automation','UPDATE') AS forge_settings,
  has_table_privilege(current_user,'attendai.session_automation_roster','INSERT') AS forge_roster,
  has_table_privilege(current_user,'attendai.session_automation_events','INSERT') AS forge_events,
  has_table_privilege(current_user,'attendai.class_clock_state','UPDATE') AS forge_clock,
  has_column_privilege(current_user,'attendai.attendance_records','method','INSERT') AS forge_method`)).rows[0];
 if(!p.clock||!p.configure||p.forge_settings||p.forge_roster||p.forge_events||p.forge_clock||p.forge_method)throw Error('Unexpected class automation runtime permissions.');
 console.log('CLASS AUTOMATION DATABASE SETUP PASSED.');
 console.log('Restart Face Recognition Attendance System. Its Node server runs the class clock. Enable automatic timing per scheduled test class before its start.');
}catch(error){
 const safe=['Wrong project.','Invalid database configuration.','Use matching owner and restricted runtime database settings.','Unexpected runtime database role.','Apply migration 008 first.','Unexpected class automation runtime permissions.'];
 console.error(safe.includes(error.message)?error.message:'Class automation setup could not be confirmed. Check local configuration and migration prerequisites.');
 if(applied)console.error('Migration 009 was applied; the following permissions check failed. Preserve the state for review; do not drop tables.');
 if(/^[A-Z0-9]{5}$/.test(error.code??''))console.error('Database error code:',error.code);process.exitCode=1;
}finally{await runtime?.end();await owner?.end();}
