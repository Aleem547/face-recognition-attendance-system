import Link from 'next/link';
import AccountMenu from '@/components/account-menu';
import FaceCheckin from '@/components/face-checkin';
import {requirePageAccount} from '@/lib/server/access';
import '../checkin-flow.css';
export const runtime='nodejs';export const dynamic='force-dynamic';
export default async function CheckinPage(){const account=await requirePageAccount();
 return <main className="portal-shell camera-shell"><header className="portal-header"><Link href="/">← Face Recognition Attendance System workspace</Link><AccountMenu account={account}/></header><FaceCheckin/></main>;
}
