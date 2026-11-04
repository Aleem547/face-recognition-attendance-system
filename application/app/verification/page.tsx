import Link from "next/link";
import AccountMenu from "@/components/account-menu";
import FaceComparison from "@/components/face-comparison";
import {requirePageAccount} from "@/lib/server/access";
export const runtime="nodejs";export const dynamic="force-dynamic";
export default async function VerificationPage(){const account=await requirePageAccount(["student"]);
 return <main className="portal-shell camera-shell"><header className="portal-header"><Link href="/">← Face Recognition Attendance System workspace</Link><AccountMenu account={account}/></header><FaceComparison/></main>;
}
