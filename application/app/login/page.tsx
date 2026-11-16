import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import LoginForm from "@/components/login-form";
import AuthScreen from "@/components/auth-screen";
import { currentIdentity } from "@/lib/server/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ role?: string }> }) {
  const identity = await currentIdentity(await headers());
  if (identity.kind === "authenticated") redirect(identity.account.role === "admin" ? "/admin" : "/");
  if (identity.kind === "denied") redirect("/access-denied");
  const portal = (await searchParams)?.role === "admin" ? "admin" : "student";
  return <AuthScreen title={portal === "student" ? "Student login" : "Admin login"}
    description={portal === "student" ? "Sign in to view your courses, classes and attendance." : "Administrators and teachers can sign in with their assigned account."}>
    <nav className="auth-portal-tabs" aria-label="Login type">
      <Link href="/login?role=student" aria-current={portal === "student" ? "page" : undefined}>Student login</Link>
      <Link href="/login?role=admin" aria-current={portal === "admin" ? "page" : undefined}>Admin / Staff login</Link>
    </nav>
    <LoginForm key={portal} portal={portal}/>
    <p className="auth-help">New student? <Link className="auth-text-link" href="/register">Create an account</Link></p>
    <p className="auth-help auth-help-secondary">Need help with an existing account or password? Contact your administrator.</p>
  </AuthScreen>;
}
