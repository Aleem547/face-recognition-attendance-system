// Explicit private owner-side backup. No restore or live database mutation.
import {spawn} from 'node:child_process';
import {mkdir,lstat,open,link,unlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
let temporary;
async function run(executable,args,env){return new Promise(result=>{let settled=false;const child=spawn(executable,args,{env,stdio:'ignore',shell:false,windowsHide:true});const finish=code=>{if(settled)return;settled=true;clearTimeout(timer);result(code);};const timer=setTimeout(()=>{child.kill('SIGKILL');finish(124);},300000);child.once('error',()=>finish(1));child.once('close',code=>finish(code??1));});}
try{
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw Error('Use node --env-file-if-exists=.env.local scripts/backup-database.mjs --output PRIVATE_NEW_BACKUP.dump');
  const output=resolve(args[1]);await mkdir(dirname(output),{recursive:true,mode:0o700});
  try{await lstat(output);throw Error('Output exists. Choose a new backup filename.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const address=new URL(process.env.DATABASE_URL??'');
  if(!['postgres:','postgresql:'].includes(address.protocol)||!address.username||!address.pathname.slice(1)||decodeURIComponent(address.username)==='attendai_app')throw Error('Use the existing owner DATABASE_URL in the local configuration.');
  // pg_dump receives credentials only in its private child environment, never arguments/logs.
  const env={};for(const key of ['PATH','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','HOME','APPDATA'])if(process.env[key])env[key]=process.env[key];
  Object.assign(env,{PGHOST:address.hostname,PGPORT:address.port||'5432',PGDATABASE:decodeURIComponent(address.pathname.slice(1)),PGUSER:decodeURIComponent(address.username),PGPASSWORD:decodeURIComponent(address.password),PGSSLMODE:'verify-full',PGCONNECT_TIMEOUT:'15',PGAPPNAME:'Face Recognition Attendance System-private-backup'});
  for(const [query,key] of [['sslrootcert','PGSSLROOTCERT'],['sslcert','PGSSLCERT'],['sslkey','PGSSLKEY']])if(address.searchParams.has(query))env[key]=address.searchParams.get(query);
  temporary=output+'.partial-'+randomBytes(8).toString('hex');await (await open(temporary,'wx',0o600)).close();
  const code=await run(process.platform==='win32'?'pg_dump.exe':'pg_dump',['--format=custom','--no-password','--file',temporary],env);
  if(code!==0)throw Error('Backup was not confirmed. Check that a compatible PostgreSQL pg_dump is installed and the configured owner connection is reachable.');
  const stat=await lstat(temporary);if(!stat.isFile()||stat.size<100)throw Error('Backup archive is empty or invalid.');
  await link(temporary,output);await unlink(temporary);temporary=undefined;
  console.log('Private database archive created: '+output);console.log('This contains sensitive records. Keep the original encryption keys separately and run the documented disposable restore drill; file creation alone does not establish recovery.');
}catch(error){console.error(['Backup archive is empty or invalid.','Output exists. Choose a new backup filename.','Use the existing owner DATABASE_URL in the local configuration.'].includes(error.message)||error.message.startsWith('Use node ')||error.message.startsWith('Backup was not confirmed.')?error.message:'Backup could not be finalized. Existing files were preserved; check the private destination and PostgreSQL tools.');process.exitCode=1;}
finally{if(temporary)try{await unlink(temporary);}catch{}}
