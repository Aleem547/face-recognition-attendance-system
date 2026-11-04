import Dashboard from "@/components/dashboard";
import StudentHome from "@/components/student-home";
import { requirePageAccount } from "@/lib/server/access";
import { selectedSessionId } from "@/lib/checkin/outcome";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const account = await requirePageAccount();
  const initialSessionId = selectedSessionId((await searchParams)?.session);
  return account.role === "student" ? <StudentHome account={account} initialSessionId={initialSessionId}/> : <Dashboard account={account} initialSessionId={initialSessionId}/>;
}
