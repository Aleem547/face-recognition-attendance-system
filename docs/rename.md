# Project name update

The current project name is **Face Recognition Attendance System**. This release applies that name to the application title and authentication display name, login, sidebar, navigation, camera pages, footer, download filenames, documentation, npm package, setup helper filenames, screenshots and source archive.

## Update the already configured Windows installation

Finish any timed class and stop the current application with **Ctrl+C** in its original server terminal. From this extracted source folder run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-ProjectRename.ps1
```

The default path points to the existing installation in Downloads. For another location, supply `-ProjectPath 'C:\Your\Existing\Project'`.

The updater verifies recognized source, preserves changed originals in a private source backup, applies the name update, updates only the package-name fields of existing dependency metadata, and rebuilds using the installed Next.js. The PowerShell wrapper then starts the server. A failed build restores the previous source and production build. Unknown local edits are preserved and stop the update before application writes. An already installed update is recognized without another build.

The application's existing directory, PostgreSQL schemas and roles, environment variable names, HTTP protocol identifiers, cookie prefix, model IDs and Python module paths remain compatibility identifiers. Retaining them keeps existing configuration, accounts, encrypted templates, attendance records, client requests and model evaluation files usable. The name update performs no SQL migration and does not rotate keys or change stored consent notices. Existing private backup/archive filenames are historical records.

## GitHub source

Use this updated archive for the repository instead of the earlier download. The recommended repository slug is `face-recognition-attendance-system`; the README title uses the full project name. The fresh source under `application/` already has the new name and does not need the installed-project updater.
