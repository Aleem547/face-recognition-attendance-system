import {pairedChoice,PAD_NOTICE} from "@/lib/verification/paired";
import {NextResponse} from "next/server";
import {requireApiAccount} from "@/lib/server/access";
import {getAppPool} from "@/lib/server/database";
import {consumeComparison,finishComparison,verificationError} from "@/lib/verification/service";
import {verificationKey} from "@/lib/verification/config";
import {assertImageRequest,readImage} from "@/lib/biometric/http";
import {extractFace,extractPaired,reserveEngine} from "@/lib/biometric/worker";
import {RegisterError} from "@/lib/register/service";
export const runtime="nodejs";export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
export async function POST(request:Request){let key:Buffer|undefined,image:Buffer|undefined,probe:number[]|undefined,release:(()=>void)|undefined;
 try{
  const access=await requireApiAccount(request,["student"]);if(access.response)return access.response;
  assertImageRequest(request,process.env.BETTER_AUTH_URL);const paired=pairedChoice(request.headers.get("x-attendai-pad-research"));key=verificationKey();release=reserveEngine();
  const attempt=await consumeComparison(getAppPool(),access.account,request.headers.get("x-attendai-token")??"");
  image=await readImage(request);
  const combined=paired?await extractPaired(image,request.signal):null;
  probe=combined?combined.embedding:await extractFace(image,request.signal);
  const fresh=await requireApiAccount(request,["student"]);if(fresh.response)return fresh.response;
  if(request.signal.aborted||fresh.account.id!==access.account.id)throw new RegisterError(409,"Comparison request cancelled.");
  const saved=await finishComparison(getAppPool(),fresh.account,attempt,probe,key);
  return NextResponse.json({...saved,...(combined?{pairedResearch:{noticeVersion:PAD_NOTICE,trialId:saved.trial.trial_id,pad:combined.pad,storage:"response_only"}}:{})},{headers});
 }catch(error){const value=verificationError(error);return NextResponse.json({error:value.error},{status:value.status,headers});}
 finally{image?.fill(0);probe?.fill(0);key?.fill(0);release?.();}
}
