# Local setup

This guide is for a **new, separate development checkout and database**. The source package is not an installer over an existing running project. Keep any established `.env.local`, database, accounts and original biometric key in their current installation.

## Requirements

| Component | Release baseline |
| --- | --- |
| Node.js | 24; the application checks require Node 24 or newer |
| Web dependencies | Install the committed `application/package-lock.json` using `npm ci` |
| Database | Dedicated PostgreSQL development database; local user evidence used PostgreSQL 18.6 on Neon |
| Face engine, optional | 64-bit CPython 3.12 in `application/.venv-face` |
| Browser | Localhost camera support; preview still requires browser permission and the application's choices |

## 1. Install source dependencies

From the extracted repository root:

```powershell
Set-Location .\application
npm ci
Copy-Item .env.example .env.local
```

For this new installation, edit `.env.local` privately to set `DATABASE_URL` to the database owner connection and `BETTER_AUTH_URL` to `http://localhost:3000`. Keep certificate verification enabled (`sslmode=verify-full`). Do not commit this file. For an established installation, do not replace its environment file with the example.

## 2. Initialize a fresh database

In your database provider's SQL editor, connect as the owner to the **empty development database**. Run the complete files in `application/db/migrations` individually in this order:

| Order | File |
| --- | --- |
| 001 | `001_initial_schema.sql` |
| 002 | `002_authentication.sql` |
| 003 | `003_persistent_register.sql` |
| 004 | `004_camera_choice.sql` |
| 005 | `005_biometric_enrollment.sql` |
| 006 | `006_controlled_verification.sql` |
| 007 | `007_session_research.sql` |
| 008 | `008_automatic_checkin.sql` |
| 009 | `009_class_automation.sql` |

Each file contains its own transaction and version guard. If one fails, stop and inspect that error before continuing. Do not rerun an already recorded migration or drop existing schemas to make it run. The migrations do not insert user accounts, student images, attendance records, enrollment templates or class opt-ins.

The full current UI expects this schema, even if you leave all biometric features disabled. Existing installations must inspect their recorded migration versions and apply only missing changes through their established setup procedure.

## 3. Configure authentication and create trusted accounts

Still inside `application`:

```powershell
node --env-file=.env.local scripts/configure-auth.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\New-ProjectAccount.ps1 -Role admin
```

Authentication setup creates a random restricted runtime credential and auth secret when absent, persists them privately, and verifies the role's privileges. The account helper prompts locally for name, email and a hidden password. There is no bundled account or public self-registration. Create teacher/student accounts with the same helper's `-Role teacher` or `-Role student`, then link the appropriate account through the administrator interface.

## 4. Start the application

```powershell
npm run build
npm start
```

Visit [http://localhost:3000](http://localhost:3000) and sign in with the account just created. Administrator pages manage students, courses, enrollment, class sessions and attendance. Enrollment is captured when attendance opens. A complete register can be closed and exported.

During source development, use `npm run dev` instead. Development output is `.next-dev`; production output is `.next`. Do not run production builds concurrently in the same checkout. If port 3000 is already occupied by your Face Recognition Attendance System server, use that server or stop it in its original terminal before starting another; do not terminate an unknown process.

## 5. Optional face engine and choices

Manual attendance is available without biometric enrollment. For the experimental workflows, install the native engine using the absolute path to your 64-bit CPython 3.12 executable:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Setup-FaceEngine.ps1 -PythonExe 'C:\Path\To\Python312\python.exe'
node --env-file=.env.local scripts/configure-biometric.mjs
node --env-file=.env.local scripts/configure-verification.mjs
node --env-file=.env.local scripts/configure-session-research.mjs
node --env-file=.env.local scripts/configure-auto-checkin.mjs
node --env-file=.env.local scripts/configure-class-automation.mjs
```

Replace the Python path with your actual executable. The setup creates `.venv-face`, installs the hashed requirements, obtains manifest-pinned model weights, and runs engine checks. It needs network access to those upstream sources. Model weights and virtual environments are deliberately absent from this repository.

The biometric configuration creates a server encryption key for a fresh installation. Back it up privately with the associated database state. Never regenerate an existing key to repair enrollment. Configuration does not grant any student's consent or enable any class policy.

Restart the app. A linked student can use Camera & consent, Face enrollment, and Face comparison. Preview, enrollment, comparison, and automatic check-in are separate choices. Live comparison needs an additional explicit acknowledgement for each run. A staff member must enable a class's experimental policy before check-in becomes eligible.

## Software checks

No additional manual test session is required to read or publish this source package. The project has prior isolated check/build evidence; see [status](status.md). For future code changes, the existing commands include:

```powershell
npm run typecheck
node scripts/release-check.mjs --project . --output ..\private-check-reports
node tests/camera-overlay.mjs
node tests/live-comparison.mjs
```

The release check also builds the application. Stop the app before running checks that build in the same checkout. Test reports belong outside the public repository. Software checks do not validate biometric accuracy or the user's remaining physical-camera/manual acceptance scenarios.

## Recovery and operational limits

The repository is not a database backup. Keep database archives, original keys and operational reports private. A source rollback does not roll back SQL migrations or restore encrypted data. Native backup and a separate disposable restore were demonstrated in the local project, but their private archives and reports are not included here. See the preserved [recovery notes](../application/docs/RECOVERY.md) and [operations](../application/docs/OPERATIONS.md).
