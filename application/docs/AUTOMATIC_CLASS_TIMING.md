# Automatic Present, Late and Absent

Face enrollment is a one-time reference setup under its notice. During each class, the linked student uses **Check in with camera**. That explicit click opens the camera, automatically sends one frame when ready, and closes the preview. A qualifying server-side face/PAD check records attendance without a staff marking click. Opening a page or merely saving an enrollment template does not mark attendance.

## The requested rule

For an example class starting at **08:30**, with the late cutoff set to **15 minutes**:

| Server arrival of a qualifying check-in | Saved result |
| --- | --- |
| Before 08:30 | Not admitted to this class |
| 08:30 through 08:44:59 | Present |
| Exactly 08:45 or later, before class end | Late |
| Roster entry still unmarked after class end and its processing allowance | Absent |

The cutoff is configurable per class; its default is 15 minutes. The server stamps arrival when it admits the authenticated upload, before inference. Slower face processing therefore does not turn an admitted on-time arrival into Late. Client clocks/timestamps cannot set the mark. Arrival is an application check-in timestamp, not proof of physical entry to a room.

New arrivals stop at the scheduled end time. Uploads admitted before then have at most **30 seconds** after class end to finish, still within their own token expiry. The class clock finalizes after that allowance. Normal polling runs every 20 seconds and drains due-class backlogs promptly; it is not a hard real-time clock.

## Set up a class once

Staff create the course, enrollment and a scheduled session with its real start/end times. In **Face check-in**, select that session, configure the experimental face/PAD cutoffs, leave late-after at 15 minutes for the example above, and select **Automatically open this class…**. Read the acknowledgement and choose **Save face policy & class timing** before the class starts.

Arming automatic timing freezes that class list immediately. This prevents a delayed server restart from inventing a start-time roster using later enrollment. Later enrollment changes do not rewrite the armed class list. Disabling/re-enabling timing preserves the snapshot; prepare a new class when a different roster is required. Existing manually managed classes keep their original open-time roster behavior.

At the scheduled start, the server opens attendance using that snapshot. During the class, qualifying face check-ins create Present/Late, and staff may also save manual attendance. At class end plus the allowance, only entries still unmarked become Absent; existing Present, Late, Absent and Excused records and revisions are preserved. The register then closes. Automatic absence is an explicit no-record rule, not proof that the student was physically absent.

Both automatic face marks and automatic absences have immutable attendance history. The register, receipts and CSV show their methods. A staff correction remains available after closure, requires a reason and preserves the previous automatic event. A physically present student whose face check fails can use manual attendance on equal terms.

## Keep the server running

The class clock starts inside the existing Next.js Node server and runs independently of browser tabs. Keep the Face Recognition Attendance System PowerShell server running through the class. No extra paid service, third-party scheduler, owner credential in the runtime, new secret or environment-key change is introduced. Setup uses the owner only to apply/check additive migrations; the running clock uses the existing restricted application pool.

The app shows a database-backed class-clock heartbeat. On first boot after a missed class, a substantial clock gap during a class, an unavailable responsible staff/course, or a disabled face policy, automatic absences pause and the class shows **Staff review required**. Review the real register and complete/correct it through staff attendance. The software does not automatically clear that review flag or fabricate absence for an entirely missed class. Clock polling cannot observe camera/internet outages for individual students, so staff review/correction remains necessary.

The trusted clock has no public HTTP trigger and accepts no caller-supplied time, student or mark. SQL advisory/row locks, the student/session uniqueness constraint and one transaction protect against duplicate ticks and partial finalization. Snapshot, timing and finalization events are scoped and immutable. Live multi-process contention/recovery and operational scale still require deployment validation.

This in-process worker requires a continuously running Node deployment. A short-lived/serverless web invocation alone does not establish that operation. No public deployment is performed by this update.

## Install and compatibility

Use the supplied **Class Automation** bundle. It accepts the exact known consolidated release or previous Automatic Checkin release, preserves unfamiliar edits for review, and backs up changed source. The single setup command runs the isolated checks/build, verifies the existing native models, applies/checks migration 008 if needed, then migration 009. You do not have to install the older automatic ZIP first. No test thresholds, classes, student consents or attendance marks are created by setup.

The updated check-in notice is `automatic-checkin-v2`. Existing encrypted enrollment templates are preserved; a previous check-in grant requires the updated acknowledgement. Old receipts and attendance remain intact. The fixed course roster is separate from biometric consent: declining the camera does not remove the manual attendance route.

Source restore does not roll back migrations, class records, notices or attendance. Stop the app first, restore only with its exact backup ID and rebuild. Never drop database objects to undo a source update.

## Evidence boundary

The timing/classification/finalization code is tested with isolated PostgreSQL fixtures, synthetic normalized features, mocked capture and controlled fixture schedule changes. Those fixtures are not biometric accuracy, live camera acceptance or production validation. Existing phone-photo score overlap and timed-out motion attempts remain unresolved. The face decision policy remains experimental; this update completes class automation software without claiming reliable liveness or independently validated identity recognition.

Server startup uses the documented Next.js instrumentation `register` hook: https://nextjs.org/docs/15/app/api-reference/file-conventions/instrumentation .
