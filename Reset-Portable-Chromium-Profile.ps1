$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $AppRoot "config.json"
$config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
$profileDir = [string]$config.appProfileDir

# Older Setup-ChatGPT-AppMode-Master configurations do not set appProfileDir;
# in that launcher mode Chromium uses the PortableApps Data directory.
if ([string]::IsNullOrWhiteSpace($profileDir) -and -not [string]::IsNullOrWhiteSpace([string]$config.chromiumPortableRoot)) {
    $profileDir = Join-Path ([string]$config.chromiumPortableRoot) 'Data'
}

if ([string]::IsNullOrWhiteSpace($profileDir)) {
    throw "Refusing to reset profile because config.json does not define an active profile path."
}

try {
    $appRootFull = [System.IO.Path]::GetFullPath($AppRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    $profileDirFull = [System.IO.Path]::GetFullPath($profileDir)
}
catch {
    throw "Refusing to reset profile because the configured path is invalid: $profileDir"
}

if (-not $profileDirFull.StartsWith($appRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to reset profile because appProfileDir is outside this app folder: $profileDirFull"
}

if (-not (Test-Path -LiteralPath $profileDirFull)) {
    Write-Host "No active profile folder found. Nothing to reset."
    return
}

Write-Host "This will delete the active ChatGPT App Mode Chromium profile:"
Write-Host "  $profileDirFull"
$confirm = Read-Host "Type RESET to continue"

if ($confirm -ne "RESET") {
    Write-Host "Cancelled."
    return
}

Remove-Item -LiteralPath $profileDirFull -Recurse -Force
New-Item -ItemType Directory -Force -Path $profileDirFull | Out-Null
Write-Host "Profile reset complete."
