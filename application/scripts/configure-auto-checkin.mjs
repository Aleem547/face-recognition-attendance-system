// Explicit owner-only additive migration. No keys, accounts, attendance marks,
// threshold policies or choices are created or altered by this command.
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
let owner,runtime,applied=false;
try{
 const pkg=JSON.parse((await readFile('package.json','utf8')).replace(/^\uFEFF/,''));
 if(pkg.name!=='face-recognition-attendance-system'||pkg.version!=='0.6.0')throw new Error('Wrong project.');
 const address=value=>{const u=new URL(value??'');if(!['postgres:','postgresql:'].includes(u.protocol))throw new Error('Invalid database configuration.');u.searchParams.set('sslmode','verify-full');return u;};
 const a=address(process.env.DATABASE_URL),b=address(process.env.APP_DATABASE_URL);
 if(decodeURIComponent(a.username)==='attendai_app'||decodeURIComponent(b.username)!=='attendai_app'||a.hostname!==b.hostname||a.port!==b.port||a.pathname!==b.pathname)throw new Error('Use the matching owner and restricted runtime database configuration.');
 owner=new Pool({connectionString:a.toString(),max:1,connectionTimeoutMillis:15000});
 runtime=new Pool({connectionString:b.toString(),max:1,connectionTimeoutMillis:15000});
 const identity=(await runtime.query("SELECT current_user AS name,r.rolsuper,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user")).rows[0];
 if(identity?.name!=='attendai_app'||identity.rolsuper||identity.rolbypassrls)throw new Error('Unexpected runtime database role.');
 if(!(await owner.query("SELECT version FROM attendai.schema_migrations WHERE version='007'")).rowCount)throw new Error('Apply migration 007 first.');
 if(!(await owner.query("SELECT version FROM attendai.schema_migrations WHERE version='008'")).rowCount){
  await owner.query((await readFile('db/migrations/008_automatic_checkin.sql','utf8')).replace(/^\uFEFF/,''));applied=true;
  console.log('Migration 008 applied. Existing marks and keys were preserved. No session was enabled.');
 }else console.log('Migration 008 already recorded; it was not rerun.');
 const p=(await runtime.query(`SELECT
  has_function_privilege(current_user,'attendai.finish_face_checkin(text,double precision,double precision,double precision,text)','EXECUTE') AS commit,
  has_function_privilege(current_user,'attendai.face_checkin_context(uuid,uuid,integer,integer,uuid)','EXECUTE') AS bypass,
  has_table_privilege(current_user,'attendai.face_checkin_receipts','INSERT') AS forge_receipt,
  has_table_privilege(current_user,'attendai.face_checkin_policies','UPDATE') AS forge_policy,
  has_column_privilege(current_user,'attendai.attendance_records','method','INSERT') AS forge_method,
  has_column_privilege(current_user,'attendai.biometric_templates','ciphertext','SELECT') AS raw_reference`)).rows[0];
 if(!p.commit||p.bypass||p.forge_receipt||p.forge_policy||p.forge_method||p.raw_reference)throw new Error('Unexpected automatic check-in runtime permissions.');
 console.log('AUTOMATIC CHECK-IN DATABASE SETUP PASSED.');
 console.log('Staff must select a session test policy; students must grant the separate check-in choice. Biometric reliability remains unverified.');
}catch(error){
 const safe=['Wrong project.','Invalid database configuration.','Use the matching owner and restricted runtime database configuration.',
  'Unexpected runtime database role.','Apply migration 007 first.','Unexpected automatic check-in runtime permissions.'];
 console.error(safe.includes(error.message)?error.message:'Automatic check-in setup could not be confirmed. Check the local configuration and migration prerequisites.');
 if(applied)console.error('Migration 008 was applied; the subsequent runtime check failed. Preserve this state for review; do not drop tables.');
 if(/^[A-Z0-9]{5}$/.test(error.code??''))console.error('Database error code:',error.code);
 process.exitCode=1;
}finally{await runtime?.end();await owner?.end();}
