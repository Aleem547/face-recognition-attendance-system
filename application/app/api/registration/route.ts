import { getAppPool } from "@/lib/server/database";
import { getStudentRegistrationAuth } from "@/lib/auth";
import { studentRegistrationHandler, registrationError } from "@/lib/auth/registration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    return await studentRegistrationHandler({
      pool: getAppPool(), configuredOrigin: process.env.BETTER_AUTH_URL,
      signup: value => getStudentRegistrationAuth().handler(value),
    })(request);
  } catch (error) {
    const failure = registrationError(error);
    return Response.json({ error: failure.error }, { status: failure.status, headers: { "Cache-Control": "no-store" } });
  }
}
