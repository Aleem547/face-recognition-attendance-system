param([Parameter(Mandatory=$true)][string]$PythonExe)

$ErrorActionPreference = "Stop"
$attendAiRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $attendAiRoot
$attendAiPackage = Get-Content -LiteralPath ".\package.json" -Raw | ConvertFrom-Json
if ($attendAiPackage.name -ne "face-recognition-attendance-system") { throw "Run this setup inside Face_Recognition_Attendance_System." }
if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) { throw "The selected Python executable does not exist." }

function Invoke-Checked {
    param([string]$Executable, [string[]]$ArgumentList)
    & $Executable @ArgumentList
    if ($LASTEXITCODE -ne 0) { throw "A face-engine setup step failed. Stop here and send its output." }
}

Invoke-Checked -Executable $PythonExe -ArgumentList @("-c", "import sys,struct; assert sys.implementation.name=='cpython' and sys.version_info[:2]==(3,12) and struct.calcsize('P')==8, 'Use 64-bit CPython 3.12'; print('Selected Python:',sys.version.split()[0])")
$attendAiVenv = Join-Path $attendAiRoot ".venv-face"
$attendAiPython = Join-Path $attendAiVenv "Scripts\python.exe"
if (Test-Path -LiteralPath $attendAiVenv) {
    if (((Get-Item -LiteralPath $attendAiVenv -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "The .venv-face path is linked elsewhere. Use a dedicated local environment for Face Recognition Attendance System."
    }
    if (-not (Test-Path -LiteralPath $attendAiPython -PathType Leaf)) { throw "An incomplete .venv-face directory exists. Preserve it for review before replacing it." }
} else {
    Invoke-Checked -Executable $PythonExe -ArgumentList @("-m", "venv", $attendAiVenv)
}
Invoke-Checked -Executable $attendAiPython -ArgumentList @("-c", "import sys,struct; assert sys.prefix!=sys.base_prefix and sys.version_info[:2]==(3,12) and struct.calcsize('P')==8, 'A dedicated 64-bit Python 3.12 environment is required'")
Invoke-Checked -Executable $attendAiPython -ArgumentList @("-m", "pip", "install", "--only-binary=:all:", "--require-hashes", "--no-cache-dir", "-r", "face-engine/requirements.lock")
Invoke-Checked -Executable $attendAiPython -ArgumentList @("-m", "pip", "check")
foreach ($attendAiAction in @("test", "models", "doctor", "smoke")) {
    Invoke-Checked -Executable $attendAiPython -ArgumentList @("face-engine/manage.py", $attendAiAction)
}
Write-Host "CPU face engine is ready. Web enrollment is configured separately."
