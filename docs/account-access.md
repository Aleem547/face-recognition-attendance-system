# Student registration and role-specific login

## Student flow

Open `/login` and choose **Create an account**. Enter your full name, student/enrollment number, email and a password of 12–128 characters, then confirm the password. Registration signs you into a pending approval page. You can later use **Student login** with the same email and password. Your class records become available after an administrator approves your student details.

Approval does not enroll a new student in a course automatically. Administrators manage course enrollment in the existing workspace. Camera enrollment and face comparison remain separate choices.

## Administrator and teacher flow

Choose **Admin / Staff login** on `/login`, or open `/admin/login`. Use your existing assigned account. Administrators go directly to `/admin`; teachers go to their attendance workspace. `/student/login` opens the student portal. The selected tab does not assign or change the account's role.

An administrator opens **Admin panel → Student registrations**, checks the request's name, email and student number, then selects either **Create new student record** or the correct existing active, unlinked student. Choose **Approve** to activate access or **Reject** to keep the request inactive. Linking preserves the chosen record's existing enrollments and attendance history. A record linked to another account cannot be reassigned through approval.

The public form creates only inactive student profiles. It never creates administrators or teachers. If the installation has no administrator, the database owner uses the existing private `application/scripts/New-ProjectAccount.ps1 -Role admin` helper with the established private configuration; no default administrator password is supplied. Public registration does not verify email ownership, so an administrator must verify identity before approving a link.

## Existing Render deployment

1. Preserve the established private configuration and database backup. Apply only `application/db/migrations/010_student_registration.sql` as the database owner, or run `application/scripts/apply-student-registration.mjs` with the existing private owner/runtime environment file. The helper enforces certificate verification and checks the restricted runtime role. Do not reapply migrations 001–009 or replace any existing account or encryption key.
2. Publish this update to the service's configured Git branch, `render-free-20261104200805440`. The supplied update package prepares a separate Git worktree, verifies source checksums, builds it, applies migration 010, and pushes without force. The original working directory and its private files remain in place.
3. In the existing Render web service, choose **Manual Deploy → Deploy latest commit**. Automatic deployment is disabled in the current Blueprint. Keep all existing private runtime environment values and the Free plan. No new hosting resource or secret is required.
4. Open the hosted `/login`. It should show **Student login**, **Admin / Staff login** and **Create an account**. An administrator can approve genuine registration requests in the new panel.

Until the database update, source publication and Render deployment complete, the hosted login page continues to show the previous version. Applying migration 010 alone is compatible with the previous application; it does not create users or alter existing attendance. If a deployment needs to be rolled back, retain the additive schema and use Render's previous application version. Do not drop the registration table or reset the database.

## Validation

The update is checked against isolated PGlite databases using the actual Better Auth HTTP handlers and SQL migration. Coverage includes signup, pending sessions, administrator approval and rejection, linking existing enrollments, role and origin guards, duplicate registrations, failed-write cleanup and rate limits. Existing authentication and persistent attendance suites, TypeScript and a production build are also checked. These checks do not create accounts or change data in the hosted database.
