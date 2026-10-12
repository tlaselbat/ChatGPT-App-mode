[CmdletBinding()]
param(
    [string]$Url = 'https://chatgpt.com/'
)

$ErrorActionPreference = 'Stop'
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExtensionDir = Join-Path $AppRoot 'extension'
$ProfileDir = Join-Path $AppRoot 'test-results\live-review-profile'
$ConfiguredChrome = $env:APP_MODE_CHROMIUM_EXE
$Candidates = @(
    $ConfiguredChrome,
    (Join-Path $AppRoot 'Browser\ChromiumPortable\App\Chromium\chrome.exe')
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
$ChromeExe = $Candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $ChromeExe) {
    throw 'Chromium was not found. Install the project Chromium runtime or set APP_MODE_CHROMIUM_EXE.'
}
if (-not (Test-Path -LiteralPath (Join-Path $ExtensionDir 'manifest.json'))) {
    throw "Extension manifest not found: $ExtensionDir"
}

New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
$arguments = @(
    "--user-data-dir=`"$ProfileDir`"",
    "--disable-extensions-except=`"$ExtensionDir`"",
    "--load-extension=`"$ExtensionDir`"",
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    $Url
)

Start-Process -FilePath $ChromeExe -ArgumentList $arguments
Write-Host "Started a separate visual-review profile: $ProfileDir"
Write-Host 'Sign in only in this development profile if authenticated live review is needed.'
