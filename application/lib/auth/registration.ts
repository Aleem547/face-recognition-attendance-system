import type { Pool } from "pg";
import type { Account } from "./identity";
import { actorTransaction, identifier, RegisterError } from "../register/service.ts";
import { assertMutationRequest, readSmallJson } from "../register/http.ts";

const privateHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export type RegistrationStatus = {
  status: "pending" | "approved" | "rejected";
  studentCode: string; name: string; email: string; createdAt: string;
};
function object(value: unknown, allowed: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new RegisterError(400, "Invalid account request.");
  }
  return value as Record<string, unknown>;
}
export function registrationInput(value: unknown) {
  const body = object(value, ["name", "email", "password", "studentCode"]);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const studentCode = typeof body.studentCode === "string" ? body.studentCode.trim().toUpperCase() : "";
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new RegisterError(400, "Enter your full name using 1–100 characters.");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RegisterError(400, "Enter a valid email address.");
  if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128) throw new RegisterError(400, "Use a password with 12–128 characters.");
  if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(studentCode)) throw new RegisterError(400, "Enter your student number using letters, numbers, dots, underscores or hyphens.");
  return { name, email, password: body.password, studentCode };
}
export function registrationError(error: unknown) {
  if (error instanceof RegisterError) return { status: error.status, error: error.message };
  const code = (error && typeof error === "object" ? error : {}) as { code?: string };
  if (code.code === "23505") return { status: 409, error: "This student number or account link already exists. Select the existing unlinked student record, then approve." };
  if (code.code === "23514") return { status: 409, error: "Choose an active student record that is not linked to another account." };
  if (code.code === "42501") return { status: 403, error: "Administrator access is required." };
  if (code.code === "P0002") return { status: 404, error: "Registration unavailable." };
  if (code.code === "40001") return { status: 409, error: "This request has changed or was already reviewed. Refresh the list." };
  return { status: 503, error: "Account registration is temporarily unavailable. Please try again or contact your administrator." };
}
export async function registrationAvailable(pool: Pool) {
  const { rows } = await pool.query("SELECT to_regprocedure('attendai.register_student_account(text,text)') IS NOT NULL AS ready");
  return rows[0]?.ready === true;
}
type RegistrationDependencies = {
  pool: Pool; configuredOrigin: string | undefined;
  signup: (request: Request) => Promise<Response>;
};

/** Shares the real route's HTTP, auth and PostgreSQL logic with isolated tests. */
export function studentRegistrationHandler(dependencies: RegistrationDependencies) {
  return async (request: Request) => {
    let newlyCreatedId: string | undefined;
    try {
      assertMutationRequest(request, dependencies.configuredOrigin);
      const input = registrationInput(await readSmallJson(request));
      if (!await registrationAvailable(dependencies.pool)) throw new RegisterError(503, "Student registration is temporarily unavailable. Please contact your administrator.");
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      headers.delete("cookie");
      const response = await dependencies.signup(new Request(new URL("/api/auth/sign-up/email", dependencies.configuredOrigin), {
        method: "POST", headers,
        body: JSON.stringify({ name: input.name, email: input.email, password: input.password }),
      }));
      if (!response.ok) {
        const status = response.status === 429 ? 429 : response.status >= 500 ? 503 : 409;
        return Response.json({ error: status === 429 ? "Too many registrations. Please wait ten minutes before trying again."
          : status === 503 ? "Registration is temporarily unavailable. Please try again."
          : "An account may already use that email. Try signing in, or use a different email address." }, { status, headers: privateHeaders });
      }
      const created = await response.json() as { user?: { id?: string } };
      if (!created.user?.id) throw new Error("Registration did not return an account.");
      newlyCreatedId = created.user.id;
      await dependencies.pool.query("SELECT attendai.register_student_account($1,$2)", [newlyCreatedId, input.studentCode]);
      newlyCreatedId = undefined;
      const resultHeaders = new Headers(privateHeaders);
      for (const cookie of response.headers.getSetCookie()) resultHeaders.append("Set-Cookie", cookie);
      return Response.json({ status: "pending", redirect: "/access-denied" }, { status: 201, headers: resultHeaders });
    } catch (error) {
      if (newlyCreatedId) {
        // The sign-up instance auto-signs in, so an existing email is an error,
        // not a synthetic successful registration. Only this newly created ID
        // can be cleaned up, and never if a profile was committed for it.
        await dependencies.pool.query(`DELETE FROM attendai_auth.users WHERE id=$1 AND NOT EXISTS
          (SELECT 1 FROM attendai.app_users WHERE auth_provider='better-auth' AND auth_subject=$1)`, [newlyCreatedId]).catch(() => {});
      }
      // Database failures on the public form must not expose administrator
      // instructions or internal permission details.
      const code = (error && typeof error === "object" ? error : {}) as { code?: string };
      const failure = error instanceof RegisterError ? registrationError(error)
        : code.code === "23505" ? { status: 409, error: "An account may already use that email. Try signing in, or contact your administrator." }
        : registrationError(null);
      return Response.json({ error: failure.error }, { status: failure.status, headers: privateHeaders });
    }
  };
}

export async function ownRegistrationStatus(pool: Pool, verifiedAuthUserId: string): Promise<RegistrationStatus | null> {
  if (!await registrationAvailable(pool)) return null;
  const { rows } = await pool.query("SELECT attendai.student_registration_status($1) AS registration", [verifiedAuthUserId]);
  return rows[0]?.registration ?? null;
}
export async function pendingRegistrations(pool: Pool, account: Account) {
  if (account.role !== "admin") throw new RegisterError(403, "Administrator access is required.");
  return actorTransaction(pool, account, async db => {
    const requests = (await db.query(`SELECT r.id,r.student_code,r.created_at,u.display_name,u.email
      FROM attendai.student_registrations r JOIN attendai.app_users u ON u.id=r.app_user_id
      WHERE r.status='pending' ORDER BY r.created_at,r.id LIMIT 100`)).rows;
    const students = (await db.query(`SELECT id,student_code,display_name FROM attendai.students
      WHERE user_id IS NULL AND is_active ORDER BY student_code,id LIMIT 250`)).rows;
    return { requests, students };
  }, true);
}
export async function reviewRegistration(pool: Pool, account: Account, value: unknown) {
  if (account.role !== "admin") throw new RegisterError(403, "Administrator access is required.");
  const body = object(value, ["requestId", "decision", "studentId"]);
  const requestId = identifier(body.requestId, "registration");
  if (body.decision !== "approve" && body.decision !== "reject") throw new RegisterError(400, "Choose approve or reject.");
  const studentId = body.studentId == null || body.studentId === "" ? null : identifier(body.studentId, "student");
  if (body.decision === "reject" && studentId) throw new RegisterError(400, "A rejection cannot link a student.");
  return actorTransaction(pool, account, async db => (await db.query(
    "SELECT attendai.review_student_registration($1,$2,$3) AS result", [requestId, body.decision, studentId],
  )).rows[0].result);
}
