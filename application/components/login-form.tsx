"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export default function LoginForm({ portal = "student" }: { portal?: "student" | "admin" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await authClient.signIn.email({
        email: email.trim(), password, rememberMe: false,
      });
      setPassword("");
      if (result.error) {
        setError(result.error.status === 429
          ? "Too many attempts. Wait a minute before trying again."
          : "Sign-in failed. Check your email and password, then try again.");
        return;
      }
      const profile = await fetch("/api/me", { cache: "no-store" });
      if (profile.status === 403) {
        router.replace("/access-denied");
        router.refresh();
        return;
      }
      if (!profile.ok) throw new Error("Unable to confirm account access.");
      const { user } = await profile.json() as { user: { role: string } };
      const staff = user.role === "admin" || user.role === "teacher";
      if ((portal === "admin") !== staff) {
        const signedOut = await authClient.signOut();
        if (signedOut.error) throw new Error("Unable to switch account portals.");
        setError(staff ? "This is a staff account. Choose Admin / Staff login above."
          : "This is a student account. Choose Student login above.");
        return;
      }
      router.replace(user.role === "admin" ? "/admin" : "/");
      router.refresh();
    } catch {
      setError("Sign-in is temporarily unavailable. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return <form className="auth-form" onSubmit={submit}>
    <label htmlFor="attend-email">Email address</label>
    <input id="attend-email" name="email" type="email" autoComplete="username"
      required maxLength={254} value={email} onChange={event => setEmail(event.target.value)}
      placeholder="you@example.com" disabled={pending}/>
    <label htmlFor="attend-password">Password</label>
    <input id="attend-password" name="password" type="password" autoComplete="current-password"
      required maxLength={128} value={password} onChange={event => setPassword(event.target.value)}
      disabled={pending}/>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <button className="btn primary auth-submit" type="submit" disabled={pending}>
      {pending ? "Signing in…" : portal === "admin" ? "Sign in as admin / staff" : "Sign in as student"}
    </button>
  </form>;
}
