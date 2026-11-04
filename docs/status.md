# Release status · 4 November 2026

**Working local research prototype; manual acceptance remains incomplete, biometric reliability remains unvalidated, and deployment is excluded.** The user chose to pause further manual testing. This source release does not change that decision or mark deferred items as passed.

## Evidence already available

| Area | Evidence / practical limit |
| --- | --- |
| Register | User screenshots showed saved Present/Late/Absent/Excused records, correction reason and revision history, CSV output, and a frozen roster preserved after enrollment ended. |
| Access | User observations showed administrator totals, teacher course scope, student-only records, denied access, and sign-out returning to login. This is observed workflow evidence, not a completed security audit. |
| Analytics | Administrator, teacher and student views demonstrated scoped totals. Closed-session rates use Present + Late and exclude Excused. |
| Experimental check-in | Local Present and Late results were saved with receipts; automatic completion preserved an existing Present and filled an unmarked entry as Absent. This demonstrates functionality, not biometric reliability. |
| Camera | The user confirmed the positioning box and account-name label were visible. A saved manual comparison and the installed live-comparison controls were shown. Actual native live latency was not measured. |
| Database recovery | The native backup and isolated disposable PostgreSQL restore eventually passed, including original-key decryption, trusted sign-in/read/correction checks and cleanup. Private backup material is excluded. |

## Recorded software validation before packaging

| Scope | Recorded result |
| --- | --- |
| Baseline application | 21 isolated suites, 423 named checks, production build passed in the existing validation workflow |
| Camera overlay | 21 named checks passed |
| Live comparison | 45 named checks passed, including worker protocol, lease/cancellation, HTTP adapters and isolated database integration |
| Overlay installer | Eight installer scenarios passed, including rollback, unknown-edit preservation and port checks |
| Browser fixture | Synthetic frames/API responses exercised explicit start, updating scores, single-frame concurrency, late-result discard, quality recovery and stop behavior; no JavaScript errors |

These counts refer to the recorded validation artifacts for the preceding implementation. They are not new physical-device measurements or substitutes for the remaining local acceptance observations. The source package adds a dependency lock for repeatable installs; packaging checks are listed separately in `RELEASE_CHECK.json`.

## Deferred or partial acceptance

| Item | What remains |
| --- | --- |
| Restart gap | Deliberately miss an armed class window and observe recovery/staff review behavior. |
| Camera denial / manual fallback | Complete the combined permission-denied, network-timeout and manual fallback browser scenario. |
| Withdrawal / deletion | Complete the combined template withdrawal, refresh/cancel, retained-attendance and purge observation. |
| Concurrent correction | Observe the stale second-tab conflict in the UI; backend conflict behavior has isolated coverage. |
| Analytics edges | Complete open/cancelled class and zero-denominator UI observations, and reconcile the current Windows acceptance file. |
| Live native speed | Measure sustained comparison on the user's actual camera/device if work resumes. The resident worker design alone is not a latency result. |
| Face / PAD study | Perform a controlled, labelled evaluation with predefined error budgets and appropriate coverage. High similarity or PAD scores from individual attempts are not accuracy statistics. |

The current acceptance file from the Windows installation was not re-read after the successful recovery drill. No remaining-item count or project-completion percentage is asserted here.

## Release boundary

Deployment preparation adds a read-only clock diagnostic, safe failure codes and a Docker configuration for one Node/Python service. Its component checks are recorded in `DEPLOYMENT_VALIDATION.json`. The Docker image has not been built in this preparation workspace, which lacks a Docker engine. The cause of the local class-clock warning, container behavior and public-host operation remain unconfirmed until the corresponding checks run on their actual environments.

The November 4 name update changes the current project title to **Face Recognition Attendance System**, including npm package metadata, UI copy, exports, documentation, setup helper names and synthetic screenshots. Compatibility identifiers for the existing database, configuration, cookies and inference protocols are retained. The name updater is source-only and performs a guarded rebuild; its own validation is recorded separately in `RELEASE_CHECK.json`.

This release packages existing source and current documentation for review and portfolio use. It does not deploy the app, publish private data, alter the running Windows installation, change acceptance flags, or approve unattended real-world attendance decisions.
