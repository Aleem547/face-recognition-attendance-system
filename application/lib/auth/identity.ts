export const userRoles = ["admin", "teacher", "student"] as const;
export type UserRole = typeof userRoles[number];
export type Account = {
  id: string;
  displayName: string;
  email: string | null;
  role: UserRole;
};
export type ProfileRow = {
  id: string;
  display_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
  auth_subject: string;
};
export type Identity =
  | { kind: "anonymous" }
  | { kind: "denied" }
  | { kind: "authenticated"; account: Account };

type Dependencies = {
  session: (headers: Headers) => Promise<{ user: { id: string } } | null>;
  profile: (authUserId: string) => Promise<ProfileRow | null>;
};

/** A cookie must be verified before its user ID can select an application role. */
export async function resolveIdentity(headers: Headers, dependencies: Dependencies): Promise<Identity> {
  const session = await dependencies.session(headers);
  if (!session?.user?.id) return { kind: "anonymous" };
  const profile = await dependencies.profile(session.user.id);
  if (!profile || !profile.is_active || profile.auth_subject !== session.user.id
      || !userRoles.includes(profile.role as UserRole)) return { kind: "denied" };
  return {
    kind: "authenticated",
    account: {
      id: profile.id,
      displayName: profile.display_name,
      email: profile.email,
      role: profile.role as UserRole,
    },
  };
}

export function permissionStatus(identity: Identity, roles?: readonly UserRole[]): 200 | 401 | 403 {
  if (identity.kind === "anonymous") return 401;
  if (identity.kind === "denied") return 403;
  return !roles || roles.includes(identity.account.role) ? 200 : 403;
}
