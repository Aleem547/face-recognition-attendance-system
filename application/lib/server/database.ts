import "server-only";
import { Pool } from "pg";

const globals = globalThis as unknown as { attendaiPool?: Pool };

export function getAppPool(): Pool {
  if (globals.attendaiPool) return globals.attendaiPool;
  const connectionString = process.env.APP_DATABASE_URL;
  if (!connectionString) throw new Error("Run the Face Recognition Attendance System authentication configuration script first.");
  const address = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(address.protocol)
      || decodeURIComponent(address.username) !== "attendai_app") {
    throw new Error("APP_DATABASE_URL must use the restricted attendai_app role.");
  }
  const pool = new Pool({
    connectionString,
    max: 3,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
    allowExitOnIdle: true,
  });
  pool.on("error", () => console.error("An idle Face Recognition Attendance System database connection failed."));
  globals.attendaiPool = pool;
  return pool;
}
