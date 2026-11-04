// Owner migration runner. Never reads, rewrites or prints biometric key values.
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
let owner,runtime;
try{
 const pkg=JSON.parse(await readFile('package.json','utf8'));
 if(pkg.name!=='face-recognition-attendance-system'||pkg.version!=='0.6.0')throw new Error();
 const address=value=>{const u=new URL(value??'');if(!['postgres:','postgresql:'].includes(u.protocol))throw new Error();u.searchParams.set('sslmode','verify-full');return u;};
 const a=address(process.env.DATABASE_URL),b=address(process.env.APP_DATABASE_URL);
 if(decodeURIComponent(a.username)==='attendai_app'||decodeURIComponent(b.username)!=='attendai_app'||a.hostname!==b.hostname||a.pathname!==b.pathname)throw new Error();
 owner=new Pool({connectionString:a.toString(),max:1,connectionTimeoutMillis:15000});
 if(!(await owner.query("SELECT version FROM attendai.schema_migrations WHERE version='006'")).rowCount)throw new Error('Apply comparison migration 006 first.');
 if(!(await owner.query("SELECT version FROM attendai.schema_migrations WHERE version='007'")).rowCount){
  await owner.query((await readFile('db/migrations/007_session_research.sql','utf8')).replace(/^\uFEFF/,''));
  console.log('Migration 007 applied.');
 }else console.log('Migration 007 already recorded; it was not rerun.');
 runtime=new Pool({connectionString:b.toString(),max:1,connectionTimeoutMillis:15000});
 const p=(await runtime.query(`SELECT current_user AS name,
 has_column_privilege(current_user,'attendai.verification_attempts','session_id','INSERT') AS bind,
 has_column_privilege(current_user,'attendai.verification_attempts','session_id','UPDATE') AS rewrite,
 has_column_privilege(current_user,'attendai.verification_events','session_id','INSERT') AS forge_receipt,
 has_column_privilege(current_user,'attendai.verification_trials','session_id','INSERT') AS forge_trial,
 has_column_privilege(current_user,'attendai.biometric_templates','ciphertext','SELECT') AS decrypt,
 has_function_privilege(current_user,'attendai.assert_session_research(uuid,uuid)','EXECUTE') AS bypass`)).rows[0];
 if(p.name!=='attendai_app'||!p.bind||p.rewrite||p.forge_receipt||p.forge_trial||p.decrypt||p.bypass)throw new Error('Unexpected session research runtime permissions.');
 console.log('SESSION RESEARCH DATABASE CHECK PASSED.');
 console.log('No attendance, consent, key, template or environment setting was changed.');
}catch(error){
 const safe=['Apply comparison migration 006 first.','Unexpected session research runtime permissions.'];
 console.error(safe.includes(error.message)?error.message:'Session research configuration failed. Check local database configuration and migration prerequisites.');
 if(/^[A-Z0-9]{5}$/.test(error.code??''))console.error('Database error code:',error.code);
 process.exitCode=1;
}finally{await runtime?.end();await owner?.end();}
