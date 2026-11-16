import {readFile,lstat,mkdir,writeFile,realpath} from 'node:fs/promises';
import {resolve,dirname,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {homedir} from 'node:os';

const scriptDirectory=dirname(fileURLToPath(import.meta.url));
const suites=['demo-workspace','demo-face','auth.integration','registration.integration','register.integration','privacy.integration','biometric.integration',
 'verification.integration','session-research','verification.receipts','biometric.client','deployment','render-host',
 'biometric.http','camera.lifecycle','verification.client','paired-research','face-evaluation','automatic-checkin','automatic-checkin.http','class-automation','class-clock','course-analytics','reliability','local-closeout'];
const digest=b=>createHash('sha256').update(b).digest('hex');
const normalized=b=>Buffer.from(b.toString('utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n'));

export function newReport(){
 return {schema:'attendai-consolidated-validation-v1',release:'local-completion-2026-11-02',
  startedAt:new Date().toISOString(),finishedAt:null,overall:'not_run',preflight:'not_run',
  installation:null,checks:suites.map(name=>({name,status:'not_run',exitCode:null,assertionsReported:0})),
  build:{status:'not_run',exitCode:null},error:null,
  scope:'isolated_software_checks_and_production_build',liveDatabaseChanges:'not_performed',
  physicalCameraValidation:'unverified',padValidation:'unverified',automaticAttendanceMode:'experimental_per_session_opt_in',automaticAttendanceApproval:'not_granted'};
}
export async function prerequisites(project){
 if(Number(process.versions.node.split('.')[0])<24)throw Error('Use Node.js 24 or newer.');
 const pkg=JSON.parse(normalized(await readFile(join(project,'package.json'))));
 if(pkg.name!=='face-recognition-attendance-system'||pkg.version!=='0.6.0')throw Error('Use the existing Face Recognition Attendance System 0.6.0 project.');
 const require=createRequire(join(project,'package.json'));
 for(const [name,version] of Object.entries({next:'15.5.28','better-auth':'1.7.12',pg:'8.23.1',kysely:'0.29.7','@electric-sql/pglite':'0.5.11'})){
  let installed;try{installed=JSON.parse(await readFile(join(project,'node_modules',name,'package.json'),'utf8')).version;}
  catch{throw Error('Existing project dependency is missing: '+name+'. No dependency was installed.');}
  if(installed!==version)throw Error('Installed '+name+' differs from the reviewed project version. Preserve the current lockfile for review.');
 }
 require.resolve('typescript');return {next:require.resolve('next/dist/bin/next'),nodeVersion:process.versions.node};
}
async function verifySource(project){
 const expected=JSON.parse(await readFile(join(scriptDirectory,'../lib/release/check-source.json'),'utf8'));
 const changed=[];
 for(const [name,hash] of Object.entries(expected)){
  if(name.startsWith('/')||name.includes('\\')||name.includes(':')||name.split('/').some(p=>!p||p==='..'||p==='.')||!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid validation source entry.');
  let path=project;
  try{
   const parts=name.split('/');
   for(let i=0;i<parts.length;i++){
    path=join(path,parts[i]);const info=await lstat(path);
    if(info.isSymbolicLink()||(i<parts.length-1?!info.isDirectory():!info.isFile())||i===parts.length-1&&info.size>5*1024*1024)throw Error('Invalid source path.');
   }
   if(digest(normalized(await readFile(path)))!==hash)changed.push(name);
  }catch{changed.push(name);}
 }
 if(changed.length)throw Error('Source differs or is missing; preserve local edits and review: '+changed.join(', '));
 return Object.keys(expected).length;
}
export async function saveReport(report,output=join(homedir(),'Downloads')){
 report.finishedAt=new Date().toISOString();await mkdir(output,{recursive:true});
 const path=join(output,'Face_Recognition_Attendance_System_Local_Completion_Report_'+report.startedAt.replace(/[:.]/g,'-')+'.json');
 await writeFile(path,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log('\nReport saved: '+path);return path;
}
export async function validate(projectPath,report=newReport()){
 let child=null,interrupted=false;
 const stop=()=>{interrupted=true;child?.kill('SIGTERM');};
 process.on('SIGINT',stop);
 const execute=async(args,build=false)=>{
  if(interrupted)return {exitCode:130,assertionsReported:0};
  const env={...process.env,NEXT_TELEMETRY_DISABLED:'1'};
  // Better Auth relaxes origin checks in test mode. Development mode keeps
  // those guards active while the fixtures still use only isolated PGlite.
  if(!build){env.NODE_ENV='development';for(const key of Object.keys(env))if(/DATABASE|AUTH.*SECRET|BIOMETRIC.*KEY/i.test(key))delete env[key];}
  return new Promise(resolveResult=>{
   let count=0,pending='';
   const line=value=>{if(/^PASS\s+\d+:/.test(value))count++;};
   child=spawn(process.execPath,args,{cwd:projectPath,env,shell:false,windowsHide:true,stdio:['ignore','pipe','inherit']});
   child.stdout.on('data',chunk=>{
    process.stdout.write(chunk);pending+=chunk.toString('utf8');
    let newline;while((newline=pending.indexOf('\n'))>=0){line(pending.slice(0,newline));pending=pending.slice(newline+1);}
    if(pending.length>16384)pending=pending.slice(-16384);
   });
   child.once('error',()=>{child=null;resolveResult({exitCode:1,assertionsReported:count});});
   child.once('close',code=>{line(pending);child=null;resolveResult({exitCode:interrupted?130:code??1,assertionsReported:count});});
  });
 };
 try{
  projectPath=await realpath(resolve(projectPath));
  const dependencies=await prerequisites(projectPath);report.nodeVersion=dependencies.nodeVersion;
  report.sourceFilesVerified=await verifySource(projectPath);report.sourceDigest=digest(normalized(await readFile(join(projectPath,'lib/release/check-source.json'))));report.preflight='passed';
  let passed=true;
  for(const check of report.checks){
   console.log('\nRunning '+check.name);const started=Date.now();
   const result=await execute(['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',join(projectPath,'tests',check.name+'.mjs')]);
   Object.assign(check,result,{seconds:Math.round((Date.now()-started)/10)/100,status:result.exitCode===0?'passed':interrupted?'cancelled':'failed'});
   if(result.exitCode!==0){passed=false;break;}
  }
  if(passed&&!interrupted){
   console.log('\nRunning production build.');const result=await execute([dependencies.next,'build'],true);
   report.build={status:result.exitCode===0?'passed':interrupted?'cancelled':'failed',exitCode:result.exitCode};passed=result.exitCode===0;
  }
  report.overall=interrupted?'cancelled':passed?'software_checks_passed':'failed';
 }catch(error){report.error=error.message;report.overall='blocked';if(report.preflight!=='passed')report.preflight='failed';console.error(report.error);}
 finally{process.off('SIGINT',stop);}
 return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let project=resolve(scriptDirectory,'..'),output=join(homedir(),'Downloads'),report=newReport();
 try{
  const args=process.argv.slice(2),seen=new Set();
  while(args.length){const key=args.shift();if(seen.has(key)||!['--project','--output'].includes(key)||!args.length)throw Error('Use --project PROJECT and optional --output DIRECTORY.');seen.add(key);if(key==='--project')project=resolve(args.shift());else output=resolve(args.shift());}
  report=await validate(project,report);
 }catch(error){report.overall='blocked';report.error=error.message;console.error(report.error);}
 try{await saveReport(report,output);}catch{report.overall='report_save_failed';console.error('Could not save the summary report. Preserve the displayed result.');}
 console.log('Result: '+report.overall+'. No biometric or production approval is implied.');
 process.exitCode=report.overall==='software_checks_passed'?0:1;
}
