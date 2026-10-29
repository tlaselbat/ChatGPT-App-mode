param(
    [string]$AppRoot = $PSScriptRoot,
    [switch]$MenuOnly,
    [ValidateSet('App')][string]$LaunchMode,
    [switch]$NewSession
)
# Relaunch in STA mode when needed. WinForms tray apps behave better in STA.
if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    $pwsh = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
    if (-not $pwsh) {
        $pwsh = (Get-Command powershell.exe).Source
    }

    $staArguments = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-STA',
        '-File', "`"$PSCommandPath`"", '-AppRoot', "`"$AppRoot`""
    )
    if ($MenuOnly) { throw 'MenuOnly requires an STA PowerShell process.' }
    if ($LaunchMode) { $staArguments += @('-LaunchMode', $LaunchMode) }
    if ($NewSession) { $staArguments += '-NewSession' }
    Start-Process -FilePath $pwsh -ArgumentList $staArguments -WindowStyle Hidden

    return
}
# Start-ChatGPT-TrayLauncher.ps1
# Custom right-click tray launcher for ChatGPT App Mode.
# Uses existing config.json created by Setup-ChatGPT-AppMode-Master.ps1.

$ErrorActionPreference = 'Stop'

$TrayScript = $PSCommandPath
$ConfigPath = Join-Path $AppRoot 'config.json'
$HelperPath = Join-Path $PSScriptRoot 'tools\ChatGPT-AppMode.Helpers.ps1'
$LogDir = Join-Path $AppRoot 'logs'
$LogPath = Join-Path $LogDir 'tray-launcher.log'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
. $HelperPath

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

function Enter-TrayMutex {
    param([string]$Name = 'Local\ChatGPTAppModeTrayLauncher')
    $candidate = [Threading.Mutex]::new($false, $Name)
    try {
        $acquired = $false
        try { $acquired = $candidate.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $acquired = $true }
        if ($acquired) { return $candidate }
        $candidate.Dispose()
        return $null
    } catch { $candidate.Dispose(); throw }
}

$mutex = $null
if (-not $MenuOnly -and -not $LaunchMode) {
    # Object existence does not establish that a live tray owns the lock.
    # Existing, unowned or abandoned mutexes must permit a replacement tray.
    $mutex = Enter-TrayMutex
    if (-not $mutex) { return }
}

function Write-TrayLog {
    param([string]$Message)

    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    "[$stamp] $Message" | Add-Content -Path $LogPath -Encoding UTF8
}

function Read-AppConfig {
    if (-not (Test-Path $ConfigPath)) {
        throw "Missing config.json: $ConfigPath"
    }

    return Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
}

function Save-AppConfig {
    param([Parameter(Mandatory)][object]$Config)

    Write-AppModeJson -Path $ConfigPath -Value $Config
}

function Start-AppModeWindow {
    param([switch]$NewSession)

    try {
        $config = Read-AppConfig
        Ensure-TopMostServerRunning -AppRoot $AppRoot -LogPath $LogPath

        if (-not (Start-AppModeNativeHost -Config $config -AppRoot $AppRoot -NewSession:$NewSession)) {
            throw 'Native window host is unavailable. Run Install-WindowHost.ps1.'
        }

        Set-AppModeWindowIdentity -Config $config -IconPath (Join-Path $AppRoot 'assets\OpenAI-white.ico') -LogPath $LogPath
    }
    catch {
        Write-TrayLog "ERROR launching App Mode: $($_.Exception.Message)"

        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            'ChatGPT App Mode Error',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
}

function Open-AppPath {
    param([Parameter(Mandatory)][string]$Path)

    try {
        if (-not (Test-Path $Path)) {
            throw "Path not found: $Path"
        }

        Start-Process explorer.exe -ArgumentList ('"' + $Path + '"')
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            'ChatGPT App Mode Error',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
}

function Open-TextFile {
    param([Parameter(Mandatory)][string]$Path)

    try {
        if (-not (Test-Path $Path)) {
            throw "File not found: $Path"
        }

        Start-Process notepad.exe -ArgumentList ('"' + $Path + '"')
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            'ChatGPT App Mode Error',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
}

function Confirm-TrayForceClose {
    return [Windows.Forms.MessageBox]::Show(
        'Force close all App Mode windows? Unsaved input may be lost. Other applications will stay open.',
        'Force close App Mode', 'YesNo', 'Warning', 'Button2') -eq [Windows.Forms.DialogResult]::Yes
}

function Stop-AppModeWindows {
    try {
        $config = Read-AppConfig
        $targets = @(Get-AppModeOwnedWindows $config)
        if (-not $targets.Count) { return }
        if (-not (Confirm-TrayForceClose)) { return }
        Initialize-AppModeNativeApi
        foreach ($target in ($targets | Sort-Object processId -Unique)) {
            # Revalidate ownership after the confirmation; HWNDs can be recycled.
            if ((Get-AppModeTargetWindow -Config $config -Handle $target.handle -ProcessId $target.processId) -and
                [AppModeNative]::WindowMatchesProcess([IntPtr]$target.handle, $target.processId)) {
                Stop-Process -Id $target.processId -Force -ErrorAction Stop
            }
        }
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            'ChatGPT App Mode Error',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
}

function Reset-AppModeProfile {
    # The same validator and typed confirmation are used from every entry point.
    Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $AppRoot 'Reset-AppMode-HostProfile.ps1') + '"'))
}

function Start-TrayLaunch {
    param([ValidateSet('App')][string]$Mode = 'App', [switch]$NewSession)
    # Window discovery may take 15 seconds. Keep it off the tray's UI thread.
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', ('"' + $TrayScript + '"'),
        '-AppRoot', ('"' + $AppRoot + '"'), '-LaunchMode', $Mode)
    if ($NewSession) { $arguments += '-NewSession' }
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList $arguments
}

function Set-TrayOpacity {
    param([Nullable[int]]$Percent, [Nullable[bool]]$Enabled)
    try {
        $config = Read-AppConfig
        if (-not $config.pinnedWindow) { $config | Add-Member pinnedWindow ([pscustomobject]@{}) -Force }
        if ($null -ne $Percent) {
            if ($Percent -lt 10 -or $Percent -gt 100) { throw 'Opacity must be between 10 and 100.' }
            $config.pinnedWindow | Add-Member inactiveOpacityPercent ([int]$Percent) -Force
        }
        if ($null -ne $Enabled) { $config.pinnedWindow | Add-Member fadeWhenInactive ([bool]$Enabled) -Force }
        Save-AppConfig $config
    } catch {
        [Windows.Forms.MessageBox]::Show('Could not save transparency. Open Settings to check the configuration.', 'ChatGPT App Mode', 'OK', 'Error') | Out-Null
    }
}

if ($LaunchMode) { Start-AppModeWindow -NewSession:$NewSession; return }

function New-MenuItem {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][scriptblock]$Action
    )

    $item = New-Object System.Windows.Forms.ToolStripMenuItem
    $item.Text = $Text
    $item.Tag = [pscustomobject]@{ Action = $Action }
    $item.Add_Click({
        param($sender, $eventArgs)
        try { $action = $sender.Tag.Action; & $action $sender $eventArgs }
        catch {
            Write-TrayLog ('Menu action failed ({0}).' -f $_.Exception.GetType().Name)
            [Windows.Forms.MessageBox]::Show('The action could not be completed. Check Settings or the app installation.', 'ChatGPT App Mode', 'OK', 'Error') | Out-Null
        }
    })
    return $item
}

function New-Separator {
    return New-Object System.Windows.Forms.ToolStripSeparator
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$topMostItem = New-MenuItem 'Open pinned mini window' {
    Start-Process powershell.exe -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', "`"$AppRoot\Launch-ChatGPT-TopMost.ps1`"",
        '-Width', '720',
        '-Height', '900'
    ) -WindowStyle Hidden
}

$launchItem = New-MenuItem 'Open ChatGPT' { Start-TrayLaunch -Mode App }
$launchItem.Font = [Drawing.Font]::new($menu.Font, [Drawing.FontStyle]::Bold)
$newSessionItem = New-MenuItem 'New chat' { Start-TrayLaunch -Mode App -NewSession }

$openRootItem = New-MenuItem 'Open App Folder' { Open-AppPath -Path $AppRoot }
$openLogsItem = New-MenuItem 'Open Logs Folder' { Open-AppPath -Path $LogDir }

$settingsItem = New-MenuItem 'Settings and privacy...' {
    $settingsScript = Join-Path (Split-Path -Parent $TrayScript) 'Open-AppMode-Settings.ps1'
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', ('"' + $settingsScript + '"'), '-AppRoot', ('"' + $AppRoot + '"'))
}

$restartServerItem = New-MenuItem 'Restart control server' {
    Ensure-TopMostServerRunning -AppRoot $AppRoot -LogPath $LogPath -ForceRestart
}

$openConfigItem = New-MenuItem 'Edit config.json' {
    Open-TextFile -Path (Join-Path $AppRoot 'config.json')
}

$openCssItem = New-MenuItem 'Edit CSS Overrides' {
    Open-TextFile -Path (Join-Path $AppRoot 'extension\styles\chatgpt-overrides.css')
}

$openJsItem = New-MenuItem 'Edit JS Overrides' {
    Open-TextFile -Path (Join-Path $AppRoot 'extension\scripts\chatgpt-overrides.js')
}

$killItem = New-MenuItem 'Force close App Mode...' { Stop-AppModeWindows }
$resetItem = New-MenuItem 'Reset app profile...' { Reset-AppModeProfile }

$opacityMenu = New-Object Windows.Forms.ToolStripMenuItem('Pinned window transparency')
$fadeItem = New-MenuItem 'Fade when inactive' { Set-TrayOpacity -Enabled (-not $fadeItem.Checked) }
[void]$opacityMenu.DropDownItems.Add($fadeItem)
[void]$opacityMenu.DropDownItems.Add((New-Separator))
$opacityItems = @()
foreach ($percent in @(20, 30, 50, 75, 100)) {
    $label = if ($percent -eq 100) { '100% opacity (solid)' } else { "$percent% opacity" }
    $preset = New-MenuItem $label { param($sender) Set-TrayOpacity -Percent $sender.Tag.Percent -Enabled $true }
    $preset.Tag | Add-Member Percent $percent
    [void]$opacityMenu.DropDownItems.Add($preset)
    $opacityItems += $preset
}
[void]$opacityMenu.DropDownItems.Add((New-Separator))
$customOpacityItem = New-MenuItem 'Custom opacity...' { $settingsItem.PerformClick() }
[void]$opacityMenu.DropDownItems.Add($customOpacityItem)

$advancedMenu = New-Object Windows.Forms.ToolStripMenuItem('Advanced')
$filesMenu = New-Object Windows.Forms.ToolStripMenuItem('Files and customization')
foreach ($item in @($openRootItem, $openLogsItem, (New-Separator), $openConfigItem, $openCssItem, $openJsItem)) { [void]$filesMenu.DropDownItems.Add($item) }
foreach ($item in @($filesMenu, $restartServerItem, (New-Separator), $killItem, $resetItem)) { [void]$advancedMenu.DropDownItems.Add($item) }

$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$exitItem.Text = 'Exit tray launcher'
$exitItem.ToolTipText = 'Leave ChatGPT windows open and remove this tray icon.'

[void]$menu.Items.Add($launchItem)
[void]$menu.Items.Add($newSessionItem)
[void]$menu.Items.Add($topMostItem)
[void]$menu.Items.Add((New-Separator))
[void]$menu.Items.Add($settingsItem)
[void]$menu.Items.Add($opacityMenu)
[void]$menu.Items.Add($advancedMenu)
[void]$menu.Items.Add((New-Separator))
[void]$menu.Items.Add($exitItem)

function Update-TrayMenu {
    try {
        $config = Read-AppConfig
        $settings = Get-AppModeOpacitySettings $config
        $fadeItem.Checked = $settings.enabled
        $opacityMenu.Text = if ($settings.enabled) { "Pinned opacity: $($settings.percent)%" } else { 'Pinned transparency: off' }
        foreach ($item in $opacityItems) { $item.Checked = $settings.enabled -and $item.Tag.Percent -eq $settings.percent }
        $opacityMenu.Enabled = $true
    }
    catch {
        $opacityMenu.Enabled = $false
    }
}
$menu.Add_Opening({ Update-TrayMenu })
$opacityMenu.Add_DropDownOpening({ Update-TrayMenu })
Update-TrayMenu
# Build the real menu without starting services or creating a notification icon.
# Used only for isolated rendering and action tests with a disposable AppRoot.
if ($MenuOnly) { Write-Output -NoEnumerate $menu; return }
$IconPath = Join-Path $PSScriptRoot 'assets\OpenAI-white.ico'
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Text = 'ChatGPT App Mode'
$notifyIcon.Icon = New-Object System.Drawing.Icon($IconPath)
$notifyIcon.ContextMenuStrip = $menu
$notifyIcon.Visible = $true
$notifyIcon.BalloonTipTitle = 'ChatGPT App Mode'
$notifyIcon.BalloonTipText = 'Tray launcher is running. Right-click this icon for the menu.'
$notifyIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$notifyIcon.ShowBalloonTip(3000)

$notifyIcon.Add_MouseUp({
    param($sender, $eventArgs)

    if ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        Start-TrayLaunch -Mode App
    }
})



$appContext = New-Object System.Windows.Forms.ApplicationContext

$exitItem.Add_Click({
    Write-TrayLog 'Exiting tray launcher.'
    $notifyIcon.Visible = $false
    $appContext.ExitThread()
})

Write-TrayLog 'Tray launcher started.'
Ensure-TopMostServerRunning -AppRoot $AppRoot -LogPath $LogPath

try {
    [System.Windows.Forms.Application]::Run($appContext)
}
finally {
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    $menu.Dispose()

    if ($mutex) {
        try {
            $mutex.ReleaseMutex()
        }
        catch {
        }

        $mutex.Dispose()
    }
}


