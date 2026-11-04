import type { Pool, PoolClient } from "pg";
import type { Account } from "../auth/identity";
import { actorTransaction, identifier, RegisterError, publicRegisterError } from "../register/service.ts";

async function notice(db: PoolClient) {
  const row = (await db.query(`SELECT version,purpose,title,body FROM attendai.camera_notices WHERE is_current`)).rows[0];
  if (!row) throw new RegisterError(503, "The camera notice is unavailable. Preview remains disabled.");
  return row;
}
async function linkedStudent(db: PoolClient, account: Account) {
  return (await db.query(`SELECT id,student_code,display_name,is_active FROM attendai.students WHERE user_id=$1`, [account.id])).rows[0] ?? null;
}
async function currentChoice(db: PoolClient, studentId: string, version: string) {
  const row = (await db.query(`SELECT choice,revision,notice_version,decided_at,expires_at,
    (choice='granted' AND notice_version=$2 AND expires_at>clock_timestamp()) AS allowed
    FROM attendai.camera_choices WHERE student_id=$1`, [studentId, version])).rows[0];
  return row ?? { choice: "not_recorded", revision: 0, notice_version: null, decided_at: null, expires_at: null, allowed: false };
}
export async function readPrivacy(pool: Pool, account: Account, params = new URLSearchParams()) {
  return actorTransaction(pool, account, async db => {
    const currentNotice = await notice(db);
    if (account.role === "student") {
      const student = await linkedStudent(db, account);
      const before = params.get("beforeRevision");
      const revision = before === null ? 2147483647 : Number(before);
      if (!Number.isInteger(revision) || revision < 1 || revision > 2147483647) throw new RegisterError(400, "Invalid history cursor.");
      if (!student) return { notice: currentNotice, student: null, preference: null, history: [], beforeRevision: null };
      const preference = await currentChoice(db, student.id, currentNotice.version);
      preference.allowed = Boolean(preference.allowed && student.is_active);
      const history = (await db.query(`SELECT revision,notice_version,previous_choice,new_choice,occurred_at,expires_at
        FROM attendai.camera_choice_events WHERE student_id=$1 AND revision<$2 ORDER BY revision DESC LIMIT 26`, [student.id, revision])).rows;
      return { notice: currentNotice, student, preference, history: history.slice(0,25), beforeRevision: history.length > 25 ? history[24].revision : null };
    }
    const cursor = params.get("cursor") ? identifier(params.get("cursor"), "page cursor") : null;
    const rows = (await db.query(`SELECT s.id,s.student_code,s.display_name,
      coalesce(c.choice,'not_recorded') AS choice,c.notice_version,c.decided_at,c.expires_at,
      coalesce(c.choice='granted' AND c.notice_version=$2 AND c.expires_at>clock_timestamp() AND s.is_active,false) AS allowed
      FROM attendai.students s LEFT JOIN attendai.camera_choices c ON c.student_id=s.id
      WHERE ($1::uuid IS NULL OR s.id>$1) ORDER BY s.id LIMIT 26`, [cursor,currentNotice.version])).rows;
    return { notice: currentNotice, students: rows.slice(0,25), nextCursor: rows.length > 25 ? rows[24].id : null };
  }, true);
}
export async function mutatePrivacy(pool: Pool, account: Account, input: unknown) {
  if (account.role !== "student") throw new RegisterError(403, "Only the linked student can change their camera choice.");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new RegisterError(400, "Use a JSON object.");
  const body = input as Record<string, unknown>;
  const action = body.action;
  if (!["grantPreview", "chooseManual", "withdraw"].includes(String(action))) throw new RegisterError(400, "Unknown camera choice action.");
  const allowed = action === "grantPreview" ? ["action", "noticeVersion", "expectedRevision", "acknowledged"] : ["action"];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new RegisterError(400, "Unexpected camera choice field.");
  return actorTransaction(pool, account, async db => {
    // Transaction-scoped lock also serializes two first-time choices when no
    // preference row exists yet. No pooled session lock or identity is retained.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["camera-choice:" + account.id]);
    const currentNotice = await notice(db), student = await linkedStudent(db, account);
    const choice = action === "grantPreview" ? "granted" : action === "withdraw" ? "withdrawn" : "manual";
    if (!student || (choice === "granted" && !student.is_active)) throw new RegisterError(403, "An active student roster link is required for preview.");
    const previous = await currentChoice(db, student.id, currentNotice.version);
    if (choice === "granted") {
      if (body.acknowledged !== true) throw new RegisterError(400, "Read and acknowledge the local preview notice first.");
      if (body.noticeVersion !== currentNotice.version) throw new RegisterError(409, "The camera notice changed. Refresh and review it first.");
      if (typeof body.expectedRevision !== "number" || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) throw new RegisterError(400, "Invalid choice revision.");
      if (body.expectedRevision !== previous.revision) throw new RegisterError(409, "Your choice changed in another request. Refresh before enabling preview.");
    }
    // Withdrawal and choosing manual always win against a stale screen; they
    // require neither re-acceptance of a notice nor an outdated client revision.
    if (previous.choice === choice && previous.notice_version === currentNotice.version && (choice !== "granted" || previous.allowed)) return { preference: previous, unchanged: true };
    if (previous.revision === 0) await db.query(`INSERT INTO attendai.camera_choices(student_id,notice_version,choice) VALUES($1,$2,$3)`, [student.id,currentNotice.version,choice]);
    else await db.query(`UPDATE attendai.camera_choices SET notice_version=$2,choice=$3 WHERE student_id=$1`, [student.id,currentNotice.version,choice]);
    return { preference: await currentChoice(db, student.id, currentNotice.version), unchanged: false };
  });
}
export function privacyError(error: unknown) {
  const safe = publicRegisterError(error);
  const db = error as { code?: string; message?: string } | null;
  if (db?.code === "23514" && db.message === "The camera notice changed. Review the current notice before enabling preview.") return { status: 409, error: db.message };
  return safe.status === 503 ? { status: 503, error: "Camera choices are temporarily unavailable. Check migration 004 and try again. Preview remains disabled." } : safe;
}
