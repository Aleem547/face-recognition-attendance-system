import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import AuthScreen from "@/components/auth-screen";
import RegistrationForm from "@/components/registration-form";
import { currentIdentity } from "@/lib/server/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function RegisterPage() {
  const identity = await currentIdentity(await headers());
  if (identity.kind === "authenticated") redirect(identity.account.role === "admin" ? "/admin" : "/");
  if (identity.kind === "denied") redirect("/access-denied");
  return <AuthScreen registration title="Create your student account" description="Register with your own email and student number.">
    <RegistrationForm/>
    <p className="auth-help">Already have an account? <Link className="auth-text-link" href="/login?role=student">Student login</Link></p>
    <p className="auth-help auth-help-secondary"><Link className="auth-text-link" href="/login?role=admin">Admin / Staff login</Link></p>
  </AuthScreen>;
}
