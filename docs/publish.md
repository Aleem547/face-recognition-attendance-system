# Publish one source-release commit

The extracted folder is already a complete source repository candidate. It is separate from the running Windows application and contains no Git history. Review the top-level README, screenshots, status and file list first. You do not need to rerun the paused manual acceptance tests to publish this documented prototype.

## Destination

Choose your GitHub account, repository name and visibility, and create an **empty** repository. Do not initialize it with a README or license; this package supplies its README and does not choose a project-wide license. Copy that repository's exact HTTPS or SSH URL.

If a destination already contains commits, preserve them and use a reviewed import/branch workflow. The helper below refuses an occupied destination and never force pushes.

## One command after review

Git, Node.js 24, your own configured Git author identity, and authenticated GitHub access must be available. Use Git's normal credential manager or SSH; do not put a personal token into the repository URL or a script.

From the extracted `Face_Recognition_Attendance_System` folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Publish-GitHub.ps1 -RepositoryUrl 'https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git' -Push
```

Replace both URL placeholders with your selected destination. The script verifies the release, checks author identity and destination access, initializes a fresh `main` branch, stages only the manifest's file list, checks that staged list, creates one initial commit and pushes it. It does not run `git add .` or copy a configured installation. Without `-Push`, it stops after the local commit.

If your author identity is missing, configure your own name and email using `git config --global user.name` / `git config --global user.email`, then rerun before a repository has been initialized. A GitHub no-reply email can keep a personal address out of the public commit. Do not use someone else's identity.

If the first push fails after the local commit was created, fix authentication/access and run `git push -u origin main` from this folder. Do not rerun the initial-release helper or create another commit just to retry the push.

## Optional: verify/export from the installed project

The provided source is sufficient; this optional helper is for someone who wants to confirm that their installed source matches this exact release. It reads only a fixed source allowlist and refuses changed/missing files before creating output. Unlisted files and additions are not copied. It accepts canonical Windows line-ending differences only when normalized bytes match the expected hash.

```powershell
node .\tools\export-current.mjs --project "$HOME\Downloads\Face_Recognition_Attendance_System\application" --output "$HOME\Downloads\Face_Recognition_Public_Source"
```

Run that from the extracted release folder; the output must be a new separate directory whose parent exists. Existing outputs are never overwritten. The installed environment, database, encryption key, archives and dependencies are not read or changed. Unknown source edits must be reviewed separately rather than silently included in a public export.

## What stays private

The package's `.gitignore` covers local environment files, credentials, native model binaries, images outside the two reviewed synthetic screenshots, data exports, logs, evidence and generated dependencies/builds. The publishing helper additionally stages an exact source list. Git ignore rules do not remove a secret that was already committed elsewhere; this helper only handles a fresh repository.

Official references: [adding locally hosted code to GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github), [Git ignore rules](https://git-scm.com/docs/gitignore).
