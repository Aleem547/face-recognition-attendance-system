import type { ReactNode } from "react";
import { Fingerprint, LockKeyhole } from "lucide-react";

export default function AuthScreen({ title, description, children, registration = false }: {
  title: string; description: string; children: ReactNode; registration?: boolean;
}) {
  return <main className="auth-screen">
    <section className="auth-story">
      <div className="auth-brand"><Fingerprint size={27}/><strong>Face Recognition<br/>Attendance System</strong></div>
      <div><p className="auth-kicker">YOUR CLASSROOM WORKSPACE</p>
        <h1>A clear record.<br/>A trusted start.</h1>
        <p>Create a student account or sign in to your workspace. Keep your classes, attendance and account choices in one place.</p>
      </div>
      <span className="auth-story-foot">Thoughtful technology. Accountable attendance.</span>
    </section>
    <section className="auth-card">
      <div className="auth-lock"><LockKeyhole size={25}/></div>
      <p className="eyebrow">{registration ? "JOIN YOUR CLASSROOM" : "WELCOME BACK"}</p>
      <h2>{title}</h2><p className="auth-description">{description}</p>
      {children}
      <p className="auth-stage-note">Staff attendance and optional experimental face check-in. Camera use is a separate choice.</p>
    </section>
  </main>;
}
