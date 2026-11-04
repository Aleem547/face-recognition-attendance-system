import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runtimeAddress,clockReport} from './clock-diagnostics.mjs';

export function deploymentEnvironment(input){
 const env={...input};
 if(!env.BETTER_AUTH_URL&&env.RENDER==='true'){
  let origin;try{origin=new URL(env.RENDER_EXTERNAL_URL);}catch{throw Error('Render did not supply its public HTTPS address. Configure BETTER_AUTH_URL explicitly.');}
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.port||origin.pathname!=='/'||origin.search||origin.hash||!/^[-a-z0-9]+\.onrender\.com$/.test(origin.hostname))throw Error('Use the Render HTTPS address or configure BETTER_AUTH_URL explicitly.');
  env.BETTER_AUTH_URL=origin.origin;
 }
 return env;
}

export function validateContainer(env){
 if(env.DATABASE_URL)throw Error('Supply only APP_DATABASE_URL to the container. Keep the owner connection in trusted setup.');
 runtimeAddress(env.APP_DATABASE_URL);
 if(new URL(env.APP_DATABASE_URL).searchParams.get('sslmode')!=='verify-full')throw Error('APP_DATABASE_URL must explicitly use sslmode=verify-full.');
 if(!env.BETTER_AUTH_SECRET||Buffer.byteLength(env.BETTER_AUTH_SECRET)<32||/CHANGE_ME|REPLACE_ME/.test(env.BETTER_AUTH_SECRET))throw Error('Configure the existing private authentication secret.');
 let origin;try{origin=new URL(env.BETTER_AUTH_URL);}catch{throw Error('Configure the deployment origin.');}
 const local=origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname)&&env.FRAS_LOCAL_PREVIEW==='true'&&env.RENDER!=='true';
 if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||!(origin.protocol==='https:'||local))throw Error('Use an HTTPS origin; HTTP loopback requires FRAS_LOCAL_PREVIEW=true.');
 const port=env.PORT??'3000';if(!/^\d+$/.test(port)||Number(port)<1024||Number(port)>65535)throw Error('Use an unprivileged PORT between 1024 and 65535.');
 if(!['true','false',undefined].includes(env.ATTENDAI_BIOMETRICS_ENABLED)||!['true','false',undefined].includes(env.ATTENDAI_VERIFICATION_TRIAL_ENABLED))throw Error('Use true/false biometric configuration flags.');
 if(env.ATTENDAI_VERIFICATION_TRIAL_ENABLED==='true'&&env.ATTENDAI_BIOMETRICS_ENABLED!=='true')throw Error('Comparison requires the existing enrollment configuration.');
 if(env.ATTENDAI_BIOMETRICS_ENABLED==='true'){
  const key=env.ATTENDAI_BIOMETRIC_KEY??'',bytes=Buffer.from(key,'base64');
  const valid=/^[A-Za-z0-9+/]{43}=$/.test(key)&&bytes.length===32&&bytes.toString('base64')===key;bytes.fill(0);
  if(!valid)throw Error('Supply the original 32-byte biometric key privately; do not regenerate it.');
 }
 return {port};
}
export async function startContainer(){
 const env=deploymentEnvironment(process.env),{port}=validateContainer(env),report=await clockReport();
 if(report.status!=='read_only_preflight_passed'){
  console.error(JSON.stringify({startup:'blocked',clock:report}));return 1;
 }
 console.log('Read-only database/clock preflight passed. Starting one Node server; clock execution is confirmed separately in the signed-in workspace.');
 return new Promise(accept=>{
  const child=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start','--hostname','0.0.0.0','--port',port],{stdio:'inherit',shell:false,env:{...env,NODE_ENV:'production'}});
  const terminate=()=>child.kill('SIGTERM');process.once('SIGTERM',terminate);process.once('SIGINT',terminate);
  child.once('error',()=>{console.error('The web server could not start.');accept(1);});
  child.once('exit',(code,signal)=>{process.off('SIGTERM',terminate);process.off('SIGINT',terminate);accept(signal?143:code??1);});
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=await startContainer();}catch(error){console.error(error.message);process.exitCode=1;}
}
