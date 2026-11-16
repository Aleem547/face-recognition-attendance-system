"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function RegistrationForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setPending(true);
    try {
      const response = await fetch("/api/registration", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, studentCode, email, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) { setError(result.error ?? "Registration could not be completed. Please try again."); return; }
      setPassword(""); setConfirm("");
      router.replace("/access-denied");
      router.refresh();
    } catch { setError("Registration is temporarily unavailable. Please try again."); }
    finally { setPending(false); }
  }
  return <form className="auth-form" onSubmit={submit}>
    <label htmlFor="signup-name">Full name</label>
    <input id="signup-name" name="name" autoComplete="name" required maxLength={100}
      value={name} onChange={e => setName(e.target.value)} disabled={pending}/>
    <label htmlFor="signup-number">Student / enrollment number</label>
    <input id="signup-number" name="studentCode" required maxLength={40} autoCapitalize="characters"
      pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" title="Use letters, numbers, dots, underscores or hyphens."
      value={studentCode} onChange={e => setStudentCode(e.target.value)} disabled={pending}/>
    <label htmlFor="signup-email">Email address</label>
    <input id="signup-email" name="email" type="email" autoComplete="email" required maxLength={254}
      placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} disabled={pending}/>
    <label htmlFor="signup-password">Password</label>
    <input id="signup-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128}
      aria-describedby="signup-password-help" value={password} onChange={e => setPassword(e.target.value)} disabled={pending}/>
    <span id="signup-password-help" className="auth-field-help">Use 12–128 characters.</span>
    <label htmlFor="signup-confirm">Confirm password</label>
    <input id="signup-confirm" name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128}
      value={confirm} onChange={e => setConfirm(e.target.value)} disabled={pending}/>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <button className="btn primary auth-submit" disabled={pending} type="submit">{pending ? "Creating account…" : "Create student account"}</button>
    <p className="auth-field-help">Your administrator will approve your student details before your class records become available.</p>
  </form>;
}
