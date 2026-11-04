import {NextResponse} from "next/server";
import {requireApiAccount} from "@/lib/server/access";
import {getAppPool} from "@/lib/server/database";
import {consumeAttempt,finishEnrollment,biometricError} from "@/lib/biometric/service";
import {assertImageRequest,readImage} from "@/lib/biometric/http";
import {extractFace,reserveEngine} from "@/lib/biometric/worker";
import {enrollmentKey} from "@/lib/biometric/config";
import {RegisterError} from "@/lib/register/service";
export const runtime="nodejs";export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
export async function POST(request:Request){let key:Buffer|undefined,image:Buffer|undefined,embedding:number[]|undefined,release:(()=>void)|undefined;
  try{
    const access=await requireApiAccount(request,["student"]);if(access.response)return access.response;
    assertImageRequest(request,process.env.BETTER_AUTH_URL);key=enrollmentKey();release=reserveEngine();
    const attempt=await consumeAttempt(getAppPool(),access.account,request.headers.get("x-attendai-token")??"");
    image=await readImage(request);embedding=await extractFace(image,request.signal);
    // Recheck the session after inference, including logout in another tab.
    const fresh=await requireApiAccount(request,["student"]);if(fresh.response)return fresh.response;
    if(request.signal.aborted||fresh.account.id!==access.account.id)throw new RegisterError(409,"Enrollment request cancelled.");
    return NextResponse.json(await finishEnrollment(getAppPool(),fresh.account,attempt,embedding,key),{headers});
  }catch(error){const value=biometricError(error);return NextResponse.json({error:value.error},{status:value.status,headers});}
  finally{image?.fill(0);embedding?.fill(0);key?.fill(0);release?.();}
}
