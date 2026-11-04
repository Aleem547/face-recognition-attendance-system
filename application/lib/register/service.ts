// Business logic shared by the server adapter and isolated PostgreSQL tests.
// Pool and Account are type-only imports; this module has no environment access.
import type { Pool, PoolClient } from "pg";
import { courseAnalytics } from "./analytics.ts";
import type { Account } from "../auth/identity";

export class RegisterError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pageSize = 25;
export function identifier(value: unknown, label = "ID"): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new RegisterError(400, `Invalid ${label}.`);
  return value;
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new RegisterError(400, `${label} must contain 1–${max} characters without control characters.`);
  }
  return value.trim();
}
function code(value: unknown, label: string, max = 40) {
  const result = text(value, label, max).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(result)) throw new RegisterError(400, `${label}: use letters, numbers, dots, underscores, or hyphens.`);
  return result;
}
function requireRole(account: Account, roles: string[]) {
  if (!roles.includes(account.role)) throw new RegisterError(403, "Access denied.");
}
function parseCursor(value: string | null): string | null {
  return value === null || value === "" ? null : identifier(value, "page cursor");
}
function page(rows: Record<string, unknown>[], key = "id") {
  const more = rows.length > pageSize;
  const items = rows.slice(0, pageSize);
  return { items, nextCursor: more ? String(items[items.length - 1][key]) : null };
}
export async function actorTransaction<T>(pool: Pool, account: Account, work: (db: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
  identifier(account.id, "account");
  const db = await pool.connect();
  let discardConnection = false;
  try {
    await db.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    await db.query("SET LOCAL statement_timeout = '15s'");
    await db.query("SET LOCAL lock_timeout = '5s'");
    await db.query("SELECT set_config('attendai.actor_id', $1, true)", [account.id]);
    const role = (await db.query("SELECT attendai.actor_role() AS role")).rows[0]?.role;
    if (!role || role !== account.role) throw new RegisterError(403, "Your account access changed. Sign in again.");
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    try { await db.query("ROLLBACK"); } catch { discardConnection = true; }
    throw error;
  } finally { db.release(discardConnection); }
}
const sessionColumns = `s.id, s.session_code, s.course_id, c.course_code, s.title,
  s.starts_at, s.ends_at, s.state`;
async function findSession(db: PoolClient, id: string, lock = false) {
  const { rows } = await db.query(`SELECT ${sessionColumns} FROM attendai.sessions s
    JOIN attendai.courses c ON c.id = s.course_id WHERE s.id = $1 ${lock ? "FOR UPDATE OF s" : ""}`, [id]);
  if (!rows[0]) throw new RegisterError(404, "Session unavailable.");
  return rows[0];
}
async function managedSession(db: PoolClient, id: string) {
  const session = await findSession(db, id, true);
  const result = await db.query("SELECT attendai.manage_course($1) AS allowed", [session.course_id]);
  if (!result.rows[0]?.allowed) throw new RegisterError(404, "Session unavailable.");
  return session;
}
async function courseExists(db: PoolClient, id: string) {
  if (!(await db.query("SELECT id FROM attendai.courses WHERE id = $1", [id])).rowCount) throw new RegisterError(404, "Course unavailable.");
}

export async function readWorkspace(pool: Pool, account: Account, params: URLSearchParams) {
  const resource = params.get("resource") ?? "summary";
  const cursor = parseCursor(params.get("cursor"));
  return actorTransaction(pool, account, async db => {
    if (resource === "analytics") return courseAnalytics(db, cursor);
    if (resource === "summary") {
      return (await db.query(`SELECT
        (SELECT count(*)::int FROM attendai.students) AS students,
        (SELECT count(*)::int FROM attendai.courses WHERE is_active) AS courses,
        (SELECT count(*)::int FROM attendai.sessions WHERE state <> 'cancelled') AS sessions,
        (SELECT count(*)::int FROM attendai.attendance_records a JOIN attendai.sessions s ON s.id = a.session_id
          WHERE s.state <> 'cancelled') AS marks`)).rows[0];
    }
    if (resource === "students") {
      return page((await db.query(`SELECT id, student_code, display_name, user_id, is_active FROM attendai.students
        WHERE ($1::uuid IS NULL OR id > $1) ORDER BY id LIMIT 26`, [cursor])).rows);
    }
    if (resource === "courses") {
      return page((await db.query(`SELECT c.id, c.course_code, c.title, c.teacher_id, u.display_name AS teacher_name, c.is_active
        FROM attendai.courses c JOIN attendai.app_users u ON u.id = c.teacher_id
        WHERE ($1::uuid IS NULL OR c.id > $1) ORDER BY c.id LIMIT 26`, [cursor])).rows);
    }
    if (resource === "sessions") {
      return page((await db.query(`SELECT ${sessionColumns} FROM attendai.sessions s JOIN attendai.courses c ON c.id = s.course_id
        WHERE ($1::uuid IS NULL OR s.id > $1) ORDER BY s.id LIMIT 26`, [cursor])).rows);
    }
    if (resource === "enrollments") {
      const courseId = identifier(params.get("courseId"), "course");
      await courseExists(db, courseId);
      return page((await db.query(`SELECT e.student_id, s.student_code, s.display_name, e.is_active
        FROM attendai.enrollments e JOIN attendai.students s ON s.id = e.student_id
        WHERE e.course_id = $1 AND ($2::uuid IS NULL OR e.student_id > $2) ORDER BY e.student_id LIMIT 26`, [courseId, cursor])).rows, "student_id");
    }
    if (resource === "register") {
      const sessionId = identifier(params.get("sessionId"), "session");
      const session = await findSession(db, sessionId);
      const summary = (await db.query(`SELECT count(*)::int AS roster,
        count(*) FILTER (WHERE a.status = 'present')::int AS present,
        count(*) FILTER (WHERE a.status = 'absent')::int AS absent,
        count(*) FILTER (WHERE a.status = 'late')::int AS late,
        count(*) FILTER (WHERE a.status = 'excused')::int AS excused,
        count(*) FILTER (WHERE a.id IS NULL)::int AS unmarked
        FROM attendai.session_roster r LEFT JOIN attendai.attendance_records a
          ON a.session_id = r.session_id AND a.student_id = r.student_id WHERE r.session_id = $1`, [sessionId])).rows[0];
      const unmarkedOnly = params.get("unmarked") === "true";
      const rows = (await db.query(`SELECT r.student_id, s.student_code, s.display_name,
        a.id AS attendance_id, a.status, a.method, a.revision, a.updated_at, a.change_reason
        FROM attendai.session_roster r JOIN attendai.students s ON s.id = r.student_id
        LEFT JOIN attendai.attendance_records a ON a.session_id = r.session_id AND a.student_id = r.student_id
        WHERE r.session_id = $1 AND ($2::uuid IS NULL OR r.student_id > $2)
          AND (NOT $3::boolean OR a.id IS NULL) ORDER BY r.student_id LIMIT 26`, [sessionId, cursor, unmarkedOnly])).rows;
      return { ...page(rows, "student_id"), session, summary };
    }
    if (resource === "history") {
      const markId = identifier(params.get("attendanceId"), "attendance record");
      if (!(await db.query("SELECT id FROM attendai.attendance_records WHERE id = $1", [markId])).rowCount) throw new RegisterError(404, "Attendance record unavailable.");
      const revisionText = params.get("beforeRevision");
      const before = revisionText === null ? 2147483647 : Number(revisionText);
      if (!Number.isInteger(before) || before < 1 || before > 2147483647) throw new RegisterError(400, "Invalid history cursor.");
      const rows = (await db.query(`SELECT e.event_id::text, e.revision, e.action, e.previous_status, e.new_status, e.method,
        u.display_name AS actor_name, e.reason, e.occurred_at
        FROM attendai.attendance_events e JOIN attendai.app_users u ON u.id = e.actor_id
        WHERE e.attendance_id = $1 AND e.revision < $2 ORDER BY e.revision DESC LIMIT 26`, [markId, before])).rows;
      return { items: rows.slice(0, pageSize), beforeRevision: rows.length > pageSize ? rows[pageSize - 1].revision : null };
    }
    throw new RegisterError(400, "Unknown workspace resource.");
  }, true);
}

function actionBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RegisterError(400, "Use a JSON object.");
  return value as Record<string, unknown>;
}
function fields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !["action", ...allowed].includes(key))) throw new RegisterError(400, "Unexpected request field.");
}
async function accountByEmail(db: PoolClient, value: unknown, roles: string[]) {
  const email = text(value, "Account email", 254).toLowerCase();
  const user = (await db.query(`SELECT id FROM attendai.app_users WHERE lower(btrim(email)) = $1
    AND role = ANY($2::text[]) AND is_active AND auth_provider = 'better-auth'`, [email, roles])).rows[0];
  if (!user) throw new RegisterError(400, "No active account with that email and required role. Create the account first.");
  return user.id;
}
function timestamp(value: unknown) {
  if (typeof value !== "string" || value.length > 40 || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new RegisterError(400, "Use a valid date and time with a time zone.");
  return new Date(value).toISOString();
}
export async function mutateWorkspace(pool: Pool, account: Account, value: unknown) {
  const body = actionBody(value);
  const action = body.action;
  if (typeof action !== "string") throw new RegisterError(400, "An action is required.");
  requireRole(account, ["admin", "teacher"]);
  return actorTransaction(pool, account, async db => {
    if (action === "createStudent") {
      requireRole(account, ["admin"]); fields(body, ["studentCode", "displayName", "accountEmail"]);
      const studentCode = code(body.studentCode, "Student code");
      const displayName = text(body.displayName, "Student name", 100);
      const userId = body.accountEmail ? await accountByEmail(db, body.accountEmail, ["student"]) : null;
      return { student: (await db.query(`INSERT INTO attendai.students(student_code, display_name, user_id)
        VALUES ($1,$2,$3) RETURNING id, student_code, display_name, user_id, is_active`, [studentCode, displayName, userId])).rows[0] };
    }
    if (action === "linkStudent") {
      requireRole(account, ["admin"]); fields(body, ["studentId", "accountEmail"]);
      const studentId = identifier(body.studentId, "student");
      const userId = await accountByEmail(db, body.accountEmail, ["student"]);
      const result = await db.query(`UPDATE attendai.students SET user_id = $2 WHERE id = $1 AND user_id IS NULL
        RETURNING id`, [studentId, userId]);
      if (!result.rowCount) throw new RegisterError(409, "Student unavailable or already linked. Refresh the roster.");
      return { linked: true };
    }
    if (action === "createCourse") {
      requireRole(account, ["admin"]); fields(body, ["courseCode", "title", "teacherEmail"]);
      const ownerId = body.teacherEmail ? await accountByEmail(db, body.teacherEmail, ["teacher", "admin"]) : account.id;
      return { course: (await db.query(`INSERT INTO attendai.courses(course_code, title, teacher_id)
        VALUES ($1,$2,$3) RETURNING id`, [code(body.courseCode, "Course code"), text(body.title, "Course title", 160), ownerId])).rows[0] };
    }
    if (action === "enrollStudent") {
      requireRole(account, ["admin"]); fields(body, ["courseId", "studentCode"]);
      const courseId = identifier(body.courseId, "course"); await courseExists(db, courseId);
      const student = (await db.query("SELECT id FROM attendai.students WHERE student_code = $1 AND is_active", [code(body.studentCode, "Student code")])).rows[0];
      if (!student) throw new RegisterError(400, "No active student with that code.");
      // Separate statements avoid requiring INSERT privileges on is_active.
      const existing = await db.query("SELECT is_active FROM attendai.enrollments WHERE course_id = $1 AND student_id = $2", [courseId, student.id]);
      if (existing.rowCount) await db.query("UPDATE attendai.enrollments SET is_active = true WHERE course_id = $1 AND student_id = $2", [courseId, student.id]);
      else await db.query("INSERT INTO attendai.enrollments(course_id, student_id) VALUES ($1,$2)", [courseId, student.id]);
      return { enrolled: true };
    }
    if (action === "endEnrollment") {
      requireRole(account, ["admin"]); fields(body, ["courseId", "studentId"]);
      const result = await db.query("UPDATE attendai.enrollments SET is_active = false WHERE course_id = $1 AND student_id = $2 RETURNING student_id",
        [identifier(body.courseId, "course"), identifier(body.studentId, "student")]);
      if (!result.rowCount) throw new RegisterError(404, "Enrollment unavailable.");
      return { ended: true };
    }
    if (action === "createSession") {
      fields(body, ["courseId", "sessionCode", "title", "startsAt", "endsAt"]);
      const courseId = identifier(body.courseId, "course"); await courseExists(db, courseId);
      const starts = timestamp(body.startsAt), ends = timestamp(body.endsAt);
      if (Date.parse(ends) <= Date.parse(starts)) throw new RegisterError(400, "End time must follow start time.");
      return { session: (await db.query(`INSERT INTO attendai.sessions(session_code, course_id, title, starts_at, ends_at, created_by)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [code(body.sessionCode, "Session code", 60), courseId,
        text(body.title, "Session title", 160), starts, ends, account.id])).rows[0] };
    }
    if (action === "setSessionState") {
      fields(body, ["sessionId", "state", "expectedState"]);
      const session = await managedSession(db, identifier(body.sessionId, "session"));
      if (session.state !== body.expectedState) throw new RegisterError(409, "Session state changed. Refresh before trying again.");
      if (!["open", "closed", "cancelled"].includes(String(body.state))) throw new RegisterError(400, "Invalid session state.");
      await db.query("UPDATE attendai.sessions SET state = $2 WHERE id = $1", [session.id, body.state]);
      return { state: body.state };
    }
    if (action === "markAttendance") {
      fields(body, ["sessionId", "studentId", "status", "reason", "expectedRevision"]);
      const session = await managedSession(db, identifier(body.sessionId, "session"));
      const studentId = identifier(body.studentId, "student");
      if (!["present", "absent", "late", "excused"].includes(String(body.status))) throw new RegisterError(400, "Invalid attendance status.");
      const reason = text(body.reason, "Reason", 500);
      const expected = body.expectedRevision;
      if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 0 || expected > 2147483646) throw new RegisterError(400, "Invalid expected revision.");
      const member = await db.query("SELECT student_id FROM attendai.session_roster WHERE session_id = $1 AND student_id = $2", [session.id, studentId]);
      if (!member.rowCount) throw new RegisterError(404, "Student is not in this session roster.");
      const previous = (await db.query("SELECT id, revision, status FROM attendai.attendance_records WHERE session_id = $1 AND student_id = $2", [session.id, studentId])).rows[0];
      if ((previous?.revision ?? 0) !== expected) throw new RegisterError(409, "Attendance changed in another request. Refresh and review the current record.");
      if (previous?.status === body.status) return { attendance: previous, unchanged: true };
      if (!previous && session.state !== "open") throw new RegisterError(409, "This session is not open for initial attendance.");
      if (previous && !["open", "closed"].includes(session.state)) throw new RegisterError(409, "This session does not allow corrections.");
      const result = previous
        ? await db.query(`UPDATE attendai.attendance_records SET status = $2, marked_by = $3, change_reason = $4
            WHERE id = $1 AND revision = $5 RETURNING id, revision, status, updated_at`, [previous.id, body.status, account.id, reason, expected])
        : await db.query(`INSERT INTO attendai.attendance_records(session_id, course_id, student_id, status, marked_by, change_reason)
            VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, revision, status, updated_at`, [session.id, session.course_id, studentId, body.status, account.id, reason]);
      if (!result.rowCount) throw new RegisterError(409, "Attendance changed. Refresh and review the current record.");
      return { attendance: result.rows[0], unchanged: false };
    }
    throw new RegisterError(400, "Unknown workspace action.");
  });
}

export function publicRegisterError(error: unknown): { status: number; error: string } {
  if (error instanceof RegisterError) return { status: error.status, error: error.message };
  const db = (error && typeof error === "object" ? error : {}) as { code?: string; message?: string };
  if (db.code === "23505") return { status: 409, error: "That code, account link, enrollment, or attendance record already exists. Refresh before trying again." };
  if (db.code === "42501") return { status: 403, error: "Access denied." };
  if (db.code === "23503") return { status: 409, error: "A referenced record is unavailable. Refresh before trying again." };
  const safeConstraints = ["An existing student account link cannot be reassigned.", "Link an active student account.",
    "Assign an active teacher or administrator.", "Use an active course and student.", "Use an active course.",
    "Enroll at least one active student before opening attendance.", "Record a status for every student before closing attendance.",
    "This session state transition is not allowed."];
  if (db.code === "23514" && safeConstraints.includes(db.message ?? "")) return { status: 409, error: db.message! };
  if (["55P03", "57014", "40P01", "40001"].includes(db.code ?? "")) return { status: 503, error: "The register is busy. Refresh and review the latest record before retrying." };
  // Database objects, query details, environment values, and secrets stay private.
  return { status: 503, error: "The register is temporarily unavailable. Check that migration 003 is applied, then try again." };
}
