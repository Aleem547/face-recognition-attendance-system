// Trusted local setup only. Never prints keys, URLs, images, or SQL error text.
import {readFile,writeFile,rename,unlink,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {Pool} from 'pg';
const file=resolve('.env.local'),temporary=resolve('.env.local.face-'+randomBytes(8).toString('hex'));
let owner,runtime,temporaryCreated=false;
function address(value){const url=new URL(value??'');if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error();url.searchParams.set('sslmode','verify-full');return url;}
try{
  const pkg=JSON.parse(await readFile('package.json','utf8'));if(pkg.name!=='face-recognition-attendance-system'||!['0.5.0','0.6.0'].includes(pkg.version))throw new Error();
  const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw new Error();
  const original=await readFile(file,'utf8'),ownerAddress=address(process.env.DATABASE_URL),appAddress=address(process.env.APP_DATABASE_URL);
  if(decodeURIComponent(ownerAddress.username)==='attendai_app'||decodeURIComponent(appAddress.username)!=='attendai_app'||ownerAddress.hostname!==appAddress.hostname||ownerAddress.pathname!==appAddress.pathname)throw new Error();
  for(const name of ['ATTENDAI_BIOMETRIC_KEY','ATTENDAI_BIOMETRICS_ENABLED'])if(original.split(/\r?\n/).filter(line=>new RegExp('^\\s*(?:export\\s+)?'+name+'\\s*=').test(line)).length>1)throw new Error('Duplicate biometric setting.');
  const hadKey=process.env.ATTENDAI_BIOMETRIC_KEY!==undefined;
  const value=process.env.ATTENDAI_BIOMETRIC_KEY??randomBytes(32).toString('base64');
  if(!/^[A-Za-z0-9+/]{43}=$/.test(value)||Buffer.from(value,'base64').length!==32||Buffer.from(value,'base64').toString('base64')!==value)throw new Error('Existing biometric key is invalid. Do not replace it.');
  const keyId=createHash('sha256').update(Buffer.from(value,'base64')).digest('hex').slice(0,16);
  owner=new Pool({connectionString:ownerAddress.toString(),max:1,connectionTimeoutMillis:15000});
  if(!(await owner.query("SELECT version FROM attendai.schema_migrations WHERE version='004'")).rowCount)throw new Error('Migration 004 is required.');
  if(!(await owner.query("SELECT version FROM attendai.schema_migrations WHERE version='005'")).rowCount){
    await owner.query((await readFile('db/migrations/005_biometric_enrollment.sql','utf8')).replace(/^\uFEFF/,''));
    console.log('Migration 005 applied.');
  }else console.log('Migration 005 already recorded.');
  const keys=await owner.query('SELECT DISTINCT key_id FROM attendai.biometric_templates');
  if(keys.rows.some(row=>!hadKey||row.key_id!==keyId))throw new Error('Stored templates use another encryption key. Restore the original server key.');
  runtime=new Pool({connectionString:appAddress.toString(),max:1,connectionTimeoutMillis:15000});
  const permissions=(await runtime.query(`SELECT current_user AS name,
    has_column_privilege(current_user,'attendai.biometric_templates','ciphertext','SELECT') AS ciphertext_read,
    has_column_privilege(current_user,'attendai.biometric_templates','iv','SELECT') AS iv_read,
    has_table_privilege(current_user,'attendai.biometric_events','INSERT') AS event_write`)).rows[0];
  if(permissions.name!=='attendai_app'||permissions.ciphertext_read||permissions.iv_read||permissions.event_write)throw new Error('Unexpected biometric runtime permissions.');
  const names=new Set(['ATTENDAI_BIOMETRIC_KEY','ATTENDAI_BIOMETRICS_ENABLED']);
  const lines=original.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>!names.has(line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/)?.[1]));
  while(lines.at(-1)==='')lines.pop();lines.push('ATTENDAI_BIOMETRIC_KEY='+JSON.stringify(value),'ATTENDAI_BIOMETRICS_ENABLED=true','');
  await writeFile(temporary,lines.join('\n'),{mode:0o600,flag:'wx'});temporaryCreated=true;await rename(temporary,file);temporaryCreated=false;
  console.log(hadKey?'Existing encryption key preserved.':'Server encryption key created and saved privately.');
  console.log('Biometric enrollment configured. Runtime has no general read access to stored template bytes.');
  console.log('Keep .env.local private and backed up securely. Never delete or regenerate its biometric key.');
  console.log('Next: restart Face Recognition Attendance System and open /enrollment as your linked student account.');
}catch(error){
  const safe=['Duplicate biometric setting.','Existing biometric key is invalid. Do not replace it.','Migration 004 is required.','Stored templates use another encryption key. Restore the original server key.','Unexpected biometric runtime permissions.'];
  console.error(safe.includes(error.message)?error.message:'Biometric configuration failed. Check migration prerequisites and local database settings, then retry.');
  if(/^[A-Z0-9]{5}$/.test(error.code??''))console.error('Database error code:',error.code);
  process.exitCode=1;
}finally{await runtime?.end();await owner?.end();if(temporaryCreated)await unlink(temporary).catch(()=>{});}
