import {createHash} from 'node:crypto';
import {RegisterError} from '../register/service.ts';
import type {consumeComparison} from '../verification/service.ts';
export const LIVE_NOTICE='own-live-comparison-2026-11-04';
export const LIVE_DURATION=60000;
export const LIVE_FRAMES=60;
export type LiveAttempt=Awaited<ReturnType<typeof consumeComparison>>;
type Lease={accountId:string;attempt:LiveAttempt;expiresAt:number;frames:number;nextAt:number;busy:boolean;controller:AbortController|null;timer:ReturnType<typeof setTimeout>};
const digest=(token:string)=>{if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new RegisterError(409,'Live comparison ended. Start a new live run.');return createHash('sha256').update(token).digest('hex');};
export class LiveLeases{
 private leases=new Map<string,Lease>();private clock:()=>number;
 constructor(clock=Date.now){this.clock=clock;}
 open(accountId:string,token:string,attempt:LiveAttempt){
  const id=digest(token);for(const [key,lease]of this.leases)if(lease.accountId===accountId)this.remove(key);
  if(this.leases.size>=4)throw new RegisterError(503,'Live comparison is busy. Try again shortly.');
  const expiresAt=this.clock()+LIVE_DURATION;
  const timer=setTimeout(()=>this.remove(id),LIVE_DURATION);timer.unref?.();
  this.leases.set(id,{accountId,attempt,expiresAt,frames:0,nextAt:0,busy:false,controller:null,timer});
  return {expiresAt:new Date(expiresAt).toISOString(),maxFrames:LIVE_FRAMES,noticeVersion:LIVE_NOTICE};
 }
 private own(accountId:string,token:string){const id=digest(token),lease=this.leases.get(id);if(!lease||lease.accountId!==accountId)throw new RegisterError(409,'Live comparison ended. Start a new live run.');if(this.clock()>=lease.expiresAt){this.remove(id);throw new RegisterError(409,'The 60-second live run ended.');}return {id,lease};}
 claim(accountId:string,token:string){
  const {id,lease}=this.own(accountId,token);
  if(lease.frames>=LIVE_FRAMES){this.remove(id);throw new RegisterError(409,'The live frame limit was reached. Start a new run when ready.');}
  if(lease.busy||this.clock()<lease.nextAt)throw new RegisterError(429,'Wait for the current live comparison before sending another frame.');
  lease.frames++;lease.nextAt=this.clock()+750;lease.busy=true;const controller=new AbortController();lease.controller=controller;
  return {attempt:lease.attempt,frame:lease.frames,signal:controller.signal,expiresAt:new Date(lease.expiresAt).toISOString(),
   assertCurrent:()=>{if(controller.signal.aborted||this.leases.get(id)!==lease||this.clock()>=lease.expiresAt)throw new RegisterError(409,'Live comparison stopped.');},
   finish:()=>{if(lease.controller===controller){lease.controller=null;lease.busy=false;}}
  };
 }
 close(accountId:string,token:string){const id=digest(token),lease=this.leases.get(id);if(!lease||lease.accountId!==accountId)return null;this.remove(id);return lease.attempt;}
 private remove(id:string){const lease=this.leases.get(id);if(!lease)return;this.leases.delete(id);clearTimeout(lease.timer);lease.controller?.abort();}
 dispose(){for(const id of this.leases.keys())this.remove(id);}
}
const state=globalThis as unknown as {attendaiLiveLeases?:LiveLeases};
export function liveLeases(){return state.attendaiLiveLeases??=new LiveLeases();}
