import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {resolve} from 'node:path';
import {RegisterError} from '../register/service.ts';
import {featureBytes,MODEL_VERSION} from '../biometric/crypto.ts';
const quality:Record<string,string>={no_face:'No face found. Look toward the camera.',multiple_faces:'More than one face. Keep only your face in view.',face_too_small:'Move closer to the camera.',face_clipped:'Keep your full face visible.',lighting_unsuitable:'Use even lighting.',face_blurry:'Keep still and let the camera focus.',invalid_face_geometry:'Keep your face upright and fully visible.'};
type Pending={accept:(value:number[])=>void;reject:(error:Error)=>void;signal:AbortSignal;abort:()=>void;timer:ReturnType<typeof setTimeout>;image:Buffer;sent:boolean};
type Launch=()=>ChildProcessWithoutNullStreams;
export class ResidentFaceWorker{
 private child:ChildProcessWithoutNullStreams|null=null;private pending:Pending|null=null;private output=Buffer.alloc(0);private ready=false;private idle:ReturnType<typeof setTimeout>|undefined;private launch:Launch;
 constructor(launch?:Launch){this.launch=launch??(()=>{
  const root=process.cwd(),executable=resolve(root,'.venv-face',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const env:NodeJS.ProcessEnv={NODE_ENV:'production',OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'2'};for(const name of ['SYSTEMROOT','SystemRoot','WINDIR','TEMP','TMP','PATH','LANG','LC_ALL'])if(process.env[name])env[name]=process.env[name];
  return spawn(executable,['-E','-s','-B',resolve(root,'face-engine/live.py')],{cwd:root,env,shell:false,stdio:['pipe','pipe','pipe'],windowsHide:true});
 });}
 extract(image:Buffer,signal:AbortSignal):Promise<number[]>{
  if(signal.aborted)return Promise.reject(new RegisterError(409,'Live comparison stopped.'));
  if(this.pending)return Promise.reject(new RegisterError(503,'The CPU face engine is busy. Try again shortly.'));
  if(image.length<20||image.length>1048576)return Promise.reject(new RegisterError(413,'The live camera frame is unsupported.'));
  clearTimeout(this.idle);
  return new Promise((accept,reject)=>{
   const abort=()=>this.destroy(new RegisterError(409,'Live comparison stopped.'));
   const timer=setTimeout(()=>this.destroy(new RegisterError(503,'The live face engine timed out. Restart live comparison.')),25000);
   this.pending={accept,reject,signal,abort,timer,image,sent:false};signal.addEventListener('abort',abort,{once:true});
   try{if(!this.child)this.start();if(signal.aborted)abort();else this.send();}catch{this.destroy(new RegisterError(503,'The live face engine could not start. Check the existing face setup.'));}
  });
 }
 private start(){
  const child=this.launch();this.child=child;this.ready=false;child.stderr.resume();child.stdin.on('error',()=>{});
  child.stdout.on('data',(chunk:Buffer)=>{
   if(this.child!==child){chunk.fill(0);return;}const combined=Buffer.concat([this.output,chunk]);this.output.fill(0);chunk.fill(0);this.output=combined;
   if(this.output.length>16384){this.destroy(new RegisterError(503,'The live face engine returned an invalid response.'));return;}
   let end;while((end=this.output.indexOf(10))>=0){const line=this.output.subarray(0,end),rest=Buffer.from(this.output.subarray(end+1));try{this.message(JSON.parse(line.toString('utf8')));}catch{this.destroy(new RegisterError(503,'The live face engine returned an invalid response.'));}this.output.fill(0);this.output=rest;if(this.child!==child){this.output.fill(0);this.output=Buffer.alloc(0);return;}}
  });
  child.once('error',()=>{if(this.child===child)this.destroy(new RegisterError(503,'The live face engine could not start. Check the existing face setup.'));});
  child.once('close',()=>{if(this.child===child)this.destroy(new RegisterError(503,'The live face engine stopped. Start a new live run.'));});
 }
 private send(){const p=this.pending;if(!p||!this.ready||!this.child||p.sent)return;p.sent=true;const header=Buffer.alloc(4);header.writeUInt32BE(p.image.length);this.child.stdin.write(header,()=>header.fill(0));this.child.stdin.write(p.image);}
 private message(value:{type?:unknown;modelVersion?:unknown;ok?:unknown;code?:unknown;embedding?:unknown}){
  if(value.type==='ready'&&value.modelVersion===MODEL_VERSION&&!this.ready){this.ready=true;this.send();return;}
  if(value.type!=='result'||!this.pending||!this.pending.sent){this.destroy(new RegisterError(503,'The live face engine returned an invalid response.'));return;}
  if(value.ok!==true){const message=quality[String(value.code)];if(message){this.finish(new RegisterError(422,message));return;}this.destroy(new RegisterError(503,'The live face engine could not process this frame.'));return;}
  if(value.modelVersion!==MODEL_VERSION||Object.keys(value).sort().join(',')!=='embedding,modelVersion,ok,type')throw Error('Invalid engine response');
  const checked=featureBytes(value.embedding);checked.fill(0);this.finish(undefined,value.embedding as number[]);
 }
 private finish(error?:Error,embedding?:number[]){const p=this.pending;if(!p)return;this.pending=null;clearTimeout(p.timer);p.signal.removeEventListener('abort',p.abort);if(error)p.reject(error);else p.accept(embedding!);this.idle=setTimeout(()=>this.destroy(),10000);this.idle.unref?.();}
 private destroy(error?:Error){const child=this.child;this.child=null;this.ready=false;clearTimeout(this.idle);this.output.fill(0);this.output=Buffer.alloc(0);if(child){child.stdin.destroy();child.kill('SIGKILL');}if(this.pending){this.finish(error??new RegisterError(409,'Live comparison stopped.'));clearTimeout(this.idle);}}
 dispose(){this.destroy();}
}
const state=globalThis as unknown as {attendaiLiveWorker?:ResidentFaceWorker;attendaiLiveWorkerExit?:boolean};
export function liveWorker(){if(!state.attendaiLiveWorker)state.attendaiLiveWorker=new ResidentFaceWorker();if(!state.attendaiLiveWorkerExit){state.attendaiLiveWorkerExit=true;process.once('exit',()=>state.attendaiLiveWorker?.dispose());}return state.attendaiLiveWorker;}
