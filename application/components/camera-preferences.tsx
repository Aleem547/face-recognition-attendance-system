"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Camera, CameraOff, ShieldCheck } from "lucide-react";
import type { Account } from "@/lib/auth/identity";
import type { PersonalPrivacy, StaffPrivacy, Choice } from "@/lib/privacy/contracts";
import { LocalCamera, type CameraState } from "@/lib/privacy/camera";

async function api<T>(params = "", body?: unknown): Promise<T> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("/api/privacy" + params, { method: body ? "POST" : "GET", cache: "no-store", credentials: "same-origin", signal: controller.signal,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) { if (response.status === 401) window.location.assign("/login"); throw new Error(result.error ?? "Camera choice request failed."); }
    return result as T;
  } finally { clearTimeout(timer); }
}
function date(value: string | null) { return value ? new Date(value).toLocaleString() : "—"; }
function status(value: Choice | null) {
  if (!value || value.choice === "not_recorded") return "Manual by default";
  if (value.allowed) return "Local preview enabled";
  if (value.choice === "granted") return "Preview disabled — review or renew your choice";
  return value.choice === "withdrawn" ? "Preview withdrawn" : "Manual attendance chosen";
}
export default function CameraPreferences({ account }: { account: Account }) {
  const student = account.role === "student";
  const [personal, setPersonal] = useState<PersonalPrivacy | null>(null);
  const [staff, setStaff] = useState<StaffPrivacy | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [ready, setReady] = useState(false);
  const [camera, setCamera] = useState<CameraState>({ mode: "idle", message: "Camera is off.", promptPending: false });
  const video = useRef<HTMLVideoElement>(null), preview = useRef<LocalCamera | null>(null), pending = useRef(false), mounted = useRef(true);
  const load = useCallback(async () => {
    if (student) { const data = await api<PersonalPrivacy>(); if (mounted.current) setPersonal(data); return data; }
    const data = await api<StaffPrivacy>(); if (mounted.current) setStaff(data); return null;
  }, [student]);
  useEffect(() => {
    mounted.current = true;
    setReady(Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia));
    void load().catch(e => { if (mounted.current) setError(e.message); });
    if (student) {
      preview.current = new LocalCamera({
        check: async () => {
          const value = await api<PersonalPrivacy>();
          if (mounted.current) setPersonal(value);
          return { allowed: Boolean(value.preference?.allowed && value.student?.is_active), revision: value.preference?.revision ?? 0,
            noticeVersion: value.notice.version, expiresAt: value.preference?.expires_at ? Date.parse(value.preference.expires_at) : NaN };
        },
        getStream: () => navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }),
        attach: async stream => { if (video.current) { video.current.srcObject = stream; if (stream) await video.current.play(); } else if (stream) throw new Error("Preview unavailable."); },
        visible: () => document.visibilityState === "visible", state: value => { if (mounted.current) setCamera(value); },
      });
    }
    const hidden = () => { if (document.visibilityState !== "visible") preview.current?.stop("Preview stopped because this page was hidden."); };
    const leaving = () => preview.current?.stop("Preview stopped because you left this page.");
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", leaving);
    return () => { mounted.current = false; preview.current?.dispose(); preview.current = null; document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", leaving); };
  }, [load, student]);
  useEffect(() => { setAck(false); }, [personal?.notice.version, personal?.preference?.revision]);
  async function change(action: "grantPreview" | "chooseManual" | "withdraw") {
    // Stop our tracks before waiting for the server, including denied requests.
    preview.current?.stop("Camera is off while your choice is saved.");
    if (pending.current || !personal) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await api("", action === "grantPreview" ? { action, acknowledged: ack, noticeVersion: personal.notice.version, expectedRevision: personal.preference?.revision ?? 0 } : { action });
      setNotice(action === "grantPreview" ? "Local preview choice saved. Click Start local preview to request camera permission." : action === "withdraw" ? "Preview choice withdrawn. Manual attendance remains available." : "Manual attendance chosen. Camera is off.");
      setAck(false); await load();
    } catch (e) { setError((e as Error).message); try { await load(); } catch { /* Camera remains stopped. */ } }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function more() {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try {
      if (student && personal?.beforeRevision) {
        const value = await api<PersonalPrivacy>("?beforeRevision=" + personal.beforeRevision);
        setPersonal(previous => previous ? { ...value, history: [...previous.history, ...value.history] } : value);
      } else if (staff?.nextCursor) {
        const value = await api<StaffPrivacy>("?cursor=" + staff.nextCursor);
        setStaff(previous => previous ? { ...value, students: [...previous.students, ...value.students] } : value);
      }
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  const current = personal?.notice ?? staff?.notice;
  return <div className="camera-content"><p className="eyebrow">OPTIONAL CAMERA TRIAL</p><h1>Camera & consent</h1><p className="camera-intro">A local preview, a clear choice, and manual attendance whenever you need it.</p>{student && <p><Link className="text-link" href="/enrollment">Optional face enrollment has its own notice and choice →</Link></p>}
    {error && <div className="register-alert error" role="alert">{error}</div>}{notice && <div className="register-alert success" role="status">{notice}</div>}
    {!current && <section className="panel"><p className="note">{error ? "Camera stays off until your settings load." : "Loading your camera settings…"}</p><button className="btn outline" onClick={() => void load().catch(e => setError(e.message))}>Reload settings</button></section>}
    {current && <><section className="panel camera-notice"><div className="camera-heading"><div className="safety-icon"><ShieldCheck size={22}/></div><div><h2>{current.title}</h2><span className="pill neutral">Local preview only</span></div></div>{current.body.split("\n\n").map((paragraph, index) => <p key={index}>{paragraph}</p>)}<p className="camera-version">Notice version: {current.version}</p></section>
      {student && personal && <>
        {!personal.student ? <section className="panel"><h2>Student link required</h2><p className="note">Ask your administrator to link your account to your own student roster entry. Your camera remains off.</p></section> : <div className="camera-grid"><section className="panel"><h2>Your choice</h2><p className="note">{personal.student.student_code} · {personal.student.display_name}</p><p><span className={`pill ${personal.preference?.allowed ? "success" : "neutral"}`}>{status(personal.preference)}</span></p>{personal.preference?.expires_at && <p className="note">Choice expires: {date(personal.preference.expires_at)}</p>}<label className="camera-ack"><input type="checkbox" checked={ack} disabled={busy || !personal.student.is_active} onChange={e => setAck(e.target.checked)}/><span>I have read this notice and choose the optional local camera preview trial.</span></label><div className="camera-choice-buttons"><button className="btn outline" disabled={busy} onClick={() => void change("chooseManual")}>Use manual attendance</button><button className="btn primary" disabled={busy || !ack || !personal.student.is_active} onClick={() => void change("grantPreview")}>Enable local preview</button></div>{personal.preference?.choice === "granted" && <button className="text-link" disabled={busy} onClick={() => void change("withdraw")}>Withdraw preview choice</button>}<Link className="text-link" href="/">Return to my attendance →</Link></section>
          <section className="panel"><h2>Camera readiness</h2><p className="note">{ready ? "This browser supports a secure camera request." : "A supported browser with HTTPS or localhost is required. Manual attendance is available."}</p><div className={`camera-preview ${camera.mode === "active" ? "is-active" : ""}`}><video ref={video} muted autoPlay playsInline aria-label="Local camera preview"/>{camera.mode !== "active" && <div className="camera-placeholder"><CameraOff size={34}/><span>{camera.mode === "validating" ? "Camera opened — checking choice" : camera.mode === "permission" ? "Waiting for browser permission" : camera.mode === "checking" ? "Checking your saved choice" : "Camera is off"}</span></div>}</div><p className="camera-state" role="status">{camera.message}</p><div className="camera-choice-buttons"><button className="btn primary" disabled={!ready || !personal.preference?.allowed || busy || camera.promptPending || ["active", "checking", "permission", "validating"].includes(camera.mode)} onClick={() => void preview.current?.start()}><Camera size={16}/> Start local preview</button><button className="btn outline" onClick={() => preview.current?.stop()}><CameraOff size={16}/> Stop preview</button></div><p className="note">Each preview lasts up to 60 seconds. Hiding or leaving this page stops this app’s tracks. Starting again requires another click. Browser permission may remain saved; you can change it in your browser’s site settings.</p></section></div>}
        <section className="panel"><h2>Your choice history</h2>{personal.history.length ? <ol className="receipt-list">{personal.history.map(event => <li key={event.revision}><div><span className="pill neutral">Revision {event.revision}</span><strong>{event.previous_choice ? `${event.previous_choice} → ${event.new_choice}` : event.new_choice}</strong></div><p>{event.notice_version}</p><small>{date(event.occurred_at)}{event.expires_at ? " · Expiry " + date(event.expires_at) : ""}</small></li>)}</ol> : <p className="note">No choice has been recorded. Manual attendance is the default.</p>}{personal.beforeRevision && <button className="btn outline" disabled={busy} onClick={() => void more()}>Earlier choices</button>}</section>
      </>}
      {!student && staff && <section className="panel"><h2>Student choices within your access</h2><p className="note">Choices are made by each linked student. Staff can read their status. Camera choices do not mark attendance or authorize face matching.</p><div className="table-scroll"><table><thead><tr><th>STUDENT</th><th>CHOICE</th><th>PREVIEW</th><th>EXPIRY</th></tr></thead><tbody>{staff.students.map(row => <tr key={row.id}><td><strong>{row.display_name}</strong><br/>{row.student_code}</td><td>{row.choice.replace(/_/g, " ")}</td><td>{row.allowed ? "Enabled" : "Off"}</td><td>{date(row.expires_at)}</td></tr>)}</tbody></table></div>{!staff.students.length && <p className="note">No student records are available in your scope.</p>}{staff.nextCursor && <button className="btn outline" disabled={busy} onClick={() => void more()}>Load more students</button>}</section>}
    </>}
  </div>;
}
