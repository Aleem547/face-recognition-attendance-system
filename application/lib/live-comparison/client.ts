export type LiveBegin={token:string;expiresAt:string;maxFrames:number};
export type LiveScore={similarity:number;frame:number;processedAt:string;processingMs:number};
export type LiveView={mode:'idle'|'starting'|'live'|'stopped';score:LiveScore|null;message:string};
export class LiveFrameError extends Error{retryable:boolean;constructor(message:string,retryable=false){super(message);this.retryable=retryable;}}
type Options={begin:(signal:AbortSignal)=>Promise<LiveBegin>;capture:(signal:AbortSignal)=>Promise<Blob>;frame:(token:string,blob:Blob,signal:AbortSignal)=>Promise<LiveScore>;end:(token:string)=>Promise<unknown>;allowed:()=>boolean;changed:(value:LiveView)=>void;clock?:()=>number;schedule?:(fn:()=>void,ms:number)=>ReturnType<typeof setTimeout>;cancel?:(id:ReturnType<typeof setTimeout>)=>void};
export class LiveLoop{
 private options:Options;private epoch=0;private controller:AbortController|null=null;private token:string|null=null;private timer:ReturnType<typeof setTimeout>|undefined;private deadline:ReturnType<typeof setTimeout>|undefined;private expiresAt=0;private frameCount=0;private maxFrames=0;private disposed=false;
 constructor(options:Options){this.options=options;}
 private now(){return (this.options.clock??Date.now)();}
 private schedule(fn:()=>void,ms:number){return (this.options.schedule??setTimeout)(fn,ms);}
 private cancel(id:ReturnType<typeof setTimeout>|undefined){if(id!==undefined)(this.options.cancel??clearTimeout)(id);}
 async start(){
  if(this.disposed||this.controller||!this.options.allowed())return;const epoch=++this.epoch,controller=new AbortController();this.controller=controller;this.options.changed({mode:'starting',score:null,message:'Starting live comparison… The first frame loads the face models.'});
  try{
   const run=await this.options.begin(controller.signal);
   if(epoch!==this.epoch||controller.signal.aborted||!this.options.allowed()){void this.options.end(run.token).catch(()=>{});if(epoch===this.epoch)this.stop('Live comparison stopped.');return;}
   if(!/^[A-Za-z0-9_-]{43}$/.test(run.token)||!Number.isFinite(Date.parse(run.expiresAt))||Date.parse(run.expiresAt)<=this.now()||Date.parse(run.expiresAt)>this.now()+65000||!Number.isInteger(run.maxFrames)||run.maxFrames<1||run.maxFrames>60)throw Error('The live comparison session was invalid.');
   this.token=run.token;this.expiresAt=Date.parse(run.expiresAt);this.maxFrames=run.maxFrames;this.frameCount=0;this.deadline=this.schedule(()=>this.stop('The 60-second live run ended.'),this.expiresAt-this.now());await this.next(epoch);
  }catch(error){if(epoch===this.epoch)this.stop(error instanceof Error?error.message:'Live comparison could not start.');}
 }
 private async next(epoch:number){
  this.timer=undefined;if(epoch!==this.epoch||!this.controller||!this.token)return;
  if(!this.options.allowed()||this.now()>=this.expiresAt||this.frameCount>=this.maxFrames){this.stop('Live comparison ended. Start another run when ready.');return;}
  const started=this.now(),controller=this.controller,token=this.token;this.frameCount++;
  try{
   const blob=await this.options.capture(controller.signal);if(epoch!==this.epoch||controller.signal.aborted)return;
   const score=await this.options.frame(token,blob,controller.signal);if(epoch!==this.epoch||controller.signal.aborted)return;
   if(!this.options.allowed()||this.now()>=this.expiresAt){this.stop('Live comparison stopped.');return;}
   if(!Number.isFinite(score.similarity)||score.similarity< -1||score.similarity>1||!Number.isFinite(Date.parse(score.processedAt)))throw Error('The live comparison result was invalid.');
   this.options.changed({mode:'live',score,message:'Live comparison running. Scores update as each frame finishes.'});
  }catch(error){
   if(epoch!==this.epoch||controller.signal.aborted)return;
   if(error instanceof LiveFrameError&&error.retryable)this.options.changed({mode:'live',score:null,message:error.message});
   else {this.stop(error instanceof Error?error.message:'Live comparison failed.');return;}
  }
  if(epoch===this.epoch)this.timer=this.schedule(()=>void this.next(epoch),Math.max(0,1000-(this.now()-started)));
 }
 stop(message='Live comparison stopped.'){
  this.epoch++;this.cancel(this.timer);this.cancel(this.deadline);this.timer=undefined;this.deadline=undefined;this.controller?.abort();this.controller=null;const token=this.token;this.token=null;
  if(token)void this.options.end(token).catch(()=>{});if(!this.disposed)this.options.changed({mode:'stopped',score:null,message});
 }
 dispose(){this.disposed=true;this.stop();}
}
