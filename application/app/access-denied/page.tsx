import { SignOutButton } from "@/components/account-menu";
import Link from "next/link";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { ownRegistrationStatus } from "@/lib/auth/registration";
import { getAppPool } from "@/lib/server/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AccessDeniedPage() {
  let registration = null;
  try {
    const session = await getAuth().api.getSession({ headers: await headers() });
    if (session?.user.id) registration = await ownRegistrationStatus(getAppPool(), session.user.id);
  } catch { /* The existing access-denied page remains available during setup. */ }
  if (registration?.status === "pending" || registration?.status === "rejected") {
    const pending = registration.status === "pending";
    return <main className="portal-shell"><section className="panel portal-card">
      <p className="eyebrow">STUDENT ACCOUNT</p>
      <h1>{pending ? "Your account is awaiting approval." : "Your registration needs a review."}</h1>
      <p>You are signed in as <strong>{registration.name}</strong>.</p>
      <p className="note">{pending ? "Your administrator will confirm your student number and link your class records. You can check back here without creating another account."
        : "Please contact your administrator to review your student registration."}</p>
      <p className="note">Student number: <strong>{registration.studentCode}</strong></p>
      <Link className="btn outline" href="/demo">Try recruiter demo — no approval needed</Link>
      <div className="auth-status-actions"><Link className="btn primary" href="/" prefetch={false}>Check access status</Link><SignOutButton/></div>
    </section></main>;
  }
  return <main className="portal-shell"><section className="panel portal-card">
    <p className="eyebrow">ACCOUNT ACCESS</p><h1>Access is unavailable.</h1>
    <p>Your account does not currently have permission to open this page.</p>
    <p className="note">Contact your administrator, or sign out to use a different account.</p>
    <Link className="text-link" href="/">Return to your workspace</Link><br/>
    <Link className="btn outline" href="/demo">Try recruiter demo</Link> <SignOutButton/>
  </section></main>;
}
