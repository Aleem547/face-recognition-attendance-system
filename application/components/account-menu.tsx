"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import type { Account } from "@/lib/auth/identity";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function signOut() {
    setPending(true);
    setFailed(false);
    try {
      const result = await authClient.signOut();
      if (result.error) { setFailed(true); return; }
      router.replace("/login");
      router.refresh();
    } catch {
      setFailed(true);
    } finally { setPending(false); }
  }
  return <span className="signout-wrap">
    <button className="small-button" onClick={signOut} disabled={pending}>
      {pending ? "Signing out…" : "Sign out"}
    </button>
    {failed && <span className="auth-error" role="alert">Sign-out failed. Try again.</span>}
  </span>;
}

export default function AccountMenu({ account }: { account: Account }) {
  return <div className="account-menu">
    <span className="account-label"><strong>{account.displayName}</strong><small>{account.role}</small></span>
    {account.role === "admin" && <Link className="small-button" href="/admin">Admin panel</Link>}
    <SignOutButton/>
  </div>;
}
