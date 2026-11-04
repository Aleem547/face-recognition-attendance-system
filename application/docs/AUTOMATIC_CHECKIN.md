# Current class timing update

Read [AUTOMATIC_CLASS_TIMING.md](AUTOMATIC_CLASS_TIMING.md) for the current workflow. It adds one-click capture, server-arrival lateness and automatic absence at class end. The material below documents the earlier Automatic Checkin release; its manual-opening and commit-time lateness descriptions are superseded for classes with automatic timing.

# Experimental automatic face attendance

This update implements an automatic check-in path. It is separate from the existing research comparison page: a qualifying server-processed capture now creates a Present or Late attendance record and an immutable receipt in the same database transaction. It does not establish reliable recognition, liveness, spoof resistance or suitability for institutional attendance.

## Install in the existing Windows project

Stop the Face Recognition Attendance System web terminal with Ctrl+C before updating. Extract `Face_Recognition_Attendance_System_Automatic_Checkin.zip` into a new `Downloads\Face_Recognition_Attendance_System_Automatic_Checkin` folder, then run the bundle's `run.mjs` with `--project "$HOME\Downloads\Face_Recognition_Attendance_System" --apply-migration`. The installer verifies and backs up source, runs the isolated regression suites and production build, checks the existing native models with a synthetic smoke test, then applies additive migration 008 using the existing local owner/runtime configuration.

The migration step loads the existing project's `.env.local` in its child process. It never prints, copies into a report, rewrites or rotates credentials or encryption keys. It checks matching owner/runtime database destinations and restricted runtime privileges. No dependencies, accounts, marks, test thresholds, per-session enablement or student check-in choices are created. An existing migration 008 is checked without being rerun. Source rollback never deletes the schema, attendance or receipts.

After a successful run, use `npm run start` from the app directory. Keep the terminal open. Use the existing configured sign-in origin and the **Face check-in** workspace link, or `/check-in` on that same origin.

## Run one controlled class

As staff, create a fresh session whose start/end times include the present time, and open attendance to freeze its roster. In Face check-in, select it and supply an explicit minimum SFace cosine, a minimum for **each** PAD model, and late-after minutes. Read the experimental-policy acknowledgement and enable the policy. No policy is enabled by installation. No threshold values are prefilled or recommended: the existing pilots do not establish a validated operating point.

As the linked student, retain or voluntarily create your own current encrypted enrollment template. On Face check-in, read and grant the separate check-in choice. Select the enabled class, start the camera, and choose **Capture & mark my attendance**. That single capture stops the preview and runs the server's existing quality checks, SFace comparison and both PAD models. If every selected test rule is met, the server writes Present or Late automatically. No further staff marking click is needed. Otherwise the record remains unmarked; a rejected capture never creates Absent or establishes that a face is fake.

Review My attendance. Staff see the same saved mark and can correct it with a reason. The register, receipt history and CSV distinguish `experimental_face` from `manual`. A later staff correction is manual; the earlier automatic event remains in history. If an upload times out or is cancelled, inspect attendance before retrying: transport cancellation cannot undo a database transaction that already committed.

## Enforcement

The browser submits one bounded JPEG plus a server-issued, hashed-at-rest token. It cannot submit a student identity, embedding, score, attendance status or accepted flag through the check-in API. The authenticated server computes the feature and requires both original PAD outputs; their mean cannot hide one failing model. Quality gates remain unchanged. There is no file-upload picker or continuous scan loop.

Issuance, consumption and final saving recheck own-account linkage, active account/student/course/enrollment, frozen roster membership, open state, scheduled time window, per-session policy revision, separate check-in choice revision/expiry and the same active encrypted template. Tokens expire within 90 seconds or at class end, are single-use and are limited to five issuances per student per ten minutes. A rejected image still uses its issued attempt.

The session row lock serializes automatic saving with manual marks and closure. The existing unique student/session key prevents duplicates. An existing mark is never overwritten. Attendance, its normal audit event, the minimal check-in receipt and attempt completion commit or roll back together. Runtime has no direct write privilege on check-in policies, choices or receipts, no method-column insert privilege and no direct ciphertext SELECT. Owner-controlled functions validate the current actor. As elsewhere in this app, a compromised trusted server/runtime credential is outside the protection offered by browser request checks.

## Privacy and limits

This feature stores no camera image, probe embedding or numeric face/PAD score. The existing encrypted reference follows its enrollment notice. Minimal outcome/choice receipts and policy history remain alongside attendance and contain session/actor/revision/outcome metadata. Withdrawal or template deletion blocks unfinished checks but does not delete a legitimate saved attendance history. Old check-in token rows are removed on the student's next eligible issuance after seven days; this is not a continuously scheduled cleanup service.

The existing camera lifecycle stops on hidden/left pages and within 60 seconds. It uses local preview only until the explicit capture. Buffer cleanup and worker exit reduce transient retention; this is not a guarantee against operating-system dumps or a compromised server.

The original PAD pilots sometimes ranked phone photos above genuine faces, and motion trials timed out. This update does not repair or conceal those results. Per-session test cutoffs are experimental engineering settings, not a validated identity/liveness decision. A qualifying photo/replay or injected camera frame can still cause a wrong mark. Use synthetic attendance and voluntary own-face testing with staff review. Representative participants/attacks, independently evaluated calibration, real multi-process PostgreSQL contention/recovery testing and deployment review remain outstanding.

The release runner's synthetic vectors, mocked worker adapters and isolated PGlite fixtures establish software behavior only. They are not camera acceptance, biometric accuracy or security certification. The packaged host report is separate from the report produced on your Windows installation. The native smoke check loads models and synthetic inputs; it does not prove live-face performance.
