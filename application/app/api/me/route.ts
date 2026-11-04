import { requireApiAccount } from "@/lib/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireApiAccount(request);
  if (access.response) return access.response;
  return Response.json({ user: access.account }, { headers: { "Cache-Control": "no-store" } });
}
