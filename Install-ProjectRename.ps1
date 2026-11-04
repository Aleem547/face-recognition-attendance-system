param([string]$ProjectPath = (Join-Path $HOME 'Downloads\AttendAI_2_0'))
$ErrorActionPreference = 'Stop'
$attendRenameRoot = $PSScriptRoot
Write-Host 'Updating the project name to Face Recognition Attendance System.'
Write-Host 'Finish current timed classes and stop the existing server with Ctrl+C before installation.'
& node (Join-Path $attendRenameRoot 'tools\rename-installed.mjs') --project $ProjectPath
if ($LASTEXITCODE -ne 0) { throw 'The name update did not complete. Read the result above before retrying.' }
Set-Location -LiteralPath $ProjectPath
Write-Host 'Starting Face Recognition Attendance System at the configured local origin.'
& npm.cmd start
if ($LASTEXITCODE -ne 0) { throw 'The server did not start. The renamed source and its backup are preserved.' }
