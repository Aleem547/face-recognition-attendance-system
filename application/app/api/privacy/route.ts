import { NextResponse } from "next/server";
import { requireApiAccount } from "@/lib/server/access";
import { getAppPool } from "@/lib/server/database";
import { assertMutationRequest, readSmallJson } from "@/lib/register/http";
import { readPrivacy, mutatePrivacy, privacyError } from "@/lib/privacy/service";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
function failure(error: unknown) { const value=privacyError(error);return NextResponse.json({error:value.error},{status:value.status,headers}); }
export async function GET(request: Request) {
  try { const access=await requireApiAccount(request);if(access.response)return access.response;
    return NextResponse.json(await readPrivacy(getAppPool(),access.account,new URL(request.url).searchParams),{headers});
  } catch(error){return failure(error);}
}
export async function POST(request: Request) {
  try { const access=await requireApiAccount(request,["student"]);if(access.response)return access.response;
    assertMutationRequest(request,process.env.BETTER_AUTH_URL);
    return NextResponse.json(await mutatePrivacy(getAppPool(),access.account,await readSmallJson(request)),{headers});
  } catch(error){return failure(error);}
}
