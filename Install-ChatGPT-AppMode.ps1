param(
    [switch]$SkipDesktopShortcut,
    [switch]$SkipStartMenuShortcut,
    [switch]$ConfigureOnly,
    [string]$AppName = 'ChatGPT App Mode',
    [string]$Url = 'https://chatgpt.com/'
)

$ErrorActionPreference = 'Stop'

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $AppRoot 'config.json'
$priorConfig = $null
if (Test-Path -LiteralPath $ConfigPath) { $priorConfig = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json }

$HelperPath = Join-Path $AppRoot 'tools\ChatGPT-AppMode.Helpers.ps1'
$LauncherExe = Join-Path $AppRoot 'TaskbarLauncher\ChatGPTTaskbarLauncher.exe'
$BuildScript = Join-Path $AppRoot 'Build-TaskbarLauncher.ps1'
$InternalShortcut = Join-Path $AppRoot 'shortcuts\ChatGPT Taskbar Launcher.lnk'

function Assert-Path {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Label
    )

    if (-not (Test-Path $Path)) {
        throw "$Label not found: $Path"
    }
}

function Copy-Shortcut {
    param([Parameter(Mandatory)][string]$Destination)

    $destinationDir = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    Copy-Item -Path $InternalShortcut -Destination $Destination -Force
}

Assert-Path -Path $HelperPath -Label 'Helper script'

New-Item -ItemType Directory -Force -Path (Join-Path $AppRoot 'logs') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $AppRoot 'shortcuts') | Out-Null

$config = [ordered]@{
    appName = $AppName
    installRoot = $AppRoot
    url = $Url
    restoreLastUrl = $true
    windowHost = 'electron'
    rememberWindowPlacement = $true
    runAtStartup = $false
    pinnedWindow = [ordered]@{ fadeWhenInactive = $true; inactiveOpacityPercent = 30 }
    privacy = [ordered]@{
        saveLastSession = $true
        trackRecentChats = $true
        showChatTitles = $true
        retentionDays = 30
    }
    window = [ordered]@{
        width = 1280
        height = 900
        startMaximized = $false
    }
    flags = @(
        '--no-first-run',
        '--disable-features=Translate',
        '--disable-session-crashed-bubble'
    )
}

. $HelperPath
$defaults = $config | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$existing = $null
if (Test-Path -LiteralPath $ConfigPath) {
    $existing = $priorConfig
    if ($existing.PSObject.Properties['installRoot']) { $existing.installRoot = $AppRoot }
    Copy-Item -LiteralPath $ConfigPath -Destination (Join-Path $AppRoot 'logs\config-backup.json') -Force
}
$config = Merge-AppModeConfig -Defaults $defaults -Existing $existing
Write-AppModeJson -Path $ConfigPath -Value $config
if ($ConfigureOnly) { Write-Host 'Configuration saved. Build and shortcut registration skipped.'; return }
& (Join-Path $AppRoot 'Install-WindowHost.ps1')

if (Test-Path $BuildScript) {
    try {
        & $BuildScript
    }
    catch {
        Write-Warning "Could not rebuild the taskbar launcher. The included launcher will be used. $($_.Exception.Message)"
    }
}

Assert-Path -Path $LauncherExe -Label 'Taskbar launcher'
& $LauncherExe --create-shortcut
Assert-Path -Path $InternalShortcut -Label 'Taskbar launcher shortcut'

if (-not $SkipDesktopShortcut) {
    $desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"
    Copy-Shortcut -Destination $desktopShortcut
}

if (-not $SkipStartMenuShortcut) {
    $startMenuShortcut = Join-Path (Join-Path ([Environment]::GetFolderPath('Programs')) $AppName) "$AppName.lnk"
    Copy-Shortcut -Destination $startMenuShortcut
}

$completePath = Join-Path $AppRoot 'INSTALL-COMPLETE.txt'
@(
    'ChatGPT App Mode installation complete.',
    '',
    'To pin to the taskbar, pin this shortcut:',
    $InternalShortcut,
    '',
    'If an older taskbar icon is already pinned, unpin it first, then pin this refreshed shortcut.',
    '',
    'Launch target:',
    $LauncherExe
) | Set-Content -Path $completePath -Encoding UTF8

Write-Host 'ChatGPT App Mode installation complete.'
Write-Host "Pin this shortcut to the taskbar: $InternalShortcut"
