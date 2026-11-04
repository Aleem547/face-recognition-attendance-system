import Link from "next/link";
import AccountMenu from "@/components/account-menu";
import CameraPreferences from "@/components/camera-preferences";
import { requirePageAccount } from "@/lib/server/access";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export default async function CameraPage() {
  const account=await requirePageAccount();
  return <main className="portal-shell camera-shell"><header className="portal-header"><Link href="/">← Face Recognition Attendance System workspace</Link><AccountMenu account={account}/></header><CameraPreferences account={account}/></main>;
}
