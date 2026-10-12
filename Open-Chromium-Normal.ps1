$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $AppRoot "config.json"
$HelperPath = Join-Path $AppRoot "tools\ChatGPT-AppMode.Helpers.ps1"
$LogDir = Join-Path $AppRoot "logs"
$LogPath = Join-Path $LogDir "launch.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
. $HelperPath
Ensure-TopMostServerRunning -AppRoot $AppRoot -LogPath $LogPath

$config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
$chromiumExe = [string]$config.chromiumPortableExe
$chromiumDirectExe = [string]$config.chromiumDirectExe
$chromiumRoot = [string]$config.chromiumPortableRoot
$chromiumIni = [string]$config.chromiumPortableIni

$launchExe = if ($chromiumDirectExe -and (Test-Path $chromiumDirectExe)) { $chromiumDirectExe } else { $chromiumExe }

if (-not (Test-Path $launchExe)) {
    throw "Chromium executable not found: $launchExe"
}

Disable-ChromiumProfileBadge -ChromiumRoot $chromiumRoot -LogPath $LogPath

$argLine = ConvertTo-ArgLine -Config $config -Mode Normal
Write-ChromiumPortableIni -IniPath $chromiumIni -AdditionalParameters $argLine

Write-AppModeLog -LogPath $LogPath -Message "Opening Chromium Portable normal mode."
Write-AppModeLog -LogPath $LogPath -Message "AdditionalParameters=$argLine"

Start-Process -FilePath $launchExe -WorkingDirectory (Split-Path -Parent $launchExe) -ArgumentList $argLine
Set-ChromiumPortableWindowIdentity -ChromiumRoot $chromiumRoot -IconPath (Join-Path $AppRoot 'assets\OpenAI-white.ico') -LogPath $LogPath
