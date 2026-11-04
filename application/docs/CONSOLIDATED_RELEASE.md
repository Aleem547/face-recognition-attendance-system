# Consolidated update — 30 October 2026

This is a guarded update for the existing Face Recognition Attendance System 0.6.0 installation, not a fresh database bootstrap or a validated automatic attendance release.

## Included

The bundle collects the current app, database migration source, existing regression suites and CPU-engine source. It adds `/guide`, a workspace navigation link, corrected `/api/health` metadata, current README/status documents, demonstration and operations notes, and `scripts/release-check.mjs`. The health response formerly said face inference was not implemented; it now identifies experimental comparison and staff-recorded attendance while explicitly leaving dependency readiness unchecked.

The installer compares every source path with the supplied baseline or this update's exact target. Unknown edits stop installation before app writes. Only changed/new files are written. Existing changed files and a restore receipt are saved under `.attendai-backups/consolidated-...`. The installer does not copy that directory, any environment file, credentials, camera image or database export into this bundle. Repeating the installer is safe for files already equal to the target, although it intentionally reruns the requested validation.

The application package version remains 0.6.0 so existing CPU/research source-version requirements continue to apply. No dependency, package lockfile, encryption key, environment setting or database migration is changed. Starting a build creates/updates generated `.next` output; that output is not part of source rollback.

## Validation and handoff

The combined runner checks authentication, manual register behavior, camera consent, enrollment encryption/deletion, comparison tokens, session eligibility, receipt order, browser transport/lifecycle, bounded image requests, paired research contracts and evaluation bookkeeping. It stops at the first failure, records remaining work as not run, and builds only after all suites pass. It does not connect to Neon through the test suites, run a camera trial, or generate an attendance mark.

The report contains suite names, statuses, exit codes, elapsed times and counts of PASS lines reported by the existing tests. Counts are software assertions, not accuracy percentages or independent security certification. Console logs are not copied into the JSON. The build uses the project's existing settings and may load the existing environment in the usual Next.js way; the installer and reporter never read or export `.env.local` themselves.

Read the top-level bundle `VALIDATION.md` for checks actually completed before delivery. The user's installed version, source preflight and Windows build still need the single run provided with this release. Do not report those as passed in advance.

## Remaining original goal

Reliable presentation-attack detection and an approved automatic attendance decision are still missing. Source consolidation, guide/status fixes and passing software checks cannot resolve that research problem. Manual attendance and optional comparison remain the present working scope; the original goal of validated automatic face attendance is not declared complete.
