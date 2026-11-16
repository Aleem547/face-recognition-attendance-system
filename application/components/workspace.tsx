"use client";
import CourseAnalyticsPanel from "./course-analytics";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Activity, ArrowDownToLine, BookOpen, CheckCheck, ClipboardCheck, Fingerprint, GraduationCap, History, LayoutDashboard, Menu, RefreshCw, ShieldCheck, Users, X } from "lucide-react";
import AccountMenu from "@/components/account-menu";
import type { Account } from "@/lib/auth/identity";
import type { WorkspaceTransport } from "@/lib/demo/store";
import type { CourseRow, EnrollmentRow, Page, ReceiptRow, RegisterPage, RegisterRow, SessionRow, StudentRow, Summary } from "@/lib/register/contracts";
import { registerCsv } from "@/lib/register/csv";
import { selectedSessionId } from "@/lib/checkin/outcome";

export type Section = "overview" | "students" | "courses" | "sessions" | "attendance" | "privacy";
type HistoryPage = { items: ReceiptRow[]; beforeRevision: number | null };
const emptyPage = <T,>(): Page<T> => ({ items: [], nextCursor: null });
async function liveApi<T>(params: Record<string, string>, body?: unknown): Promise<T> {
  const response = await fetch("/api/workspace?" + new URLSearchParams(params), {
    method: body ? "POST" : "GET", cache: "no-store", credentials: "same-origin",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.location.assign("/login");
    throw new Error(typeof result.error === "string" ? result.error : "Request failed. Please try again.");
  }
  return result as T;
}
function date(value: string | null) { return value ? new Date(value).toLocaleString() : "—"; }
function download(contents: string, filename: string) {
  const url = URL.createObjectURL(new Blob(["\uFEFF" + contents], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

export default function Workspace({ account, initialSessionId = "", initialSection, transport, demo = false }: { account: Account; initialSessionId?: string; initialSection?: Section; transport?: WorkspaceTransport; demo?: boolean }) {
  const api = transport ?? liveApi;
  const featurePath = (view: string) => demo ? "/demo?view=" + view : "/" + view;
  const admin = account.role === "admin", staff = account.role !== "student";
  const [section, setSection] = useState<Section>(initialSection ?? (selectedSessionId(initialSessionId) ? "attendance" : "overview"));
  const [menu, setMenu] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [students, setStudents] = useState<Page<StudentRow>>(emptyPage);
  const [courses, setCourses] = useState<Page<CourseRow>>(emptyPage);
  const [sessions, setSessions] = useState<Page<SessionRow>>(emptyPage);
  const [courseId, setCourseId] = useState("");
  const [sessionId, setSessionId] = useState(selectedSessionId(initialSessionId));
  const [enrollments, setEnrollments] = useState<Page<EnrollmentRow>>(emptyPage);
  const [register, setRegister] = useState<RegisterPage | null>(null);
  const [unmarked, setUnmarked] = useState(false);
  const [receiptId, setReceiptId] = useState("");
  const [receipts, setReceipts] = useState<HistoryPage | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [zone, setZone] = useState("");
  const pending = useRef(false);
  const dataVersion = useRef(0), registerVersion = useRef(0), courseVersion = useRef(0), receiptVersion = useRef(0);

  const loadInitial = useCallback(async () => {
    const version = ++dataVersion.current;
    const values = await Promise.all([
      api<Summary>({ resource: "summary" }), api<Page<StudentRow>>({ resource: "students" }),
      api<Page<CourseRow>>({ resource: "courses" }), api<Page<SessionRow>>({ resource: "sessions" }),
    ]);
    if (version !== dataVersion.current) return;
    setSummary(values[0]); setStudents(values[1]); setCourses(values[2]); setSessions(values[3]);
    setCourseId(previous => previous || values[2].items[0]?.id || "");
    setSessionId(previous => previous || values[3].items[0]?.id || "");
  }, [api]);
  const loadRegister = useCallback(async () => {
    const version = ++registerVersion.current;
    if (!sessionId) { setRegister(null); return; }
    const value = await api<RegisterPage>({ resource: "register", sessionId, unmarked: String(unmarked) });
    if (version === registerVersion.current) setRegister(value);
  }, [sessionId, unmarked, api]);
  const loadEnrollments = useCallback(async () => {
    const version = ++courseVersion.current;
    if (!courseId) { setEnrollments(emptyPage()); return; }
    const value = await api<Page<EnrollmentRow>>({ resource: "enrollments", courseId });
    if (version === courseVersion.current) setEnrollments(value);
  }, [courseId, api]);
  const loadReceipts = useCallback(async () => {
    const version = ++receiptVersion.current;
    if (!receiptId) { setReceipts(null); return; }
    const value = await api<HistoryPage>({ resource: "history", attendanceId: receiptId });
    if (version === receiptVersion.current) setReceipts(value);
  }, [receiptId, api]);
  useEffect(() => {
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    void loadInitial().catch(e => setError(e.message)).finally(() => setLoading(false));
    return () => { dataVersion.current++; };
  }, [loadInitial]);
  useEffect(() => {
    setRegister(null); setReceiptId("");
    void loadRegister().catch(e => setError(e.message));
    return () => { registerVersion.current++; };
  }, [loadRegister]);
  useEffect(() => {
    setEnrollments(emptyPage());
    void loadEnrollments().catch(e => setError(e.message));
    return () => { courseVersion.current++; };
  }, [loadEnrollments]);
  useEffect(() => {
    setReceipts(null); void loadReceipts().catch(e => setError(e.message));
    return () => { receiptVersion.current++; };
  }, [loadReceipts]);

  async function refresh() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await Promise.all([loadInitial(), loadRegister(), loadEnrollments(), loadReceipts()]); }
    catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  async function mutate(action: string, fields: Record<string, unknown>, message: string): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    let saved = false;
    try {
      const result = await api<{ session?: { id: string }; attendance?: { id: string; revision: number }; unchanged?: boolean }>({}, { action, ...fields });
      saved = true;
      setNotice(result.unchanged ? "The saved status already matches. No correction was added." : message);
      if (action === "createSession" && result.session) { setSessionId(result.session.id); setSection("attendance"); }
      if (result.attendance) setReceiptId(result.attendance.id);
      await Promise.all([loadInitial(), loadRegister(), loadEnrollments(), loadReceipts()]);
      return true;
    } catch (e) {
      setError(saved ? "Your change was saved, but the latest view could not load. Refresh the workspace to verify it." : (e as Error).message);
      if (!saved) { try { await Promise.all([loadRegister(), loadReceipts()]); } catch { /* Keep original error. */ } }
      return saved;
    } finally { pending.current = false; setBusy(false); }
  }
  async function more<T>(resource: string, current: Page<T>, setter: (fn: (previous: Page<T>) => Page<T>) => void, extra: Record<string, string> = {}) {
    if (!current.nextCursor || pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const value = await api<Page<T>>({ resource, cursor: current.nextCursor, ...extra });
      setter(previous => previous.nextCursor === current.nextCursor ? { items: [...previous.items, ...value.items], nextCursor: value.nextCursor } : previous);
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  async function moreRegister() {
    if (!register?.nextCursor || pending.current) return;
    pending.current = true; setBusy(true);
    const version = registerVersion.current, cursor = register.nextCursor;
    try {
      const value = await api<RegisterPage>({ resource: "register", sessionId, cursor, unmarked: String(unmarked) });
      if (version === registerVersion.current) setRegister(previous => previous?.nextCursor === cursor ? { ...value, items: [...previous.items, ...value.items] } : previous);
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  async function moreHistory() {
    if (!receipts?.beforeRevision || pending.current) return;
    pending.current = true; setBusy(true); const version = receiptVersion.current;
    try {
      const value = await api<HistoryPage>({ resource: "history", attendanceId: receiptId, beforeRevision: String(receipts.beforeRevision) });
      if (version === receiptVersion.current) setReceipts(previous => ({ ...value, items: [...(previous?.items ?? []), ...value.items] }));
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  async function exportSession() {
    if (!sessionId || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      // A stable revision vector avoids silently mixing pages during editing.
      const collect = async () => {
        const rows: RegisterRow[] = []; let cursor: string | null = null; let selected: SessionRow | null = null;
        do {
          const value: RegisterPage = await api<RegisterPage>({ resource: "register", sessionId, ...(cursor ? { cursor } : {}) });
          selected = value.session; rows.push(...value.items); cursor = value.nextCursor;
        } while (cursor);
        return { rows, selected: selected! };
      };
      const first = await collect(), second = await collect();
      const vector = (rows: RegisterRow[]) => JSON.stringify(rows.map(r => [r.student_id, r.revision]));
      if (vector(first.rows) !== vector(second.rows) || first.selected.state !== second.selected.state) throw new Error("Attendance changed during export. Refresh and export again.");
      download(registerCsv(second.rows.map(row => ({ ...row, session_code: second.selected.session_code, course_code: second.selected.course_code, status: row.status ?? "unmarked" }))), "face-recognition-attendance-system-" + second.selected.session_code.replace(/[^a-zA-Z0-9_-]/g, "_") + ".csv");
      setNotice("Session CSV exported with saved revisions and correction reasons.");
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }

  const nav = [
    { id: "overview" as Section, label: "Overview", Icon: LayoutDashboard },
    ...(staff ? [{ id: "students" as Section, label: "Students", Icon: Users }] : []),
    { id: "courses" as Section, label: staff ? "Courses" : "My courses", Icon: BookOpen },
    { id: "sessions" as Section, label: "Class sessions", Icon: GraduationCap },
    { id: "attendance" as Section, label: staff ? "Attendance" : "My attendance", Icon: ClipboardCheck },
    { id: "privacy" as Section, label: "Privacy & safety", Icon: ShieldCheck },
  ];
  const title = nav.find(item => item.id === section)?.label ?? "Workspace";
  const currentSession = register?.session;
  const totals = register?.summary;
  const denominator = totals ? totals.roster - totals.excused : 0;
  const rate = totals && denominator > 0 ? Math.round(100 * (totals.present + totals.late) / denominator) : null;
  const selectedCourse = courses.items.find(item => item.id === courseId);
  return <div className="app-shell register-app">
    <aside className={`sidebar ${menu ? "is-open" : ""}`}>
      <div className="brand"><div className="brand-mark"><Fingerprint size={22}/></div><div><strong>Face Recognition<br/>Attendance System</strong><small>INTELLIGENT ATTENDANCE</small></div></div>
      <div className="sidebar-kicker">WORKSPACE</div><nav className="nav-list" aria-label="Main navigation">{nav.map(({ id, label, Icon }) => <button key={id} className={`nav-item ${section === id ? "active" : ""}`} aria-current={section === id ? "page" : undefined} onClick={() => { setSection(id); setMenu(false); }}><Icon size={18}/>{label}</button>)}<Link href={featurePath("check-in")} className="nav-item"><Fingerprint size={18}/>Face check-in</Link><Link href={featurePath("guide")} className="nav-item"><BookOpen size={18}/>Workspace guide</Link><Link href={featurePath("camera")} className="nav-item"><ShieldCheck size={18}/>Camera & consent</Link>{(account.role === "student" || demo) && <Link href={featurePath("enrollment")} className="nav-item"><ShieldCheck size={18}/>Face enrollment</Link>}{(account.role === "student" || demo) && <Link href={featurePath("verification")} className="nav-item"><ShieldCheck size={18}/>Face comparison</Link>}</nav>
      <div className="sidebar-bottom"><div className="safety-dot"/><strong>Saved register</strong><p>Staff attendance and optional experimental face check-in save audited records.</p><div className="version">v0.6.0 · Local completion</div></div>
    </aside>
    <main className="main-area"><header className="topbar"><button className="mobile-menu" aria-label="Toggle menu" onClick={() => setMenu(v => !v)}>{menu ? <X/> : <Menu/>}</button><div className="breadcrumbs">FACE RECOGNITION ATTENDANCE SYSTEM / <strong>{title}</strong></div><div className="top-actions"><span className="demo-chip"><span className="online-dot"/> {demo ? "TAB SANDBOX" : "DATABASE ATTENDANCE"}</span><AccountMenu account={account} demo={demo}/></div></header>
      <div className="content"><div className="page-head"><div><p className="eyebrow">{staff ? "CLASSROOM WORKSPACE" : "YOUR PERSONAL REGISTER"}</p><h1>{title}</h1><p>{staff ? "A saved record for every class. A clear receipt for every correction." : "Your linked courses and personal attendance records."}</p></div><button className="btn outline" onClick={() => void refresh()} disabled={busy}><RefreshCw size={15}/> Refresh workspace</button></div>
        {error && <div className="register-alert error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError("")}><X size={16}/></button></div>}
        {notice && <div className="register-alert success" role="status">{notice}<button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={16}/></button></div>}
        {loading && <section className="panel" role="status">Loading your saved workspace…</section>}
        {!loading && summary && <>
          {section === "overview" && <>
            <CourseAnalyticsPanel transport={transport}/>
            <div className="hero-banner"><div className="hero-copy"><span className="banner-kicker"><ShieldCheck size={14}/> ACCOUNTABLE ATTENDANCE</span><h2>A clear record.<br/>A calmer classroom.</h2><p>Class rosters stay fixed when attendance opens. Every saved correction has a reason and a revision.</p><button className="hero-link" onClick={() => setSection("attendance")}>Open your register →</button></div><div className="orb-art" aria-hidden="true"><div className="orb orb-one"/><Fingerprint size={76} strokeWidth={0.85}/></div></div>
            <div className="stats-grid"><Stat label={staff ? "Students in your scope" : "My roster link"} value={summary.students}/><Stat label="Active courses" value={summary.courses}/><Stat label="Class sessions" value={summary.sessions}/><Stat label={staff ? "Saved attendance marks" : "My saved marks"} value={summary.marks}/></div>
            <div className="panel-grid"><section className="panel"><h3>{staff ? "Start a saved class" : "Your attendance workspace"}</h3><p className="note">{admin ? "Add students, create a course, and enroll its members. Then schedule a session and open attendance." : staff ? "Your administrator assigns courses and enrollments. Schedule a session for your course, then open attendance to capture its roster." : "Your administrator links your student account to a roster entry. You can then view your courses, marks, and correction receipts here."}</p><button className="text-link" onClick={() => setSection(admin ? "students" : "courses")}>{admin ? "Add students →" : "View courses →"}</button></section><section className="panel"><h3>Every number has a denominator</h3><p className="note">An open register shows progress and the unmarked queue. The final attendance rate appears after every status is saved and the session closes. Excused entries are excluded from its denominator.</p><span className="pill neutral">Present + late count as attending</span></section></div>
          </>}
          {section === "students" && staff && <>
            {admin && <ActionForm title="Add a student" action="createStudent" submitLabel="Save student" busy={busy} mutate={mutate} message="Student saved." fields={[{ name: "studentCode", label: "Student code", required: true, maxLength: 40, placeholder: "STU-001" }, { name: "displayName", label: "Student name", required: true, maxLength: 100, placeholder: "Demo Student 001" }, { name: "accountEmail", label: "Student account email (optional)", type: "email", maxLength: 254 }]} help="Create roster entries with synthetic data. An optional email links an existing student account to its own attendance view."/>}
            <section className="panel"><h3>{admin ? "Student roster" : "Students in your courses"}</h3><div className="table-scroll"><table><thead><tr><th>STUDENT CODE</th><th>NAME</th><th>ACCOUNT LINK</th></tr></thead><tbody>{students.items.map(row => <tr key={row.id}><td className="mono">{row.student_code}</td><td>{row.display_name}</td><td>{row.user_id ? <span className="pill success">Linked</span> : admin ? <LinkStudent row={row} busy={busy} onLink={email => mutate("linkStudent", { studentId: row.id, accountEmail: email }, "Student account linked.")}/> : "Unlinked"}</td></tr>)}</tbody></table></div><Empty count={students.items.length} text="No students are available in your scope yet."/><More cursor={students.nextCursor} busy={busy} onClick={() => void more("students", students, setStudents)}/></section>
          </>}
          {section === "courses" && <>
            {admin && <ActionForm title="Create a course" action="createCourse" submitLabel="Save course" busy={busy} mutate={mutate} message="Course saved." fields={[{ name: "courseCode", label: "Course code", required: true, maxLength: 40, placeholder: "CS-101" }, { name: "title", label: "Course title", required: true, maxLength: 160, placeholder: "Introduction to Computer Science" }, { name: "teacherEmail", label: "Teacher account email (optional)", type: "email", maxLength: 254 }]} help="Leave teacher email empty to assign the course to your administrator account."/>}
            <section className="panel"><h3>{staff ? "Available courses" : "My courses"}</h3><div className="table-scroll"><table><thead><tr><th>CODE</th><th>COURSE</th><th>TEACHER</th><th>ACTION</th></tr></thead><tbody>{courses.items.map(row => <tr key={row.id}><td className="mono">{row.course_code}</td><td>{row.title}</td><td>{row.teacher_name}</td><td><button className="small-button" onClick={() => setCourseId(row.id)}>View enrollment</button></td></tr>)}</tbody></table></div><Empty count={courses.items.length} text="No courses are assigned yet."/><More cursor={courses.nextCursor} busy={busy} onClick={() => void more("courses", courses, setCourses)}/></section>
            {courseId && <section className="panel"><h3>Enrollment · {selectedCourse?.course_code ?? "selected course"}</h3>{admin && <ActionForm compact title="Enroll a student" action="enrollStudent" submitLabel="Enroll student" busy={busy} mutate={mutate} message="Enrollment saved. Already-open session rosters stay unchanged." fixed={{ courseId }} fields={[{ name: "studentCode", label: "Student code to enroll", required: true, maxLength: 40 }]} help="Enrollment changes apply to sessions opened after the change."/>}<div className="table-scroll"><table><thead><tr><th>CODE</th><th>STUDENT</th><th>ENROLLMENT</th>{admin && <th>ACTION</th>}</tr></thead><tbody>{enrollments.items.map(row => <tr key={row.student_id}><td className="mono">{row.student_code}</td><td>{row.display_name}</td><td>{row.is_active ? "Active" : "Ended"}</td>{admin && <td>{row.is_active && <button className="small-button" disabled={busy} onClick={() => void mutate("endEnrollment", { courseId, studentId: row.student_id }, "Enrollment ended. Existing session rosters are preserved.")}>End enrollment</button>}</td>}</tr>)}</tbody></table></div><Empty count={enrollments.items.length} text="No enrollment entries are available."/><More cursor={enrollments.nextCursor} busy={busy} onClick={() => void more("enrollments", enrollments, setEnrollments, { courseId })}/></section>}
          </>}
          {section === "sessions" && <>
            {staff && <section className="panel"><h3>Schedule a class session</h3><SessionForm courses={courses.items} busy={busy} zone={zone} onSave={values => mutate("createSession", values, "Session saved. Open attendance when its enrollment is ready.")}/><More cursor={courses.nextCursor} busy={busy} label="Load more courses" onClick={() => void more("courses", courses, setCourses)}/></section>}
            <section className="panel"><h3>Class sessions</h3><p className="note">Times shown in {zone || "your device’s time zone"}. Opening a session captures its current active enrollment.</p><div className="table-scroll"><table><thead><tr><th>SESSION</th><th>COURSE</th><th>START</th><th>STATE</th><th>ACTION</th></tr></thead><tbody>{sessions.items.map(row => <tr key={row.id}><td><strong>{row.title}</strong><br/><span className="mono">{row.session_code}</span></td><td>{row.course_code}</td><td>{date(row.starts_at)}</td><td><span className="pill neutral">{row.state}</span></td><td><button className="small-button" onClick={() => { setSessionId(row.id); setSection("attendance"); }}>Open register</button></td></tr>)}</tbody></table></div><Empty count={sessions.items.length} text="No class sessions have been scheduled yet."/><More cursor={sessions.nextCursor} busy={busy} onClick={() => void more("sessions", sessions, setSessions)}/></section>
          </>}
          {section === "attendance" && <>
            <section className="panel"><div className="register-toolbar"><label className="register-select-label" htmlFor="selected-session">Class session<select id="selected-session" value={sessionId} onChange={event => setSessionId(event.target.value)} disabled={busy}><option value="">Select a session</option>{sessions.items.map(row => <option key={row.id} value={row.id}>{row.session_code} · {row.course_code} · {row.state}</option>)}{currentSession && !sessions.items.some(row => row.id === currentSession.id) && <option value={currentSession.id}>{currentSession.session_code} · {currentSession.state}</option>}</select></label><button className="btn outline" disabled={!register || busy} onClick={() => void exportSession()}><ArrowDownToLine size={15}/> Export session CSV</button></div><More cursor={sessions.nextCursor} busy={busy} label="Load more sessions" onClick={() => void more("sessions", sessions, setSessions)}/>
              {currentSession ? <><div className="register-session-head"><div><h3>{currentSession.title}</h3><p className="note">{currentSession.course_code} · {date(currentSession.starts_at)} · {currentSession.state}</p></div>{staff && <div className="register-actions">{currentSession.state === "scheduled" && <><button className="btn primary" disabled={busy} onClick={() => void mutate("setSessionState", { sessionId, state: "open", expectedState: currentSession.state }, "Attendance opened. The session roster is now fixed.")}>Open attendance</button><button className="btn outline" disabled={busy} onClick={() => void mutate("setSessionState", { sessionId, state: "cancelled", expectedState: currentSession.state }, "Scheduled session cancelled.")}>Cancel session</button></>}{currentSession.state === "open" && <button className="btn primary" disabled={busy || (totals?.unmarked ?? 1) > 0} onClick={() => void mutate("setSessionState", { sessionId, state: "closed", expectedState: currentSession.state }, "Attendance closed. Corrections remain available with a reason.")}>Close attendance</button>}</div>}</div>
                {totals && <><div className="register-counts">{([['Roster', totals.roster], ['Present', totals.present], ['Late', totals.late], ['Absent', totals.absent], ['Excused', totals.excused], ['Unmarked', totals.unmarked]] as const).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><p className="note">{currentSession.state === "closed" ? rate === null ? "Final attendance rate: N/A — all roster entries are excused." : `Final attendance rate: ${rate}% = (${totals.present} present + ${totals.late} late) ÷ (${totals.roster} roster − ${totals.excused} excused).` : currentSession.state === "scheduled" ? "Open attendance to capture the roster. Enrollment changes are still allowed." : "Final attendance rate appears after the register is complete and closed. Classes with automatic timing fill unmarked entries as Absent after class end; other classes require staff completion."}{!staff && " These counts include only your own roster entry."}</p></>}
              </> : <p className="note">{sessionId ? "Loading the selected session…" : "Create a class session, then select it here."}</p>}
            </section>
            {register && currentSession && ["open", "closed"].includes(currentSession.state) && <section className="panel"><div className="panel-title"><div><h3>{staff ? "Frozen session register" : "My attendance record"}</h3><p>{staff ? "Statuses save only after the server confirms them." : "Your own saved status and its correction history."}</p></div><label className="register-checkbox"><input type="checkbox" checked={unmarked} onChange={event => setUnmarked(event.target.checked)} disabled={busy}/> Unmarked only</label></div><div className="table-scroll"><table className="register-table"><thead><tr><th>STUDENT</th><th>SAVED STATUS</th><th>UPDATED</th><th>{staff ? "RECORD / CORRECT" : "RECEIPT"}</th></tr></thead><tbody>{register.items.map(row => <tr key={row.student_id}><td><strong>{row.display_name}</strong><br/><span className="mono">{row.student_code}</span></td><td><span className={`pill ${["present", "late"].includes(row.status ?? "") ? "success" : "pending"}`}>{row.status ?? "Unmarked"}</span>{row.revision && <small className="register-revision">Revision {row.revision} · {row.method === "experimental_face" ? "Experimental face check-in" : row.method === "automatic_absence" ? "Automatic absence" : "Staff recorded"}</small>}</td><td>{date(row.updated_at)}{row.attendance_id && <button className="text-link receipt-link" onClick={() => setReceiptId(row.attendance_id!)}><History size={13}/> View receipt</button>}</td><td>{staff ? <MarkForm key={`${row.student_id}-${row.revision ?? 0}`} row={row} busy={busy} onSave={values => mutate("markAttendance", { sessionId, studentId: row.student_id, expectedRevision: row.revision ?? 0, ...values }, row.revision ? "Correction saved with a new receipt." : "Attendance saved with its receipt.")}/> : row.attendance_id ? <button className="small-button" onClick={() => setReceiptId(row.attendance_id!)}>View history</button> : "Awaiting teacher"}</td></tr>)}</tbody></table></div><Empty count={register.items.length} text={unmarked ? "No unmarked entries in this view." : "No roster entry is available for this account."}/><More cursor={register.nextCursor} busy={busy} onClick={() => void moreRegister()}/></section>}
            {receiptId && <section className="panel" aria-label="Attendance receipt"><div className="panel-title"><div><h3>Attendance receipt</h3><p>Record {receiptId}</p></div><button className="small-button" onClick={() => setReceiptId("")}>Close receipt</button></div>{receipts ? <><ol className="receipt-list">{receipts.items.map(row => <li key={row.event_id}><div><span className="pill neutral">Revision {row.revision}</span><strong>{row.previous_status ? `${row.previous_status} → ${row.new_status}` : `Recorded ${row.new_status}`}</strong></div><p>{row.reason}</p><p className="note">{row.method === "experimental_face" ? "Experimental automatic check-in" : row.method === "automatic_absence" ? "Automatic absence at class end" : "Manual staff action"}</p><small>{row.actor_name} · {date(row.occurred_at)}</small></li>)}</ol>{receipts.beforeRevision && <button className="btn outline" disabled={busy} onClick={() => void moreHistory()}>Earlier receipts</button>}</> : <p className="note">Loading receipt history…</p>}</section>}
          </>}
          {section === "privacy" && <div className="safety-grid"><Safety title="Scoped access" text="Administrators manage enrollment. Teachers manage their assigned courses. Student accounts can read only their own attendance records."/><Safety title="A fixed denominator" text="Each opened session keeps a frozen roster. Ending an enrollment changes future sessions while preserving existing registers."/><Safety title="A correction receipt" text="Every correction records the previous and new status, reason, actor, server time, and revision. Conflicting edits require a refresh and review."/><Safety title="Optional experimental check-in" text="Preview, enrollment, comparison and automatic check-in have separate choices. Staff can enable an experimental check-in policy per class. A failed attempt does not mark absence. Staff can correct every saved status. Spoof resistance remains unverified."/></div>}
        </>}
        <footer className="footer"><span>Face Recognition Attendance System · Independent continuation project</span><span>Research prototype · Use synthetic data</span></footer>
      </div>
    </main>
  </div>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="stat-card"><div className="stat-top"><span>{label}</span><Activity size={18}/></div><strong>{value}</strong><small>Saved records within your access</small></div>; }
function Empty({ count, text }: { count: number; text: string }) { return count ? null : <p className="empty-state">{text}</p>; }
function More({ cursor, busy, onClick, label = "Load more" }: { cursor: string | null; busy: boolean; onClick: () => void; label?: string }) { return cursor ? <button className="btn outline register-more" onClick={onClick} disabled={busy}>{label}</button> : null; }
type Field = { name: string; label: string; type?: string; required?: boolean; maxLength?: number; placeholder?: string };
type Mutate = (action: string, fields: Record<string, unknown>, message: string) => Promise<boolean>;
function ActionForm({ title, action, submitLabel, fields, busy, mutate, message, help, fixed = {}, compact = false }: { title: string; action: string; submitLabel: string; fields: Field[]; busy: boolean; mutate: Mutate; message: string; help?: string; fixed?: Record<string, unknown>; compact?: boolean }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    if (await mutate(action, { ...values, ...fixed }, message)) form.reset();
  }
  return <section className={compact ? "register-subform" : "panel"}><h3>{title}</h3>{help && <p className="note">{help}</p>}<form className="register-form" onSubmit={submit}><fieldset disabled={busy}><div className="register-fields">{fields.map(field => <label key={field.name} htmlFor={`${action}-${field.name}`}>{field.label}<input id={`${action}-${field.name}`} name={field.name} type={field.type ?? "text"} required={field.required} maxLength={field.maxLength} placeholder={field.placeholder}/></label>)}</div><button className="btn primary" type="submit">{submitLabel}</button></fieldset></form></section>;
}
function LinkStudent({ row, busy, onLink }: { row: StudentRow; busy: boolean; onLink: (email: string) => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; if (await onLink(String(new FormData(form).get("email")))) form.reset(); }
  return <form className="register-link-form" onSubmit={submit}><label className="sr-only" htmlFor={`link-${row.id}`}>Account email for {row.student_code}</label><input id={`link-${row.id}`} name="email" type="email" maxLength={254} required placeholder="Student account email" disabled={busy}/><button className="small-button" disabled={busy}>Link account</button></form>;
}
function SessionForm({ courses, busy, zone, onSave }: { courses: CourseRow[]; busy: boolean; zone: string; onSave: (values: Record<string, unknown>) => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, values = Object.fromEntries(new FormData(form).entries());
    const starts = new Date(String(values.startsAt)), ends = new Date(String(values.endsAt));
    if (!Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime())) return;
    if (await onSave({ ...values, startsAt: starts.toISOString(), endsAt: ends.toISOString() })) form.reset();
  }
  return <form className="register-form" onSubmit={submit}><p className="note">Enter times in {zone || "your device’s time zone"}. Each class session has a unique code.</p><fieldset disabled={busy || !courses.length}><div className="register-fields"><label htmlFor="session-course">Course<select id="session-course" name="courseId" required>{courses.map(course => <option key={course.id} value={course.id}>{course.course_code} · {course.title}</option>)}</select></label><label htmlFor="session-code">Session code<input id="session-code" name="sessionCode" required maxLength={60} placeholder="CS101-CLASS-001"/></label><label htmlFor="session-title">Session title<input id="session-title" name="title" required maxLength={160} placeholder="Introduction — class 1"/></label><label htmlFor="session-start">Start time<input id="session-start" name="startsAt" type="datetime-local" required/></label><label htmlFor="session-end">End time<input id="session-end" name="endsAt" type="datetime-local" required/></label></div><button className="btn primary">Save session</button></fieldset></form>;
}
function MarkForm({ row, busy, onSave }: { row: RegisterRow; busy: boolean; onSave: (values: Record<string, unknown>) => Promise<boolean> }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form).entries());
    await onSave({ ...values, reason: row.revision ? values.reason : "Manual attendance recorded by staff." });
  }
  return <form className="mark-form" onSubmit={submit}><fieldset disabled={busy}><label className="sr-only" htmlFor={`status-${row.student_id}`}>Status for {row.student_code}</label><select id={`status-${row.student_id}`} name="status" defaultValue={row.status ?? "present"} aria-label={`Status for ${row.student_code}`}><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option><option value="excused">Excused</option></select>{row.revision && <><label className="sr-only" htmlFor={`reason-${row.student_id}`}>Correction reason for {row.student_code}</label><input id={`reason-${row.student_id}`} name="reason" required maxLength={500} placeholder="Reason for correction"/></>}<button className="small-button" type="submit"><CheckCheck size={13}/>{row.revision ? "Save correction" : "Save status"}</button></fieldset></form>;
}
function Safety({ title, text }: { title: string; text: string }) { return <section className="safety-card"><div className="safety-icon"><ShieldCheck size={20}/></div><h3>{title}</h3><p>{text}</p></section>; }
