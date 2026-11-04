import { requireApiAccount } from "@/lib/server/access";
import { getAppPool } from "@/lib/server/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireApiAccount(request, ["admin"]);
  if (access.response) return access.response;
  const { rows } = await getAppPool().query(
    `SELECT id, display_name, email, role, is_active, created_at
     FROM attendai.app_users WHERE auth_provider = $1
     ORDER BY created_at DESC LIMIT 100`, ["better-auth"],
  );
  return Response.json({ users: rows }, { headers: { "Cache-Control": "no-store" } });
}
