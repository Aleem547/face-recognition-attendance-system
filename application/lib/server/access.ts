import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { resolveIdentity, permissionStatus, type ProfileRow, type UserRole } from "@/lib/auth/identity";
import { getAppPool } from "@/lib/server/database";

export async function currentIdentity(requestHeaders: Headers) {
  return resolveIdentity(requestHeaders, {
    session: values => getAuth().api.getSession({ headers: values }),
    profile: async authUserId => {
      const { rows } = await getAppPool().query<ProfileRow>(
        `SELECT id, display_name, email, role, is_active, auth_subject
         FROM attendai.app_users
         WHERE auth_provider = $1 AND auth_subject = $2`,
        ["better-auth", authUserId],
      );
      return rows[0] ?? null;
    },
  });
}

export async function requirePageAccount(roles?: readonly UserRole[]) {
  const identity = await currentIdentity(await headers());
  if (identity.kind === "anonymous") redirect(roles?.includes("admin") && !roles.includes("student") ? "/login?role=admin" : "/login");
  if (identity.kind === "denied") redirect("/access-denied");
  if (permissionStatus(identity, roles) !== 200) redirect("/access-denied");
  return identity.account;
}

export async function requireApiAccount(request: Request, roles?: readonly UserRole[]) {
  const identity = await currentIdentity(request.headers);
  const status = permissionStatus(identity, roles);
  if (identity.kind !== "authenticated" || status !== 200) {
    return {
      account: null,
      response: NextResponse.json(
        { error: status === 401 ? "Authentication required." : "Access denied." },
        { status, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return { account: identity.account, response: null };
}
