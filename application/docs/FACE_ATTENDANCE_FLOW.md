# Camera capture and saved attendance

This update uses the interaction in the original uploaded `main.py` as a reference: start a camera, present an enrolled face, recognise it, then record attendance. It updates the existing signed-in student check-in. It does not add a shared classroom camera that identifies multiple students.

## What changed

Select a currently open class and choose Check in with camera. After camera permission and eligibility are confirmed, a three-second local countdown gives you time to position your face and lets the camera settle. Exactly one fresh JPEG is then processed. There is no automatic retry, background capture or extra image retention. Preview only still never submits attendance.

An accepted server response must include a receipt and a saved experimental-face Present/Late record before the UI displays success. The result remains visible next to the camera and at the top. Open this class register opens the exact session named by the attempt, even after a successful check-in removes that class from the eligible list. The register still applies its existing server-side permissions; the URL does not grant access.

Face-match rejection and PAD rejection have different amber messages. A generic completed capture is no longer shown as a green attendance success. An uncertain result or timeout directs you to inspect the saved register before trying again.

Hiding the page, cancelling, changing the selected class or leaving the page cancels the countdown. A delayed permission grant or cancelled countdown cannot start a later upload. The camera remains bounded by the existing expiry and 60-second limit.

## Reference details

The original `TrackImages()` loops over detected faces, accepts its LBPH `conf < 50` condition, and constructs a student/date/time row. Its CSV append is after the loop exits on `q`, so it writes the last recognised row at that point. This update retains Face Recognition Attendance System's immediate transactional server write on a qualifying capture, with its receipt and duplicate prevention.

Face Recognition Attendance System uses a different face representation and requires both PAD outputs. The old `conf < 50` rule is not copied into cosine or PAD fields. No model, reference template, class policy, database migration or credential is changed by this source update. The existing experimental policies and original face/photo overlap remain unresolved.

## Local retest

Keep the existing failed captures and completed AUTO-FACE-01 register. It contains two automatic absences; it does not demonstrate a saved Late check-in. Create a new future test session with enough time for sign-in and camera setup. Enable its timing before the scheduled start, using explicitly selected experimental cutoffs. A qualifying capture before the late boundary must create Present; a separate session or eligible student can test Late after the boundary. Inspect both the result receipt and Open this class register. A genuine capture that fails either gate remains a failed acceptance result; it must not be relabelled as a pass.

For a rejected capture, open Face comparison and export a labelled own-face attempt under its separate research choice. That provides diagnostic scores without adding image/embedding/score retention to actual attendance check-ins. Preserve failures and use the existing development/evaluation separation before choosing operating thresholds.

Automatic absence and closure must preserve any saved Present/Late/Excused record. A class containing only automatic absences tests the fill and close behavior; it does not test preservation of an earlier face mark. Models, live camera performance, Windows behavior and physical presence are not certified by the software tests.
