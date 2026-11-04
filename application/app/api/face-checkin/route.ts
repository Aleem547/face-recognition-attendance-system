import {NextResponse} from 'next/server';
import {requireApiAccount} from '@/lib/server/access';
import {getAppPool} from '@/lib/server/database';
import {enrollmentKey} from '@/lib/biometric/config';
import {assertImageRequest,readImage} from '@/lib/biometric/http';
import {reserveEngine,extractPaired} from '@/lib/biometric/worker';
import {consumeCheckin,finishCheckin,checkinError} from '@/lib/checkin/service';
import {RegisterError} from '@/lib/register/service';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
export async function POST(request:Request){let key:Buffer|undefined,image:Buffer|undefined,probe:number[]|undefined,release:(()=>void)|undefined;
 try{
  const access=await requireApiAccount(request,['student']);if(access.response)return access.response;
  assertImageRequest(request,process.env.BETTER_AUTH_URL);key=enrollmentKey();release=reserveEngine();
  const attempt=await consumeCheckin(getAppPool(),access.account,request.headers.get('x-attendai-token')??'');
  image=await readImage(request);const combined=await extractPaired(image,request.signal);probe=combined.embedding;
  const fresh=await requireApiAccount(request,['student']);if(fresh.response)return fresh.response;
  if(request.signal.aborted||fresh.account.id!==access.account.id)throw new RegisterError(409,'Check-in request cancelled. Refresh your attendance.');
  const result=await finishCheckin(getAppPool(),fresh.account,attempt,probe,combined.pad,key,request.signal);
  return NextResponse.json(result,{headers});
 }catch(error){const value=checkinError(error);return NextResponse.json({error:value.error},{status:value.status,headers});}
 finally{key?.fill(0);image?.fill(0);probe?.fill(0);release?.();}
}
