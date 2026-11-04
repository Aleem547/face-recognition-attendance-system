import {validatePad,type PadScores} from "../verification/paired.ts";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { RegisterError } from "../register/service.ts";
import { featureBytes, MODEL_VERSION } from "./crypto.ts";
const errors:Record<string,string>={
  no_face:"No face was found. Face the camera in good light and try again.",
  multiple_faces:"More than one face was found. Only you should be in the frame.",
  face_too_small:"Move closer so your face fills more of the frame.",face_clipped:"Keep your whole face inside the frame.",
  lighting_unsuitable:"Use even lighting without strong backlight.",face_blurry:"Keep still and let the camera focus before capturing.",
  invalid_image_size:"The JPEG frame is empty or too large.",jpeg_required:"A JPEG camera frame is required.",
  invalid_jpeg:"The JPEG camera frame could not be read.",image_dimensions_out_of_range:"The camera frame dimensions are unsupported.",
  unsupported_jpeg:"This JPEG format is unsupported.",invalid_face_geometry:"Keep your face upright and clearly visible.",
};
const slots=globalThis as unknown as {attendaiEnrollmentBusy?:boolean};
export function reserveEngine() {
  if(slots.attendaiEnrollmentBusy)throw new RegisterError(503,"The CPU face engine is busy. Try again shortly.");
  slots.attendaiEnrollmentBusy=true;return ()=>{slots.attendaiEnrollmentBusy=false;};
}
async function extract(image:Buffer,signal:AbortSignal,paired:boolean):Promise<{embedding:number[];pad?:PadScores}> {
  if(signal.aborted)throw new RegisterError(409,"Face processing request cancelled.");
  const root=process.cwd(),executable=resolve(root,".venv-face",process.platform==="win32"?"Scripts/python.exe":"bin/python");
  const env:NodeJS.ProcessEnv={NODE_ENV:"production",OPENBLAS_NUM_THREADS:"1",OMP_NUM_THREADS:"2"};
  for(const name of ["SYSTEMROOT","SystemRoot","WINDIR","TEMP","TMP","PATH","LANG","LC_ALL"])if(process.env[name])env[name]=process.env[name];
  return new Promise((accept,reject)=>{
    const child=spawn(executable,["-E","-s","-B",resolve(root,paired?"face-engine/joint.py":"face-engine/enroll.py")],{cwd:root,env,shell:false,stdio:["pipe","pipe","pipe"],windowsHide:true});
    const chunks:Buffer[]=[];let size=0,failed=false,cancelled=false,settled=false;
    const abort=()=>{cancelled=true;child.kill("SIGKILL");};
    const timer=setTimeout(()=>{failed=true;child.kill("SIGKILL");},25000);
    const finish=(error?:Error,value?:{embedding:number[];pad?:PadScores})=>{
      if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener("abort",abort);
      for(const chunk of chunks)chunk.fill(0);
      if(error)reject(error);else accept(value!);
    };
    signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();
    child.stderr.resume(); // Native diagnostics are never logged or returned.
    child.stdin.on("error",()=>{});
    child.stdout.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size>8192){failed=true;chunk.fill(0);child.kill("SIGKILL");}else chunks.push(chunk);});
    child.on("error",()=>finish(new RegisterError(503,"The dedicated face engine could not start. Check face setup.")));
    child.on("close",code=>{
      if(cancelled)return finish(new RegisterError(409,"Face processing request cancelled."));
      if(failed||code!==0)return finish(new RegisterError(503,"The face engine timed out or was unavailable. No result was saved by this request."));
      try {
        const result=JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if(result.ok!==true){const message=errors[result.code];return finish(new RegisterError(message?422:503,message??"The face engine is unavailable. No result was saved by this request."));}
        if(result.modelVersion!==MODEL_VERSION||Object.keys(result).sort().join(",")!==(paired?"embedding,modelVersion,ok,pad":"embedding,modelVersion,ok"))throw new Error();
        const validated=featureBytes(result.embedding);validated.fill(0);finish(undefined,{embedding:result.embedding,...(paired?{pad:validatePad(result.pad)}:{})});
      } catch {finish(new RegisterError(503,"The face engine returned an invalid result. No result was saved by this request."));}
    });
    child.stdin.end(image);
  });
}

export async function extractFace(image:Buffer,signal:AbortSignal):Promise<number[]> {return (await extract(image,signal,false)).embedding;}
export async function extractPaired(image:Buffer,signal:AbortSignal) {return extract(image,signal,true);}
