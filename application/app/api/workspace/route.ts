import { NextResponse } from "next/server";
import { requireApiAccount } from "@/lib/server/access";
import { getAppPool } from "@/lib/server/database";
import { readWorkspace, mutateWorkspace, publicRegisterError } from "@/lib/register/service";
import { assertMutationRequest, readSmallJson } from "@/lib/register/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function failure(error: unknown) {
  const result = publicRegisterError(error);
  return NextResponse.json({ error: result.error }, { status: result.status, headers: privateHeaders });
}
export async function GET(request: Request) {
  try {
    const access = await requireApiAccount(request);
    if (access.response) return access.response;
    return NextResponse.json(await readWorkspace(getAppPool(), access.account, new URL(request.url).searchParams), { headers: privateHeaders });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const access = await requireApiAccount(request, ["admin", "teacher"]);
    if (access.response) return access.response;
    assertMutationRequest(request, process.env.BETTER_AUTH_URL);
    const result = await mutateWorkspace(getAppPool(), access.account, await readSmallJson(request));
    return NextResponse.json(result, { headers: privateHeaders });
  } catch (error) { return failure(error); }
}
