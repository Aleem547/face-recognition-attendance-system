# Complete the local project — deployment excluded

This checklist closes local software work and records the remaining evidence honestly. The installer performs the software checks, build, native model readiness check and additive database setup. Its report is not a real-camera test. Preserve your existing credentials and encryption key; the update does not rewrite them.

## 1. Install once and open the app

Run the top-level `Finish-Face Recognition Attendance System.ps1`. Use the configured sign-in origin and keep the server running. Use synthetic class/account records and voluntary face tests. Existing administrator, teacher and student accounts are reused. Accounts lists existing accounts; create controlled accounts with the trusted local `scripts/New-ProjectAccount.ps1 -Role teacher` (or `student`) workflow. Public sign-up and email password reset are not prerequisites for this controlled local release.

## 2. Perform all acceptance checks

In `Downloads\Face_Recognition_Attendance_System_Final_Evidence\local-acceptance.json`, replace each `not_run` only after its check. Set `status` to `pass` or `fail` and add a brief `evidence` note naming the local test session/time and result. Do not include passwords, student names, images or encryption keys. The completion script rejects missing checks or passes without notes. These are operator-reported results, not independent certification.

| Check ID | Local procedure and required observation |
| --- | --- |
| auth_roles | Sign in separately as admin, assigned teacher and student. Confirm teacher sees only assigned courses and student sees only their own records. Try an unauthorized session URL; access must fail. Sign out and confirm protected pages require sign-in. |
| manual_register | Create a course with synthetic enrollment, schedule/open a class and save Present/Absent/Late/Excused. Reload: all saved marks remain. End an enrollment: the already-frozen roster remains. Close only when every entry has a status. |
| auto_present | Create a near-future controlled class, explicitly choose experimental test cutoffs and arm timing before start. With a voluntarily enrolled linked student and current check-in choice, a qualifying capture after start and before late cutoff saves Present once. Record the policy revision. A failed capture stays unmarked; never adjust results to make this pass. |
| auto_late_boundary | The automated suite checks exact 08:45 equality for an 08:30/15-minute rule. In a short real test class use another eligible synthetic linked account, arrive after the configured cutoff but before class end, and verify Late. Arrival is server admission time before inference. Do not change your system clock to test it. |
| auto_absence_preserves_marks | Keep the server running until class end plus 30-second processing allowance and the next clock tick. Unmarked synthetic roster entries become Absent; earlier Present/Late/Excused stay unchanged. The register closes and receipts identify automatic absence. |
| correction_csv | As staff correct a saved mark with a reason, check both revisions and export the complete session CSV. Refresh a stale second tab and confirm conflicting revision saves are refused. Verify that methods distinguish manual, experimental face and automatic absence. |
| restart_gap_review | In a separate synthetic class stop the server long enough to miss its class window, then restart. Confirm Staff review required rather than fabricated automatic absence. Inspect the register and complete it through staff workflow. This demonstrates one interruption case, not all concurrency/recovery scenarios. |
| camera_denied_manual | Deny camera permission, leave/hide the capture page and test an upload/network timeout. Camera streams must stop; a failed capture is not a fake-face verdict. Inspect saved attendance before retrying uncertain uploads. Staff can record attendance without camera consent. |
| withdraw_delete | On a disposable voluntarily enrolled student test withdrawal and deletion. Refresh: the active encrypted template/comparison result is unavailable and unfinished attempts cannot use it. Previously legitimate attendance receipts remain. Run the documented expiry cleanup separately. |
| analytics_scope | Close two synthetic classes with mixed statuses. Overview course analytics must use (Present+Late)/(frozen roster entries-Excused), exclude open/cancelled classes and show N/A for zero denominator. Check teacher/student scoping and complete CSV export. |
| backup_restore_drill | Follow RECOVERY.md using a disposable database, not the live configured database. Verify synthetic records, auth mapping, migrations, privileges and decryption with the corresponding original key. Record what was restored; an archive listing alone does not pass. |

If you have only your own account/face, perform a self-only pilot and leave representative reliability validation pending. Do not create false identities or consent records to fill a study table.

## 3. Record face/PAD evidence

Follow RELIABILITY_STUDY.md. Select explicit error budgets before calibration. Collect genuine, impostor, print, phone-photo and replay conditions. Keep development and evaluation participants/reference identities/capture sessions separate. Include failures and use whole presentation attempts, not correlated video frames counted as separate people. Browser own-account exports cannot establish impostor FMR; the private offline scorer supports a separately consented or licensed study.

The final report can be created without a biometric report. It will clearly say biometric validation is pending. Do not substitute synthetic test scores or the earlier overlapped pilot for new untouched evaluation evidence. A successful empirical research report still requires review of representativeness, sampling, attacks and the operating policy; it does not approve institutional use.

## 4. Generate the final result

Open a second PowerShell terminal in the installed project after updating the acceptance JSON. Pick the newest report generated on your installation by this release:

```powershell
Set-Location "$HOME\Downloads\Face_Recognition_Attendance_System"
$evidenceRoot = Join-Path $HOME 'Downloads\Face_Recognition_Attendance_System_Final_Evidence'
$softwareReport = Get-ChildItem $evidenceRoot -Filter 'Face_Recognition_Attendance_System_Local_Completion_Report_*.json' -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $softwareReport) { throw 'Run the completion installer first.' }
$finalReport = Join-Path $evidenceRoot ('Face_Recognition_Attendance_System_Final_Report_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.json')
node scripts/close-project.mjs report --software $softwareReport.FullName --acceptance (Join-Path $evidenceRoot 'local-acceptance.json') --output $finalReport
```

If you have completed a real study, add `--biometric (Join-Path $evidenceRoot 'reliability\evaluation-report.json')` to that same Node command. Keep the original generated reliability report intact; edited reports are rejected. Preserve each study's development candidate and raw observation exports.

Possible states are software incomplete, local acceptance pending, local software accepted with biometric validation pending, or local acceptance complete with biometric limitations. `projectComplete` and biometric approval remain false/not granted because this engineering package cannot establish the original reliable face/PAD goal by itself. Deployment is explicitly excluded. No additional code ZIP is required merely to run these steps; a failing model or software defect still requires a real fix and retest.

## 5. Local operation after the handover

Use `npm run start` after a successful production build. Run only one server/build per project folder. Keep the server running through automatic classes. Run `node --env-file-if-exists=.env.local scripts/purge-biometric.mjs` for the existing bounded expiry cleanup; this removes expired/invalid active templates and research results according to existing notices, while preserving audit receipts. It is a manually invoked maintenance action, not a hosted scheduler.

Store private evidence and database backups outside git. Keep the original encryption key with its database recovery material. A source restore does not undo a committed attendance transaction. Live PostgreSQL multi-process contention/load tests and wider independent security assessment are not represented by isolated PGlite tests and remain separate evidence limits.
