import Link from "next/link";
import AccountMenu from "@/components/account-menu";
import { requirePageAccount } from "@/lib/server/access";
import { getAppPool } from "@/lib/server/database";
import AdminRegistrations from "@/components/admin-registrations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AccountRow = { id: string; display_name: string; email: string; role: string; is_active: boolean };

export default async function AdminPage() {
  const account = await requirePageAccount(["admin"]);
  const { rows } = await getAppPool().query<AccountRow>(
    `SELECT id, display_name, email, role, is_active
     FROM attendai.app_users WHERE auth_provider = $1
     ORDER BY created_at DESC LIMIT 100`, ["better-auth"],
  );
  return <main className="portal-shell">
    <header className="portal-header"><Link href="/">Face Recognition Attendance System</Link><AccountMenu account={account}/></header>
    <section className="panel portal-card portal-wide">
      <p className="eyebrow">ADMINISTRATION</p><h1>Admin panel</h1>
      <p className="note">Approve student registrations and review workspace accounts. Administrator and teacher roles remain assigned through the trusted operator workflow.</p>
      <AdminRegistrations/>
      <h2>Workspace accounts</h2><p className="note">Up to 100 most recently created accounts.</p>
      <div className="table-scroll"><table><thead><tr><th>NAME</th><th>EMAIL</th><th>ROLE</th><th>STATUS</th></tr></thead>
        <tbody>{rows.map(user => <tr key={user.id}><td>{user.display_name}</td><td>{user.email}</td>
          <td>{user.role}</td><td>{user.is_active ? "Active" : "Inactive"}</td></tr>)}</tbody></table></div>
      <Link className="text-link" href="/">Return to attendance workspace</Link>
    </section>
  </main>;
}
