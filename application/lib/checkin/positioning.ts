// Local-only positioning delay. No pixels are read, scored, stored or uploaded.
// Cancellation resolves promptly even when a page is hidden during the delay.
export function waitForPositioning(deps:{signal:AbortSignal;ready:()=>boolean;count:(seconds:number)=>void;
 seconds?:number;schedule?:(callback:()=>void,ms:number)=>ReturnType<typeof setTimeout>;
 cancel?:(timer:ReturnType<typeof setTimeout>)=>void}):Promise<void>{
 const seconds=deps.seconds??3;
 if(!Number.isInteger(seconds)||seconds<1||seconds>5)return Promise.reject(new Error('Invalid camera positioning interval.'));
 return new Promise((resolve,reject)=>{
  let remaining=seconds,timer:ReturnType<typeof setTimeout>|undefined,finished=false;
  const finish=(error?:Error)=>{if(finished)return;finished=true;
   if(timer!==undefined)(deps.cancel??clearTimeout)(timer);
   deps.signal.removeEventListener('abort',abort);deps.count(0);
   if(error)reject(error);else resolve();};
  const abort=()=>finish(new DOMException('Camera positioning cancelled. No frame was submitted.','AbortError'));
  const tick=()=>{
   if(finished)return;
   if(deps.signal.aborted){abort();return;}
   if(!deps.ready()){finish(new Error('Camera stopped or this page was hidden. Start check-in again when ready.'));return;}
   if(remaining===0){finish();return;}
   deps.count(remaining);
   timer=(deps.schedule??setTimeout)(()=>{remaining--;tick();},1000);
  };
  deps.signal.addEventListener('abort',abort,{once:true});tick();
 });
}
