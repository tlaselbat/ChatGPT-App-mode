param(
    [switch]$NewSession,
    [string]$Url
)

$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $AppRoot "config.json"
$HelperPath = Join-Path $AppRoot "tools\ChatGPT-AppMode.Helpers.ps1"
$LogDir = Join-Path $AppRoot "logs"
$LogPath = Join-Path $LogDir "launch.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Ensure-TrayLauncherRunning {
    $TrayScript = Join-Path $AppRoot 'Start-ChatGPT-TrayLauncher.ps1'

    if (-not (Test-Path $TrayScript)) {
        return
    }

    $existingTray = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine -like '*Start-ChatGPT-TrayLauncher.ps1*'
        } |
        Select-Object -First 1

    if ($existingTray) {
        return
    }

    $pwsh = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
    if (-not $pwsh) {
        $pwsh = (Get-Command powershell.exe).Source
    }

    Start-Process -FilePath $pwsh -WindowStyle Hidden -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-STA',
        '-WindowStyle', 'Hidden',
        '-File', "`"$TrayScript`""
    )
}

Ensure-TrayLauncherRunning

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

$argLine = ConvertTo-ArgLine -Config $config -Mode App -NewSession:$NewSession -LaunchUrl $Url
Write-ChromiumPortableIni -IniPath $chromiumIni -AdditionalParameters $argLine

Write-AppModeLog -LogPath $LogPath -Message "Wrote INI: $chromiumIni"
Write-AppModeLog -LogPath $LogPath -Message "AdditionalParameters=$argLine"
Write-AppModeLog -LogPath $LogPath -Message "Launching: $launchExe"

Start-Process -FilePath $launchExe -WorkingDirectory (Split-Path -Parent $launchExe) -ArgumentList $argLine
Set-ChromiumPortableWindowIdentity -ChromiumRoot $chromiumRoot -IconPath (Join-Path $AppRoot 'assets\OpenAI-white.ico') -LogPath $LogPath
