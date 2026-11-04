param(
    [Parameter(Mandatory=$true)]
    [string]$RepositoryUrl,
    [switch]$Push
)

$ErrorActionPreference = 'Stop'
$attendReleaseRoot = $PSScriptRoot
if ($RepositoryUrl -notmatch '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?$' -and
    $RepositoryUrl -notmatch '^git@github\.com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?$') {
    throw 'Use your exact GitHub repository HTTPS or SSH URL, without tokens or embedded passwords.'
}
function Invoke-AttendGit {
    param([string[]]$GitArguments)
    & git @GitArguments
    if ($LASTEXITCODE -ne 0) { throw 'A Git command failed. Stop here; no force push will be attempted.' }
}
Push-Location -LiteralPath $attendReleaseRoot
$attendPathList = $null
try {
    if (Test-Path -LiteralPath (Join-Path $attendReleaseRoot '.git')) {
        throw 'This directory already has Git history. Use the existing repository workflow; this helper only creates one fresh initial commit.'
    }
    & node tools/verify-release.mjs
    if ($LASTEXITCODE -ne 0) { throw 'The source release did not verify. Nothing was staged.' }
    $attendAuthorName = & git config user.name
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($attendAuthorName)) { throw 'Configure your own Git user.name before publishing.' }
    $attendAuthorEmail = & git config user.email
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($attendAuthorEmail)) { throw 'Configure your own Git user.email (a GitHub no-reply address is also suitable).' }
    $attendRemoteRefs = & git ls-remote --heads --tags $RepositoryUrl
    if ($LASTEXITCODE -ne 0) { throw 'GitHub authentication or repository access failed. No repository was initialized.' }
    if ($attendRemoteRefs) { throw 'The destination already has branches or tags. Existing remote history is preserved; use a separate reviewed import.' }
    $attendFiles = (Get-Content -LiteralPath 'release-files.json' -Raw | ConvertFrom-Json).files.PSObject.Properties.Name
    $attendExpectedPaths = @($attendFiles) + @('release-files.json')
    $attendPathList = [System.IO.Path]::GetTempFileName()
    $attendPathBytes = [System.Text.UTF8Encoding]::new($false).GetBytes((($attendExpectedPaths | ForEach-Object { ':(literal)' + $_ }) -join [char]0) + [char]0)
    [System.IO.File]::WriteAllBytes($attendPathList, $attendPathBytes)
    Invoke-AttendGit -GitArguments @('init', '-b', 'main')
    Invoke-AttendGit -GitArguments @('remote', 'add', 'origin', $RepositoryUrl)
    Invoke-AttendGit -GitArguments @('add', "--pathspec-from-file=$attendPathList", '--pathspec-file-nul')
    $attendStaged = @(& git -c core.quotepath=false diff --cached --name-only)
    if ($LASTEXITCODE -ne 0 -or (Compare-Object ($attendExpectedPaths | Sort-Object) ($attendStaged | Sort-Object))) {
        throw 'The staged file list differs from the reviewed source list. Review before committing.'
    }
    Invoke-AttendGit -GitArguments @('commit', '-m', 'Prepare Face Recognition Attendance System local research prototype source release')
    if ($Push) {
        Invoke-AttendGit -GitArguments @('push', '-u', 'origin', 'main')
        Write-Host 'One source-release commit pushed to your selected repository.'
    } else {
        Write-Host 'One local source-release commit created. Push it when ready with: git push -u origin main'
    }
} finally {
    if ($attendPathList) { Remove-Item -LiteralPath $attendPathList -Force -ErrorAction SilentlyContinue }
    Pop-Location
}
