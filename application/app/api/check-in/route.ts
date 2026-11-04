import {NextResponse} from 'next/server';
import {requireApiAccount} from '@/lib/server/access';
import {getAppPool} from '@/lib/server/database';
import {assertMutationRequest,readSmallJson} from '@/lib/register/http';
import {enrollmentConfigured,enrollmentKey} from '@/lib/biometric/config';
import {readCheckin,mutateCheckin,checkinError} from '@/lib/checkin/service';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function failure(error:unknown){const value=checkinError(error);return NextResponse.json({error:value.error},{status:value.status,headers});}
export async function GET(request:Request){try{
 const access=await requireApiAccount(request);if(access.response)return access.response;
 return NextResponse.json({...await readCheckin(getAppPool(),access.account),configured:enrollmentConfigured()},{headers});
}catch(error){return failure(error);}}
export async function POST(request:Request){try{
 const access=await requireApiAccount(request);if(access.response)return access.response;
 assertMutationRequest(request,process.env.BETTER_AUTH_URL);const input=await readSmallJson(request);
 const action=(input as {action?:string}|null)?.action;
 if(action==='beginCheckin'||action==='grantCheckin'){const key=enrollmentKey();key.fill(0);}
 return NextResponse.json(await mutateCheckin(getAppPool(),access.account,input),{headers});
}catch(error){return failure(error);}}
