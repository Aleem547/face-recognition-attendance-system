import {lstat,readFile,writeFile,mkdir,rename,unlink,rm,realpath} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createConnection} from 'node:net';
import {spawn} from 'node:child_process';
import {readRegular,safeName,sha256} from './release-utils.mjs';
import {verifyRelease} from './verify-release.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const normalized=bytes=>Buffer.from(bytes.toString('utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n'));
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function parents(project,name){
  safeName(name);let at=project;
  for(const part of name.split('/').slice(0,-1)){
    at=join(at,part);if(!await exists(at))continue;
    const info=await lstat(at);if(info.isSymbolicLink()||!info.isDirectory())throw Error('Linked or invalid source directory: '+name);
  }
}
async function atomic(project,name,bytes){
  await parents(project,name);const destination=join(project,name),temporary=destination+'.rename-'+randomUUID();
  await mkdir(dirname(destination),{recursive:true});
  try{await writeFile(temporary,bytes,{flag:'wx',mode:0o600});await rename(temporary,destination);}finally{await unlink(temporary).catch(()=>{});}
}
async function portClosed(host,port){
  return new Promise((accept,reject)=>{
    const socket=createConnection({host,port});
    const finish=error=>{socket.destroy();error?reject(error):accept();};
    socket.setTimeout(700,()=>finish(Error('Could not confirm port '+port+' is stopped.')));
    socket.once('connect',()=>finish(Error('Finish current timed classes, then stop the application on port '+port+' with Ctrl+C in its original terminal.')));
    socket.once('error',error=>finish(['ECONNREFUSED','ENETUNREACH','EHOSTUNREACH','EAFNOSUPPORT'].includes(error.code)?null:Error('Could not confirm the local server is stopped.')));
  });
}
export async function rebuild(project){
  const next=join(project,'node_modules/next/dist/bin/next');
  if(!await exists(next))throw Error('Installed Next.js is missing. Restore the existing project dependencies first.');
  await new Promise((accept,reject)=>{
    const child=spawn(process.execPath,[next,'build'],{cwd:project,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},stdio:'inherit',shell:false,windowsHide:true});
    child.once('error',()=>reject(Error('The local build could not start.')));
    child.once('exit',code=>code===0?accept():reject(Error('The local build did not pass.')));
  });
}
export async function installProjectRename(project,{build=rebuild,port=3000}={}){
  if(Number(process.versions.node.split('.')[0])<24)throw Error('Use Node.js 24 or newer.');
  await verifyRelease(root);
  const requested=resolve(project),info=await lstat(requested);
  if(info.isSymbolicLink()||!info.isDirectory())throw Error('Select the real installed application directory.');
  project=await realpath(requested);
  if(project===root||project===join(root,'application'))throw Error('The extracted source already has the new name. Select your installed application instead.');
  await portClosed('127.0.0.1',port);await portClosed('::1',port);
  const manifest=JSON.parse(await readRegular(root,'rename-files.json'));
  if(manifest.schema!=='project-name-update-v1'||!Array.isArray(manifest.files))throw Error('Invalid rename file list.');
  const before=new Map(),after=new Map();
  async function snapshot(name){
    await parents(project,name);
    if(!before.has(name))before.set(name,await exists(join(project,name))?await readRegular(project,name):null);
    return before.get(name);
  }
  for(const entry of manifest.files){
    const {previousPath,path,previousSha256,sha256:targetHash}=entry;safeName(previousPath);safeName(path);
    const target=await readRegular(root,'application/'+path);
    if(sha256(target)!==targetHash)throw Error('Invalid rename payload: '+path);
    const previous=await snapshot(previousPath),current=previousPath===path?previous:await snapshot(path);
    if(previousPath!==path&&previous&&sha256(normalized(previous))!==previousSha256)throw Error('Local edits preserved; source differs: '+previousPath);
    if(!previous&&!current)throw Error('Expected installed source is missing: '+previousPath);
    if(current&&![previousPath===path?previousSha256:targetHash,targetHash].includes(sha256(normalized(current))))throw Error('Local edits preserved; source differs: '+path);
    if(!current||sha256(current)!==targetHash)after.set(path,target);
    if(previousPath!==path&&previous)after.set(previousPath,null);
  }
  const packageBytes=await snapshot('package.json');if(!packageBytes)throw Error('Installed package.json is missing.');
  const pkg=JSON.parse(packageBytes.toString('utf8').replace(/^\uFEFF/,''));
  if(!manifest.packageNames.includes(pkg.name)||pkg.version!=='0.6.0')throw Error('Use the existing supported 0.6.0 application.');
  if(pkg.name!==manifest.packageName){pkg.name=manifest.packageName;after.set('package.json',Buffer.from(JSON.stringify(pkg,null,2)+'\n'));}
  for(const name of ['package-lock.json','npm-shrinkwrap.json']){
    const bytes=await snapshot(name);if(!bytes)continue;
    const lock=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
    if(lock.name&&!manifest.packageNames.includes(lock.name)||lock.packages?.['']?.name&&!manifest.packageNames.includes(lock.packages[''].name))throw Error('Unrecognized dependency lock metadata; original preserved.');
    let changed=false;
    if(lock.name!==manifest.packageName){lock.name=manifest.packageName;changed=true;}
    if(lock.packages?.['']&&lock.packages[''].name!==manifest.packageName){lock.packages[''].name=manifest.packageName;changed=true;}
    if(changed)after.set(name,Buffer.from(JSON.stringify(lock,null,2)+'\n'));
  }
  if(!after.size)return {status:'already_current',projectName:manifest.projectName,filesChanged:0};
  const backupParent=join(project,'.project-rename-backups');
  if(await exists(backupParent)){const info=await lstat(backupParent);if(info.isSymbolicLink()||!info.isDirectory())throw Error('Backup location is linked or invalid.');}
  const backupId=randomUUID(),backup=join(backupParent,backupId);await mkdir(backup,{recursive:true,mode:0o700});
  const receipt={schema:'project-name-update-receipt-v1',projectName:manifest.projectName,backupId,status:'prepared',databaseChanges:'none',environmentChanges:'none',files:[...after].map(([path,bytes])=>({path,beforeSha256:before.get(path)?sha256(before.get(path)):null,afterSha256:bytes?sha256(bytes):null}))};
  for(const [name] of after){const bytes=before.get(name);if(bytes){const dest=join(backup,'source',name);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,bytes,{flag:'wx',mode:0o600});}}
  const save=()=>writeFile(join(backup,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});await save();
  // Verify source snapshots once more before applying any writes.
  for(const [name,bytes] of before){const current=await exists(join(project,name))?await readRegular(project,name):null;if((current?sha256(current):null)!==(bytes?sha256(bytes):null))throw Error('Source changed during preparation; original preserved: '+name);}
  const buildPath=join(project,'.next'),savedBuild=join(backup,'previous-build');let buildMoved=false,buildStarted=false;
  const applied=[];
  try{
    if(await exists(buildPath)){const info=await lstat(buildPath);if(info.isSymbolicLink()||!info.isDirectory())throw Error('Existing build directory is linked or invalid.');await rename(buildPath,savedBuild);buildMoved=true;}
    for(const [name,bytes] of after){if(bytes)await atomic(project,name,bytes);else await unlink(join(project,name));applied.push(name);}
    buildStarted=true;await build(project);
    receipt.status='installed';receipt.build='passed';await save();
    return {status:'installed',projectName:manifest.projectName,filesChanged:after.size,backupId};
  }catch(error){
    const conflicts=[];
    for(const name of applied.reverse()){
      const expected=after.get(name),current=await exists(join(project,name))?await readRegular(project,name):null;
      if((current?sha256(current):null)!==(expected?sha256(expected):null)){conflicts.push(name);continue;}
      const bytes=before.get(name);if(bytes)await atomic(project,name,bytes);else await unlink(join(project,name)).catch(e=>{if(e.code!=='ENOENT')throw e;});
    }
    if(buildStarted)await rm(buildPath,{recursive:true,force:true});
    if(buildMoved)await rename(savedBuild,buildPath);
    receipt.status=conflicts.length?'rollback_conflict':'rolled_back';receipt.conflicts=conflicts;await save();
    if(conflicts.length)throw Error('Concurrent edits were preserved. Review backup '+backupId+' before continuing.');
    throw Error(error.message+' Previous source and production build restored.');
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--project')throw Error('Use --project INSTALLED_APPLICATION_DIRECTORY.');
    const result=await installProjectRename(args[1]);console.log(JSON.stringify(result,null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
