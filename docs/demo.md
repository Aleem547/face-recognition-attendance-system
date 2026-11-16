# Recruiter demo

Open `/demo` on the existing application, or select **Try recruiter demo** on the login or registration page. It is also linked from the signed-in account menu and the pending-access page. No sign-in, registration, shared password or administrator approval is required to enter the demo.

## Explore the workflows

The default Overview uses the existing attendance workspace and analytics components. Its data is synthetic and clearly labelled. Use **Explore as** to switch among administrator, teacher and student. The student view shows only the selected sample student's own entries; the teacher view is scoped to the assigned sample course. These demo roles cannot grant access to live accounts.

Use **Feature tour** for a list of tasks:

1. Add a sample student. Create a sample account under Administration if you want to link an email, then link that account to the correct unlinked sample student. All sample accounts are immediately active and have no real credentials.
2. Create a course, assign the sample teacher, enroll students and end enrollment. Opening a class freezes its roster, preserving that snapshot when enrollment later changes.
3. Schedule a class, open attendance and record Present, Late, Absent or Excused. Correct an existing mark with a reason; its receipt retains both statuses, the actor and revision history. Close a complete register or reopen it for a correction.
4. Download session CSVs or closed-course analytics CSVs. The same CSV formatters and UI components used by the live application are used here. Exported values reflect the current sample records, including your changes.
5. In **Automatic check-in**, run labelled on-time, late, face-rejected and PAD-rejected scenarios. The sample live class starts at 08:30 in the device time zone used when the workspace was created. The default late cutoff is 15 minutes. Scenario scores are explicit synthetic inputs, not measured model outputs.
6. Advance the demo clock to demonstrate class timing. With sample automation enabled, unmarked roster entries become Absent after class end plus 30 seconds; previous marks remain intact. Change the demonstration policy from a staff role.
7. In **Camera & comparison**, optionally use your own camera for real face extraction and similarity comparison, or remain in the sample scenarios without using a camera.

Changes are held in this browser tab's memory and `sessionStorage`. Refreshing the tab resumes a valid saved sample workspace. **Reset demo** restores the sample records and clears the current camera component. Nothing in the attendance demo reads or writes the live register database. Use fictional details when adding records. Closing the tab ends the ordinary tab-scoped storage lifecycle; browser session-restoration behavior is controlled by the browser.

## Optional real camera trials

Preview requires an explicit camera choice and the browser's camera permission. It remains local, stops when the page is hidden or left, and is bounded to 60 seconds. The face positioning guide uses the existing browser detector; its label is a preview label, not a recognized identity.

Sending a capture requires a separate explicit choice. A captured JPEG, bounded to 1 MiB, is processed by the existing YuNet/SFace CPU worker. A reference is returned as an AES-GCM sealed token bound to a signed, HttpOnly anonymous demo cookie. The template cannot be used for the live enrollment or attendance APIs. The token is held in the current page's memory and expires within ten minutes. Raw images and embeddings are not written to files or database tables by these demo routes.

Compare a fresh capture against your temporary reference to inspect the measured cosine similarity. Optionally request both existing MiniFASNet PAD research scores. These scores are uncalibrated and do not establish identity or liveness; a similarity is not an accuracy percentage. The live comparison option explicitly sends up to three fresh frames while preview stays active, bounded by the preview's 60-second lifecycle. Camera measurements are displayed in current page state and are not added to the stored sample workspace.

A separate demo-only attendance choice allows a measured face/PAD result to be passed to the sample class policy. An accepted result can mark a synthetic roster entry Present or Late in this tab. The reference belongs to the visitor's own face; choosing a synthetic account does not identify the visitor as that fictional person. Rejected results preserve the sample register. Sample timing scenarios remain separate from this measured path.

Withdrawal aborts in-flight captures, stops the preview, clears the page's reference and score state, and revokes the anonymous server trial. Expiry, server restarts and page changes also prevent an old reference from silently becoming a permanent enrollment. The browser's normal account cookie, if present, is not used to authorize demo camera work and is not changed by exiting the demo.

The camera endpoints use the existing model installation and the existing enrollment/comparison enable flags. They have same-origin, content-type, input-size, signed-cookie, reference-binding, expiry and cancellation checks. Six capture attempts are allowed per anonymous trial, with additional bounded guest-creation and shared capture allowances. They share the existing CPU reservation gate. Processing failure, a disabled model installation or an exhausted allowance produces a message and leaves sample attendance unchanged. The sample workspace does not require a camera or a running model process.

## Deploy this update

This change needs no database migration, new service, paid resource, encryption key or new environment setting. Publish the reviewed patch to the existing `render-free-20261104200805440` branch. Then use the existing Render service's **Deploys → Manual Deploy → Deploy latest commit** action. Preserve the current runtime settings and Free plan. The website's existing hostname stays the same; `/demo` is the new public route.

The update installer uses a separate Git worktree, verifies the package and complete public source allowlist, stages only the reviewed changed files, and pushes without force through the laptop's existing Git credentials. It does not read a private environment file, connect to the live database or reinstall dependencies. Application checks and a Linux production build are completed before packaging; Render performs its normal Docker build on deployment.

## Verification scope

The workspace checks use independent synthetic stores and cover role scope, account linking, frozen rosters, class creation, status changes, revision checks, receipts, analytics, CSV output, sample policy outcomes, automatic absence and state restoration. The camera route checks use injected normalized feature vectors and valid PAD fixtures to test the actual HTTP, cryptographic, quota and cancellation logic without transmitting a person's image. Existing account, attendance, analytics and local-camera lifecycle regressions are checked as well.

Browser QA exercises the actual demo components in an isolated Next.js preview with no private database configuration. It covers sample creation, attendance correction, a real CSV download, the student view, class-timing scenarios, reset, initial camera permission gates and a narrow-screen feature tour. It does not substitute for a human camera measurement on the hosted model installation or for a biometric accuracy evaluation. Never present synthetic scenario scores or fixture outcomes as measured face-recognition accuracy.
