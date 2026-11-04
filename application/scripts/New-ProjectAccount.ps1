param(
    [ValidateSet("admin", "teacher", "student")]
    [string]$Role = "admin"
)

$attendProjectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $attendProjectRoot
try {
    $attendName = Read-Host "Display name"
    $attendEmail = Read-Host "Email address"
    $attendSecret = Read-Host "Password (12-128 characters, hidden)" -AsSecureString
    $attendConfirm = Read-Host "Repeat password (hidden)" -AsSecureString
    $attendPlain = [System.Net.NetworkCredential]::new("", $attendSecret).Password
    $attendRepeated = [System.Net.NetworkCredential]::new("", $attendConfirm).Password
    if ($attendPlain -cne $attendRepeated) { throw "Passwords do not match." }
    if ($attendPlain.Length -lt 12 -or $attendPlain.Length -gt 128) {
        throw "Use a password between 12 and 128 characters."
    }
    $attendPayload = @{
        name = $attendName
        email = $attendEmail
        password = $attendPlain
        role = $Role
    } | ConvertTo-Json -Compress
    # ASCII transport preserves Unicode input through Windows PowerShell's
    # native-process pipe. It is sent on stdin, never as a command-line secret.
    $attendEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($attendPayload))
    $attendEncoded | & node --env-file=.env.local --disable-warning=MODULE_TYPELESS_PACKAGE_JSON .\scripts\create-account.mjs
    if ($LASTEXITCODE -ne 0) { throw "Account creation did not complete." }
}
finally {
    Remove-Variable attendPlain, attendRepeated, attendPayload, attendEncoded, attendSecret, attendConfirm -ErrorAction SilentlyContinue
    Pop-Location
}
