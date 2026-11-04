// Trusted local setup; never creates, replaces or prints an encryption key.
import {readFile,writeFile,rename,unlink,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {Pool} from 'pg';
const file=resolve('.env.local'),temporary=resolve('.env.local.verification-'+randomBytes(8).toString('hex'));
let owner,runtime,created=false;
function address(value){const url=new URL(value??'');if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error();url.searchParams.set('sslmode','verify-full');return url;}
try{
 const pkg=JSON.parse(await readFile('package.json','utf8'));if(pkg.name!=='face-recognition-attendance-system'||pkg.version!=='0.6.0')throw new Error();
 const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw new Error();
 const original=await readFile(file,'utf8'),ownerAddress=address(process.env.DATABASE_URL),appAddress=address(process.env.APP_DATABASE_URL);
 if(decodeURIComponent(ownerAddress.username)==='attendai_app'||decodeURIComponent(appAddress.username)!=='attendai_app'||ownerAddress.hostname!==appAddress.hostname||ownerAddress.pathname!==appAddress.pathname)throw new Error();
 for(const name of ['ATTENDAI_BIOMETRIC_KEY','ATTENDAI_BIOMETRICS_ENABLED','ATTENDAI_VERIFICATION_TRIAL_ENABLED'])if(original.split(/\r?\n/).filter(line=>new RegExp('^\\s*(?:export\\s+)?'+name+'\\s*=').test(line)).length>1)throw new Error('Duplicate biometric or comparison setting.');
 const value=process.env.ATTENDAI_BIOMETRIC_KEY;
 if(process.env.ATTENDAI_BIOMETRICS_ENABLED!=='true'||!value||!/^[A-Za-z0-9+/]{43}=$/.test(value)||Buffer.from(value,'base64').length!==32||Buffer.from(value,'base64').toString('base64')!==value)throw new Error('The original biometric key and enabled enrollment are required. Do not regenerate the key.');
 const bytes=Buffer.from(value,'base64'),keyId=createHash('sha256').update(bytes).digest('hex').slice(0,16);bytes.fill(0);
 owner=new Pool({connectionString:ownerAddress.toString(),max:1,connectionTimeoutMillis:15000});
 if(!(await owner.query("SELECT version FROM attendai.schema_migrations WHERE version='005'")).rowCount)throw new Error('Migration 005 is required.');
 const keys=await owner.query('SELECT DISTINCT key_id FROM attendai.biometric_templates');
 if(keys.rows.some(row=>row.key_id!==keyId))throw new Error('Stored templates use another encryption key. Restore the original server key.');
 if(!(await owner.query("SELECT version FROM attendai.schema_migrations WHERE version='006'")).rowCount){
  await owner.query((await readFile('db/migrations/006_controlled_verification.sql','utf8')).replace(/^\uFEFF/,''));console.log('Migration 006 applied.');
 }else console.log('Migration 006 already recorded.');
 runtime=new Pool({connectionString:appAddress.toString(),max:1,connectionTimeoutMillis:15000});
 const permissions=(await runtime.query(`SELECT current_user AS name,
  has_column_privilege(current_user,'attendai.biometric_templates','ciphertext','SELECT') AS ciphertext_read,
  has_column_privilege(current_user,'attendai.biometric_templates','iv','SELECT') AS iv_read,
  has_table_privilege(current_user,'attendai.verification_events','INSERT') AS event_write,
  has_table_privilege(current_user,'attendai.verification_trials','UPDATE') AS result_update,
  has_function_privilege(current_user,'attendai.verification_reference(text)','EXECUTE') AS gated_reference`)).rows[0];
 if(permissions.name!=='attendai_app'||permissions.ciphertext_read||permissions.iv_read||permissions.event_write||permissions.result_update||!permissions.gated_reference)throw new Error('Unexpected comparison runtime permissions.');
 const without=await runtime.query('SELECT * FROM attendai.verification_reference($1)',['0'.repeat(64)]);
 if(without.rowCount)throw new Error('Unexpected comparison runtime permissions.');
 const lines=original.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>!/^\s*(?:export\s+)?ATTENDAI_VERIFICATION_TRIAL_ENABLED\s*=/.test(line));
 while(lines.at(-1)==='')lines.pop();lines.push('ATTENDAI_VERIFICATION_TRIAL_ENABLED=true','');
 await writeFile(temporary,lines.join('\n'),{mode:0o600,flag:'wx'});created=true;await rename(temporary,file);created=false;
 console.log('Controlled comparison configured. Existing encryption key preserved.');
 console.log('No consent was granted. No attendance was changed.');
 console.log('Next: restart Face Recognition Attendance System and open /verification as your linked student account.');
}catch(error){
 const safe=['Duplicate biometric or comparison setting.','The original biometric key and enabled enrollment are required. Do not regenerate the key.','Migration 005 is required.','Stored templates use another encryption key. Restore the original server key.','Unexpected comparison runtime permissions.'];
 console.error(safe.includes(error.message)?error.message:'Comparison configuration failed. Check local setup and migration prerequisites, then retry.');
 if(/^[A-Z0-9]{5}$/.test(error.code??''))console.error('Database error code:',error.code);process.exitCode=1;
}finally{await runtime?.end();await owner?.end();if(created)await unlink(temporary).catch(()=>{});}
