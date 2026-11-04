# Face Recognition Attendance System — local completion handover, 2 November 2026

Deployment is excluded at the user's request. This is a consolidated implementation and verification package for the existing single-workspace Windows installation, with an explicit research reliability gap.

| Area | Delivered implementation | Evidence boundary |
| --- | --- | --- |
| Accounts/permissions | Controlled admin, teacher and student accounts; server authorization and database RLS | Isolated authentication/access tests; installed sign-in checks still required |
| Persistent register | Courses, enrollment, sessions, frozen rosters, statuses and revisions | Regression tests; local acceptance record |
| Automatic timing | Scheduled opening, server-arrival Present/Late, end-of-class Absent, closure, clock-gap review | Synthetic clock/database/HTTP tests; real installed operation remains separate |
| Corrections/exports | Reasons, immutable receipts, complete paginated session CSV | Regression tests; real correction/export check |
| Analytics | Closed-session course totals, correct frozen denominators, scoped student/teacher access, paginated CSV | New isolated RLS/denominator/pagination suite; installed UI check |
| Enrollment/privacy | Separate choices, encryption, withdrawal/deletion, expiry cleanup | Existing lifecycle/crypto/permission tests; actual key/retention/recovery checks remain local |
| Face/PAD | Existing pinned models; optional paired research and explicit experimental check-in policy | Models unchanged; prior phone-photo overlap/motion timeouts remain unresolved |
| Reliability tools | Labelled browser success/failure exports, separately consented offline scorer, development calibration, disjoint evaluation, condition metrics | Evaluator behavior tested with synthetic scores; no new real biometric evaluation claimed |
| Local handover | Guarded installer, source backup/restore, 20-suite runner/build, blank acceptance templates and final report generator | See top-level HOST_VALIDATION.json; user Windows/native/database/camera checks are not predeclared passed |
| Recovery | Private pg_dump helper and disposable restore procedure | No real database dump or restore performed by delivery; actual drill pending |
| Deployment | Excluded | No hosting or publishing performed |

The final report does not turn pending evidence into a pass. Passing software, a small self-only pilot or user-selected thresholds do not establish reliable recognition/liveness or institutional suitability. The original validated automatic-attendance goal remains incomplete until representative independent evaluation and operating-policy review support it. This package provides the local code/tools/runbook to perform the remaining work in one sequence; failing models or uncovered defects still require fixes.

This project is an independent continuation, separate from the 2024 academic work. Preserve original authorship and all included third-party notices. The broad design report remains a proposal; features or numerical targets described there are not retroactively claimed as implemented or validated.
