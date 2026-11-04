import {NextResponse} from "next/server";
import {requireApiAccount} from "@/lib/server/access";
import {getAppPool} from "@/lib/server/database";
import {assertMutationRequest,readSmallJson} from "@/lib/register/http";
import {readVerification,mutateVerification,verificationError} from "@/lib/verification/service";
import {verificationKey,verificationConfigured} from "@/lib/verification/config";
export const runtime="nodejs";export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
function failure(error:unknown){const value=verificationError(error);return NextResponse.json({error:value.error},{status:value.status,headers});}
export async function GET(request:Request){try{const access=await requireApiAccount(request,["student"]);if(access.response)return access.response;
 return NextResponse.json({...await readVerification(getAppPool(),access.account),configured:verificationConfigured()},{headers});}catch(error){return failure(error);}}
export async function POST(request:Request){try{const access=await requireApiAccount(request,["student"]);if(access.response)return access.response;
 assertMutationRequest(request,process.env.BETTER_AUTH_URL);const input=await readSmallJson(request),action=(input as {action?:string}|null)?.action;
 if(action==="grantComparison"||action==="beginComparison"||action==="beginSessionComparison"){const key=verificationKey();key.fill(0);}
 return NextResponse.json(await mutateVerification(getAppPool(),access.account,input),{headers});}catch(error){return failure(error);}}
