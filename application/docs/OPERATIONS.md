# Local operations and remaining deployment work

## Run locally

Use the existing configured project, Node.js 24, installed dependencies, development database and trusted accounts. Start with `npm run dev`. The existing Next.js configuration separates `.next-dev` from production `.next`. Do not run concurrent production builds in the same checkout.

After the combined check passes, `npm run start` starts the production build locally. Sign-in must use the origin already configured in the app. Do not change or publish credential files to make a demonstration work.

## Preserve state

Source backups do not back up PostgreSQL. Attendance records, authentication sessions, consent history and encrypted templates live in the configured database. Database backup/restore and retention need their own reviewed procedure. Keep encryption keys with their original database state; regenerating a key can make existing templates unreadable. The consolidated update does not rotate keys or alter accounts.

The printed JSON report contains no source contents, environment values, images or database rows. Source backup receipts identify changed files and hashes only. Do not upload `.env.local`, database exports or the whole installed `node_modules`/virtual environment as a troubleshooting substitute.

## Undo this update

Stop the app. Use the bundle's `restore.mjs` with `--project` and the exact backup ID printed during installation. Restoration refuses to overwrite later source edits. It restores only source files in the update, never the database, dependency lockfile or environment. Generated build files are outside source rollback; rebuild after restoring.

## Health and readiness

`/api/health` is a low-detail HTTP process response. An `ok` result does not prove that authentication, PostgreSQL, CPU inference or the live browser workflow is ready. The combined isolated tests/build and a separate signed-in environment check serve different purposes.

## Before deployment

Hosting the web interface does not automatically provide the existing local Python face worker, model storage or encryption-key operations. The current native process integration needs a compatible runtime. Public deployment still requires a reviewed runtime topology, HTTPS/origin settings, owner/runtime credential separation, database recovery checks, retention operations, live concurrency tests and the unresolved biometric decision work. The consolidated update does not publish or purchase hosting, enable public sign-up or establish production readiness.

## Experimental automatic check-in update

See `AUTOMATIC_CHECKIN.md`. Migration 008 is additive and preserves existing marks, keys and accounts. It creates no session policy or student check-in choice. Source restore does not roll back the database. Keep migration 008 and its receipts; do not drop tables to undo an app change. A policy change or disable invalidates unfinished captures. No public deployment or institution-wide use is approved by this update.
