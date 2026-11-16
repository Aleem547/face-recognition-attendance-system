import "server-only";
import { PostgresDialect } from "kysely";
import { createAttendAuth } from "@/lib/auth/core";
import { getAppPool } from "@/lib/server/database";

const globals = globalThis as unknown as {
  attendaiAuth?: ReturnType<typeof createAttendAuth>;
  attendaiRegistrationAuth?: ReturnType<typeof createAttendAuth>;
};

export function getAuth() {
  if (!globals.attendaiAuth) {
    const baseURL = process.env.BETTER_AUTH_URL;
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!baseURL || !secret) throw new Error("Authentication settings are missing.");
    globals.attendaiAuth = createAttendAuth({
      baseURL,
      secret,
      database: {
        dialect: new PostgresDialect({ pool: getAppPool() }),
        type: "postgres",
        schemaName: "attendai_auth",
      },
      // The public server never enables the trusted CLI's bootstrap setting.
      bootstrap: false,
    });
  }
  return globals.attendaiAuth;
}

/** Only /api/registration may use this instance, after validating its own input. */
export function getStudentRegistrationAuth() {
  if (!globals.attendaiRegistrationAuth) {
    const baseURL = process.env.BETTER_AUTH_URL;
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!baseURL || !secret) throw new Error("Authentication settings are missing.");
    globals.attendaiRegistrationAuth = createAttendAuth({
      baseURL, secret, studentRegistration: true,
      database: { dialect: new PostgresDialect({ pool: getAppPool() }), type: "postgres", schemaName: "attendai_auth" },
    });
  }
  return globals.attendaiRegistrationAuth;
}
