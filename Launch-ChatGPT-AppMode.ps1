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
            $_.CommandLine.IndexOf($TrayScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
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
if (Start-AppModeNativeHost -Config $config -AppRoot $AppRoot -NewSession:$NewSession -LaunchUrl $Url) {
    Write-AppModeLog -LogPath $LogPath -Message 'Launched native window host.'
    Set-AppModeWindowIdentity -Config $config -IconPath (Join-Path $AppRoot 'assets\AppMode-dev-v2.ico') -LogPath $LogPath
    return
}
throw 'Native window host is unavailable. Run Install-WindowHost.ps1, then launch again.'
