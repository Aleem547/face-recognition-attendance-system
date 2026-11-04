import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Fingerprint, LockKeyhole } from "lucide-react";
import LoginForm from "@/components/login-form";
import { currentIdentity } from "@/lib/server/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function LoginPage() {
  const identity = await currentIdentity(await headers());
  if (identity.kind === "authenticated") redirect("/");
  if (identity.kind === "denied") redirect("/access-denied");
  return <main className="auth-screen">
    <section className="auth-story">
      <div className="auth-brand"><Fingerprint size={27}/><strong>Face Recognition<br/>Attendance System</strong></div>
      <div><p className="auth-kicker">YOUR CLASSROOM WORKSPACE</p>
        <h1>A clear record.<br/>A trusted start.</h1>
        <p>Sign in to your attendance workspace with an account provided by your administrator.</p>
      </div>
      <span className="auth-story-foot">Thoughtful technology. Accountable attendance.</span>
    </section>
    <section className="auth-card">
      <div className="auth-lock"><LockKeyhole size={25}/></div>
      <p className="eyebrow">WELCOME BACK</p><h2>Sign in to Face Recognition Attendance System</h2>
      <p className="auth-description">Use your assigned account to continue.</p>
      <LoginForm/>
      <p className="auth-help">Need access or help with your password? Contact your administrator.</p>
      <p className="auth-stage-note">Research prototype · Staff attendance and optional experimental face check-in. Biometric reliability remains unverified.</p>
    </section>
  </main>;
}
