# Private database backup and disposable recovery drill

Source backups protect changed code only. PostgreSQL stores accounts, sessions, consent, encrypted templates, marks and receipts. Preserve the exact corresponding encryption key separately; rotating or losing it can make restored templates unreadable. This release neither exports nor rotates keys.

## Create a private archive

Install/use a PostgreSQL `pg_dump` version compatible with the server (same major version is the clearest choice). Ensure `pg_dump` is on PATH, keep the existing owner `DATABASE_URL` in the local `.env.local`, and choose a private destination outside the project/git. The backup helper requires certificate-verified TLS and passes credentials only in the child process environment. It suppresses native diagnostic output, refuses an existing output filename, writes a temporary archive and publishes it only after success. It makes a consistent pg_dump snapshot; the app does not need to stop for that archive, though a stable maintenance window makes the later comparison easier.

```powershell
Set-Location "$HOME\Downloads\Face_Recognition_Attendance_System"
$backupFile = Join-Path $HOME ('Face_Recognition_Attendance_System_Private_Backups\attendai_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.dump')
node --env-file-if-exists=.env.local scripts/backup-database.mjs --output $backupFile
if ($LASTEXITCODE -ne 0) { throw 'Backup not confirmed.' }
pg_restore --list $backupFile
```

The archive contains sensitive authentication and biometric/attendance data. Keep it in encrypted storage with restricted OS access, separate from ordinary research exports. The script's POSIX mode is useful on Unix; Windows file access follows the destination's NTFS ACLs, which you must configure appropriately. Do not send the archive, `.env.local`, secrets or encryption key as troubleshooting attachments. No archive is included in this package.

An archive listing checks readability only. A pg_dump database archive does not include cluster-level role creation, database creation, the app's environment or encryption keys. Keep a separate private inventory of required owner/runtime roles and grants. Do not assume a source rollback or a successful listing establishes recovery.

## Restore only into an explicitly disposable local database

Use a separate local PostgreSQL instance/database and test-only credentials. Do not point pg_restore at the existing application database. Create the required owner and `attendai_app` roles in that disposable instance, preserving the restricted runtime's lack of superuser/BYPASSRLS privileges. Restore role/grant/ownership arrangements deliberately; blindly removing all ACLs may change security behavior. A restore may require matching the source owner role or reviewed ownership mapping.

Set a libpq service entry named `attendai_restore_test` that points ONLY to the disposable database, with its corresponding local password file and local connection settings. Inspect that service's host/port/database before using it. The following command deliberately omits destructive --clean/--create options:

```powershell
pg_restore --dbname='service=attendai_restore_test' --exit-on-error --single-transaction $backupFile
```

If role/ownership/grant restoration fails, keep the original archive and correct the disposable test configuration; do not retry against the live database or drop live tables. Exact cluster role creation and connection settings depend on your existing server and are not invented by this bundle.

In a separate private app checkout with the corresponding original encryption key, point only that test checkout's owner/runtime settings to the disposable database. Keep the live project settings untouched. Check all nine migration records, synthetic course/session/roster/mark/receipt counts, authentication mapping, restricted runtime permissions and RLS, and decryption of a voluntarily created disposable test template. Never copy a real participant's template into an unrelated demonstration environment.

Use the software suites for behavior and a real restored sign-in/read/correction/decryption test for recovery evidence. Record archive timestamp, disposable destination alias, restored synthetic counts, access check and decryption outcome without secrets. Only then mark backup_restore_drill passed. Delete disposable test copies under the recorded retention policy. Multi-process concurrency, workload scale, clock-failure combinations and wider disaster recovery remain separate tests; this drill does not certify them.
