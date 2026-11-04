# Face and PAD reliability — one reproducible local workflow

The current SFace/YuNet and two MiniFASNet models are unchanged. An earlier phone-photo attempt scored above a genuine-face example; motion sessions did not establish successful completion. No numerical production cutoff is supplied. Threshold tuning cannot promise to repair those observations.

## Freeze the study before using evaluation results

The installer creates `Downloads\Face_Recognition_Attendance_System_Final_Evidence\reliability\research-plan.json`, development/evaluation folders, and a draft plan. Its four error budgets start as `null` and its acknowledgement is false. Set each budget to a chosen fraction in [0,1), review the model version/evidence kind, then set `acknowledged` to true. Targets express your intended experiment; they are not published safety standards. The proposed five genuine participants per split and twenty presentations per condition are minimum coverage warnings, not enough to establish a low population error rate. At 20 presentations, one error already changes the empirical rate by 5 percentage points.

Record the chosen camera, lighting, face distance, display brightness, print size/material, attack source and collection order in a private study notebook. Use anonymous participants and capture-session IDs. Enrollment and probe must be from separate capture sessions. Development and evaluation participant identities (including impostor reference identities) and session IDs must be disjoint. Use the same capture protocol/model versions for both splits. Freeze the candidate before viewing evaluation scores. A changed model/protocol/threshold requires a new untouched evaluation; do not recycle holdout results for tuning.

Required conditions are genuine face, impostor comparison, printed photo, phone photo and video replay. Include normal/dim/backlit environments and intended cameras across independent sessions. Keep an attempt ledger before capture, including camera-acquisition failures which may not reach the server. Do not drop a failed or inconvenient trial. Do not relabel according to model score. A label correction must preserve the original file and a correction note; evaluate only one clearly declared corrected record, never both as independent attempts.

## A. Browser same-frame observations

In Face comparison, grant the existing comparison choice, select optional paired PAD scoring and enable the labelled research export. Fill anonymous participant, enrollment session, probe session and camera IDs, choose the split/lighting and the presentation that will actually be used. For a photo/replay use only your own enrolled face under this page's notice and identify its attack instrument.

Capture once. Download the attempt JSON before the next capture or leaving the page; save every result including unsuccessful ones. Put it into the intended development/evaluation folder. The export contains one cosine and both PAD scores from that same processed frame, or null scores plus a failure outcome. It contains no image, embedding, account ID or reference-template ID. Scores are still sensitive research data. Withdrawal/result deletion clears the in-page export; previously downloaded files must be deleted separately when appropriate.

Failed browser requests are conservatively exported as processing failures (or timeout). A server quality rejection may therefore remain under processing_failed rather than quality_failed; all unsuccessful outcomes remain in end-to-end and failure denominators. If permission, browser closure or acquisition failure prevents an export, record that presentation manually with null scores and the observed failure, using the schema below. The attempt ledger, not a success-only download list, is the completeness reference.

The browser page compares your own reference only. It cannot measure the face false-match rate against another identity. Do not use another person's account or enroll their face into your account to bypass that constraint.

## B. Separately consented offline impostor and presentation study

The included `scripts/score-study.mjs` supports local JPEG pairs from a separately consented study or a properly licensed dataset. It reads private files explicitly listed in your own manifest; it does not read app templates or the database. Obtain permission for the intended reference/probe use and retain its record separately. No raw images are bundled or uploaded by this release.

Stop the local Face Recognition Attendance System server during native offline scoring. Prepare JPEGs matching the browser's intended capture framing (maximum dimension 640 and maximum size 1 MiB). Put them beneath the private manifest folder. No silent resize or preprocessing conversion is performed. An offline reference is a one-frame enrollment with the same engine; different acquisition pipelines and offline files do not prove real browser/camera performance.

Copy `docs/examples/offline-study-template.json` and edit it in a private study folder. Its acknowledgement starts false and sample paths are placeholders. Every row has anonymous metadata and relative `referenceImage`/`probeImage` paths. For genuine and attack presentations, subjectId equals referenceSubjectId; for an impostor pair they must differ. Use unique IDs and unique probe images. Reused references are permitted, but dependence must be disclosed. Do not compare an image with itself or assign the same image to different identities.

```powershell
Set-Location "$HOME\Downloads\Face_Recognition_Attendance_System"
node scripts/score-study.mjs --manifest 'C:\PrivateStudy\development-study.json' --output 'C:\PrivateStudy\scored-development'
```

Choose a NEW output directory; an existing tree is refused. Each attempted native comparison creates one JSON observation, including failed acquisition/quality/processing results. Exit code 2 means some attempts failed and their null-score rows were retained. Do not omit them. Copy these observations into the same split's observation folder alongside browser observations without replacing files or duplicating IDs. Keep raw images private and delete them under the study's consent/retention agreement.

Observation schema:

```json
{"schema":"attendai-observation-v1","id":"D01_attempt01","split":"development","subjectId":"D01","referenceSubjectId":"D01","sessionId":"D01_day2","referenceSessionId":"D01_enroll","cameraId":"laptop_cam","lighting":"normal","presentation":"genuine","attackInstrumentId":null,"capturedAt":"2026-11-02T00:00:00.000Z","modelVersion":"sface2021dec-yunet2023mar-v1|attendai-pad-minifas-research-v1","outcome":"timeout","similarity":null,"padV1":null,"padV2":null}
```

Presentation is genuine/impostor/printed_photo/phone_photo/video_replay. Outcome is processed/quality_failed/processing_failed/timeout. Processed observations require finite same-frame cosine in [-1,1] and each PAD score in [0,1]. Failures require all three scores null. Attack rows need an anonymous attackInstrumentId; genuine/impostor rows require null. IDs allow letters/digits/underscore/hyphen up to 64 characters. Do not replace failed scores with zero.

## C. Calibrate, freeze, then evaluate

```powershell
Set-Location "$HOME\Downloads\Face_Recognition_Attendance_System"
$study = Join-Path $HOME 'Downloads\Face_Recognition_Attendance_System_Final_Evidence\reliability'
node scripts/reliability.mjs calibrate --plan (Join-Path $study 'research-plan.json') --observations (Join-Path $study 'development') --output (Join-Path $study 'candidate.json')
```

Calibration sees development only. It selects an SFace minimum against the observed impostor FMR budget, and a shared minimum that BOTH PAD models must meet against each attack type's observed PAD acceptance budget. It then checks genuine end-to-end rejection and failure budgets. It stores development identities/session IDs/observation IDs and a data digest with the candidate. A missing condition, overlapping scores, excessive failures or insufficient coverage can prevent a usable candidate. The selected thresholds are research candidates and are never automatically applied to class policies. Separately calibrated components can fail the combined genuine budget; the report preserves that outcome.

Only after freezing that candidate, collect/use the untouched evaluation split:

```powershell
node scripts/reliability.mjs evaluate --candidate (Join-Path $study 'candidate.json') --observations (Join-Path $study 'evaluation') --output (Join-Path $study 'evaluation-report.json')
```

Output files are exclusive: existing candidates/reports are not overwritten. For a new study choose a fresh directory and retain the previous outcome. Exit code 2 indicates synthetic evidence, unmet budgets or no candidate; it is not permission to discard failures and repeat until success. Candidate/report digests detect accidental edits, not fraud or independent provenance. Data completeness and physical presentations still require the operator's ledger and review.

## Interpret the report

The report separates face false-match rate (impostor face-pass/scored impostors), PAD BPCER (PAD-rejected/scored genuine), PAD APCER for each attack instrument category (both-PAD-pass/scored attacks), joint acceptance, genuine end-to-end rejection/failure, and failure counts/rates. Unscored attacks cannot create an apparently perfect result because failure budgets are evaluated separately. Printed photos, phone photos and replay are never pooled into one reassuring number. Metrics are presentation counts; repeated identities, sessions and reused references are correlated. No population confidence interval is claimed.

`synthetic_demonstration` tests software only. `budgets_not_met` leaves validation unresolved. `empirical_budgets_met_review_required` means the submitted real research sample met the chosen empirical rules; representativeness, power, uncertainty, unseen attacks, camera injection and operational policy still need review. All outputs retain readyForAttendance=false and automaticAttendanceApproval=not_granted. Success here does not establish institutional suitability, certify liveness, replace attendance corrections or authorize unattended deployment.
