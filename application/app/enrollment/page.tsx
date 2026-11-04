import Link from "next/link";
import AccountMenu from "@/components/account-menu";
import FaceEnrollment from "@/components/face-enrollment";
import {requirePageAccount} from "@/lib/server/access";
export const runtime="nodejs";export const dynamic="force-dynamic";
export default async function EnrollmentPage(){const account=await requirePageAccount(["student"]);
  return <main className="portal-shell camera-shell"><header className="portal-header"><Link href="/">← Face Recognition Attendance System workspace</Link><AccountMenu account={account}/></header><FaceEnrollment/></main>;
}
