import { betterAuth, type BetterAuthOptions } from "better-auth";

type Settings = {
  database: NonNullable<BetterAuthOptions["database"]>;
  baseURL: string;
  secret: string;
  bootstrap?: boolean;
};

/** Pure factory shared by the server and the trusted, local account CLI. */
export function createAttendAuth({ database, baseURL, secret, bootstrap = false }: Settings) {
  const origin = new URL(baseURL);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.username || origin.password || origin.search || origin.hash
      || origin.pathname !== "/" || (origin.protocol !== "https:" && !(loopback && origin.protocol === "http:"))) {
    throw new Error("BETTER_AUTH_URL must be an HTTPS origin, or HTTP on localhost.");
  }
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 bytes.");
  }

  return betterAuth({
    appName: "Face Recognition Attendance System",
    baseURL: origin.origin,
    basePath: "/api/auth",
    secret,
    database,
    trustedOrigins: [origin.origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !bootstrap,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      // Accounts are provisioned by a trusted operator, not public registration.
      // No email ownership verification is claimed or sent in this milestone.
      requireEmailVerification: false,
    },
    user: {
      modelName: "users",
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    session: {
      modelName: "sessions",
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 15,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: "accounts",
      accountLinking: { enabled: false },
    },
    verification: { modelName: "verifications" },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rate_limits",
      window: 60,
      max: 120,
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    advanced: {
      cookiePrefix: "attendai",
      useSecureCookies: origin.protocol === "https:",
    },
    logger: { level: "warn" },
  });
}
