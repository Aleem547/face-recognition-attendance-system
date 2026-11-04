import Link from "next/link";
import AccountMenu from "@/components/account-menu";
import { requirePageAccount } from "@/lib/server/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function GuidePage() {
  const account = await requirePageAccount();
  const staff = account.role !== "student";
  return <main className="portal-shell">
    <header className="portal-header">
      <Link href="/">← Face Recognition Attendance System workspace</Link><AccountMenu account={account}/>
    </header>
    <article className="portal-card portal-wide panel">
      <p className="eyebrow">WORKSPACE GUIDE</p>
      <h1>{staff ? "Run a class with a clear attendance record" : "Your attendance and camera choices"}</h1>
      <p>The register holds saved staff marks and qualifying experimental face check-ins. Camera preview, face enrollment and research comparison alone do not mark attendance.</p>
      {staff ? <>
        <h2>Prepare and open the class</h2>
        <p>{account.role === "admin"
          ? "Create students and a course, link existing student accounts where needed, and enroll the course members. Then create a class session with a unique code."
          : "Use a course assigned to your teacher account. Your administrator manages student account links and enrollment. Create a class session for the course."}</p>
        <p>For a manual class, open attendance when ready to freeze its roster. For an automatically timed class, configure Face check-in before its start; arming timing freezes the roster immediately. Later enrollment changes do not rewrite that fixed class list.</p>
        <h2>Save, review, and close</h2>
        <ol>
          <li>Choose the class in Attendance and review its roster.</li>
          <li>Save each status as Present, Absent, Late, or Excused. Wait for the saved confirmation.</li>
          <li>For a correction, enter a reason and check the receipt. If another edit caused a conflict, refresh and review before saving again.</li>
          <li>For manual classes, resolve every entry before closure. Automatically timed classes fill remaining unmarked entries as Absent after class end and the processing allowance, unless a detected clock gap requires staff review.</li>
          <li>Export the session CSV when needed. It includes saved statuses, revisions, and correction reasons.</li>
        </ol>
        <h2>Understand the attendance rate and analytics</h2>
        <p>Present and Late count as attending. Excused entries are excluded from the denominator. The final rate is shown after all statuses are saved and the session is closed. Overview includes course totals from closed classes only, with scoped paginated CSV exports.</p>
      </> : <>
        <h2>View your saved record</h2>
        <p>Use My courses and My attendance in the workspace. You can see your own linked record and correction receipts. If a class or mark is missing, ask the staff member responsible for the class to review it.</p>
        <h2>Choose whether to use the camera</h2>
        <p>Camera preview, face enrollment, and face comparison have separate choices. You can use your saved attendance view without granting them. Read each notice before choosing; declining a camera option does not create an absence mark.</p>
        <p>Enrollment saves an encrypted template under its notice. Comparison displays experimental similarity scores. A session-bound comparison links that research result to an eligible class session; it still does not create attendance.</p>
        <div className="buttons">
          <Link className="btn outline" href="/camera">Camera choices</Link>{" "}
          <Link className="btn outline" href="/enrollment">Enrollment</Link>{" "}
          <Link className="btn outline" href="/verification">Face comparison</Link>
        </div>
      </>}
      <h2>When a request fails</h2>
      <p>A failed camera trial or a timeout is not a fake-face verdict. If a save result is uncertain, refresh the workspace and inspect the saved record before repeating it. Inspect the saved register and receipts; staff can correct any mark with a reason.</p>
      <p>This project supports staff attendance and an opt-in experimental automatic check-in path. Staff configure each session; students give a separate choice. Successful checks create an audited Present or Late mark. Reliable anti-spoofing and public/institutional deployment remain unverified.</p>
      <h2>Complete local testing</h2><p>The completion package includes local acceptance, reliability study and recovery instructions in the installed docs folder. Passing software checks does not establish reliable face/PAD recognition. Face comparison can optionally export anonymous labelled attempts, including unsuccessful requests, for a separately recorded study.</p><h2>Experimental automatic attendance</h2><p>Use Face check-in to configure a class policy as staff or check in as its linked student. The class must be open and within its start/end times. Staff must select explicit test cutoffs; this update supplies no validated operating threshold. Enable automatic class timing before the scheduled start to open the class automatically and fill still-unmarked entries as Absent after its end. The class list freezes when timing is enabled. Keep the Node server running; detected clock gaps pause automatic absences for staff review. A rejected capture leaves the record unmarked, and staff can correct any resulting mark.</p><Link className="btn outline" href="/check-in">Open Face check-in</Link><Link className="btn primary" href="/">Return to workspace</Link>
    </article>
  </main>;
}
