import { requireApiAccount } from "@/lib/server/access";
import { getAppPool } from "@/lib/server/database";
import { assertMutationRequest, readSmallJson } from "@/lib/register/http";
import { pendingRegistrations, reviewRegistration, registrationError } from "@/lib/auth/registration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function failure(error: unknown) {
  const result = registrationError(error);
  return Response.json({ error: result.error }, { status: result.status, headers: privateHeaders });
}
export async function GET(request: Request) {
  try {
    const access = await requireApiAccount(request, ["admin"]);
    if (access.response) return access.response;
    return Response.json(await pendingRegistrations(getAppPool(), access.account), { headers: privateHeaders });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const access = await requireApiAccount(request, ["admin"]);
    if (access.response) return access.response;
    assertMutationRequest(request, process.env.BETTER_AUTH_URL);
    return Response.json(await reviewRegistration(getAppPool(), access.account, await readSmallJson(request)), { headers: privateHeaders });
  } catch (error) { return failure(error); }
}
