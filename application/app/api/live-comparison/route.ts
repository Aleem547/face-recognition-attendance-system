import {NextResponse} from 'next/server';
import {requireApiAccount} from '@/lib/server/access';
import {getAppPool} from '@/lib/server/database';
import {assertMutationRequest,readSmallJson} from '@/lib/register/http';
import {assertImageRequest,readImage} from '@/lib/biometric/http';
import {RegisterError} from '@/lib/register/service';
import {mutateVerification,consumeComparison,verificationError} from '@/lib/verification/service';
import {verificationKey} from '@/lib/verification/config';
import {reserveEngine} from '@/lib/biometric/worker';
import {MODEL_VERSION} from '@/lib/biometric/crypto';
import {LIVE_NOTICE,liveLeases} from '@/lib/live-comparison/leases';
import {assertLiveReference,liveSimilarity,cancelLiveAttempt} from '@/lib/live-comparison/reference';
import {liveWorker} from '@/lib/live-comparison/worker';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
export async function POST(request:Request){let image:Buffer|undefined,key:Buffer|undefined,probe:number[]|undefined,release:(()=>void)|undefined,claim:ReturnType<ReturnType<typeof liveLeases>['claim']>|undefined;
 try{
  const access=await requireApiAccount(request,['student']);if(access.response)return access.response;
  const account=access.account,pool=getAppPool(),leases=liveLeases();
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()==='application/json'){
   assertMutationRequest(request,process.env.BETTER_AUTH_URL);const raw=await readSmallJson(request);
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new RegisterError(400,'Use a live comparison action.');const body=raw as Record<string,unknown>;
   if(body.action==='start'){
    if(Object.keys(body).sort().join(',')!=='acknowledged,action,noticeVersion'||body.acknowledged!==true||body.noticeVersion!==LIVE_NOTICE)throw new RegisterError(400,'Read and choose the live comparison notice for this run.');
    key=verificationKey();const issued=await mutateVerification(pool,account,{action:'beginComparison'}) as {token:string};const attempt=await consumeComparison(pool,account,issued.token);
    const lease=leases.open(account.id,issued.token,attempt);return NextResponse.json({token:issued.token,...lease,scoresSaved:false,attendanceChanged:false,padProcessed:false},{headers});
   }
   if(body.action==='stop'&&Object.keys(body).sort().join(',')==='action,token'&&typeof body.token==='string'){
    const attempt=leases.close(account.id,body.token);if(attempt)await cancelLiveAttempt(pool,account,attempt);return NextResponse.json({stopped:true},{headers});
   }
   throw new RegisterError(400,'Unknown live comparison action.');
  }
  assertImageRequest(request,process.env.BETTER_AUTH_URL);claim=leases.claim(account.id,request.headers.get('x-attendai-live-token')??'');
  const signal=AbortSignal.any([request.signal,claim.signal]);claim.assertCurrent();await assertLiveReference(pool,account,claim.attempt);
  image=await readImage(request);if(signal.aborted)throw new RegisterError(409,'Live comparison stopped.');release=reserveEngine();const started=Date.now();probe=await liveWorker().extract(image,signal);
  const fresh=await requireApiAccount(request,['student']);if(fresh.response)return fresh.response;if(fresh.account.id!==account.id)throw new RegisterError(409,'Live comparison stopped.');claim.assertCurrent();if(signal.aborted)throw new RegisterError(409,'Live comparison stopped.');
  key=verificationKey();const similarity=await liveSimilarity(pool,fresh.account,claim.attempt,probe,key);claim.assertCurrent();if(signal.aborted)throw new RegisterError(409,'Live comparison stopped.');
  return NextResponse.json({similarity,frame:claim.frame,processedAt:new Date().toISOString(),expiresAt:claim.expiresAt,processingMs:Date.now()-started,modelVersion:MODEL_VERSION,scoresSaved:false,attendanceChanged:false,padProcessed:false},{headers});
 }catch(error){const value=verificationError(error);return NextResponse.json({error:value.error,retryable:value.status===422||value.status===429||value.status===503&&/busy/i.test(value.error)},{status:value.status,headers});}
 finally{image?.fill(0);probe?.fill(0);key?.fill(0);release?.();claim?.finish();}
}
