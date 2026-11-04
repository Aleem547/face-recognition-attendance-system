// An explicit Check in click opens the preview and requests at most one frame.
// Permission arriving after cancel/hide/unmount cannot initiate an upload.
export function createOneShotCheckin(deps:{start:()=>Promise<void>;ready:()=>boolean;prepare?:()=>Promise<void>;capture:()=>Promise<void>;busy:(value:boolean)=>void}){
 let pending=false,generation=0;
 return {async run(){if(pending)return;pending=true;const current=++generation;deps.busy(true);
  try{await deps.start();if(current!==generation||!deps.ready())return;
   await deps.prepare?.();
   if(current===generation&&deps.ready())await deps.capture();}
  finally{if(current===generation){pending=false;deps.busy(false);}}
 },cancel(){generation++;pending=false;deps.busy(false);}};
}
