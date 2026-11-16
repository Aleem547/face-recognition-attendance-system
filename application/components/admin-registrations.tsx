"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Registration = { id: string; display_name: string; email: string; student_code: string; created_at: string };
type Student = { id: string; display_name: string; student_code: string };
export default function AdminRegistrations() {
  const router = useRouter();
  const [requests, setRequests] = useState<Registration[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/registrations", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load registrations.");
      setRequests(result.requests); setStudents(result.students); setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load registrations."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function review(id: string, decision: "approve" | "reject") {
    if (busy) return;
    setBusy(id); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/registrations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id, decision, studentId: decision === "approve" ? links[id] || null : null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not review this registration.");
      setMessage(decision === "approve" ? "Student account approved. The student can now open their workspace." : "Registration reviewed and rejected.");
      await refresh(); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not review this registration."); }
    finally { setBusy(null); }
  }
  return <section className="admin-registrations" aria-labelledby="registration-heading">
    <div className="registration-heading"><h2 id="registration-heading">Student registrations</h2>
      <button className="btn" onClick={() => void refresh()} disabled={loading || busy !== null}>Refresh requests</button></div>
    <p className="note">Confirm the student’s identity before approval. Create a new student record, or select the correct existing unlinked record to retain its course history.</p>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {message && <p className="registration-success" role="status">{message}</p>}
    {loading ? <p className="note" role="status">Loading registrations…</p> : requests.length === 0 ? <p className="note">No pending student registrations.</p> :
      <div className="table-scroll"><table><thead><tr><th>STUDENT</th><th>NUMBER</th><th>LINK TO REGISTER</th><th>REVIEW</th></tr></thead>
        <tbody>{requests.map(request => <tr key={request.id}>
          <td><strong>{request.display_name}</strong><br/>{request.email}</td><td>{request.student_code}</td>
          <td><label className="sr-only" htmlFor={`registration-link-${request.id}`}>Student record for {request.display_name}</label>
            <select id={`registration-link-${request.id}`} value={links[request.id] ?? ""} disabled={busy !== null}
              onChange={event => setLinks(current => ({ ...current, [request.id]: event.target.value }))}>
              <option value="">Create new student record</option>
              {students.map(student => <option key={student.id} value={student.id}>{student.student_code} — {student.display_name}</option>)}
            </select></td>
          <td><div className="registration-review-actions"><button className="btn primary" disabled={busy !== null}
            onClick={() => void review(request.id, "approve")}>{busy === request.id ? "Saving…" : "Approve"}</button>
            <button className="btn" disabled={busy !== null} onClick={() => void review(request.id, "reject")}>Reject</button></div></td>
        </tr>)}</tbody></table></div>}
    <p className="auth-field-help">Email ownership is not verified by registration. Approval confirms the student-to-account link. Course enrollment is managed in the attendance workspace.</p>
  </section>;
}
