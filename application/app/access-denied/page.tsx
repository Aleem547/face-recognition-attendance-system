import { SignOutButton } from "@/components/account-menu";

export default function AccessDeniedPage() {
  return <main className="portal-shell"><section className="panel portal-card">
    <p className="eyebrow">ACCOUNT ACCESS</p><h1>Access is unavailable.</h1>
    <p>Your account does not currently have permission to open this page.</p>
    <p className="note">Contact your administrator, or sign out to use a different account.</p>
    <SignOutButton/>
  </section></main>;
}
