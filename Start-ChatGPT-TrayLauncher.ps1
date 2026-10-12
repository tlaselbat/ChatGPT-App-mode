# Relaunch in STA mode when needed. WinForms tray apps behave better in STA.
if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    $pwsh = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
    if (-not $pwsh) {
        $pwsh = (Get-Command powershell.exe).Source
    }

    Start-Process -FilePath $pwsh -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-STA',
        '-File', "`"$PSCommandPath`""
    ) -WindowStyle Hidden

    return
}
# Start-ChatGPT-TrayLauncher.ps1
# Custom right-click tray launcher for ChatGPT App Mode.
# Uses existing config.json created by Setup-ChatGPT-AppMode-Master.ps1.

$ErrorActionPreference = 'Stop'

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $AppRoot 'config.json'
$HelperPath = Join-Path $AppRoot 'tools\ChatGPT-AppMode.Helpers.ps1'
$LogDir = Join-Path $AppRoot 'logs'
$LogPath = Join-Path $LogDir 'tray-launcher.log'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
. $HelperPath

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\ChatGPTAppModeTrayLauncher', [ref]$createdNew)

if (-not $createdNew) {
    [System.Windows.Forms.MessageBox]::Show(
        'ChatGPT Tray Launcher is already running.',
        'ChatGPT App Mode',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    return
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

    $Config | ConvertTo-Json -Depth 10 | Set-Content -Path $ConfigPath -Encoding UTF8
}

function Write-ChromiumPortableIni {
    param(
        [Parameter(Mandatory)][string]$IniPath,
        [Parameter(Mandatory)][string]$AdditionalParameters
    )

    $lines = @(
        '[ChromiumPortable]',
        "AdditionalParameters=$AdditionalParameters"
    )

    Set-Content -Path $IniPath -Value ($lines -join [Environment]::NewLine) -Encoding UTF8
}

function New-ChromiumArgLine {
    param(
        [Parameter(Mandatory)][object]$Config,
        [ValidateSet('App', 'Normal', 'Extensions')]
        [string]$Mode = 'App',
        [switch]$NewSession
    )

    $list = New-Object System.Collections.Generic.List[string]

    if ($Config.flags) {
        foreach ($flag in $Config.flags) {
            if (-not [string]::IsNullOrWhiteSpace([string]$flag)) {
                if ($NewSession -and (Test-NewSessionSuppressedFlag -Flag ([string]$flag))) {
                    continue
                }

                $list.Add([string]$flag)
            }
        }
    }

    if (-not $NewSession -and -not ($list -contains '--restore-last-session')) {
        $list.Add('--restore-last-session')
    }

    if ($Config.appProfileDir) {
        $profileDir = [string]$Config.appProfileDir
        if (-not [string]::IsNullOrWhiteSpace($profileDir)) {
            New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
            $list.Add("--user-data-dir=`"$profileDir`"")
        }
    }

    if ($Config.enableLocalExtension -eq $true) {
        $ext = [string]$Config.extensionDir
        $manifest = Join-Path $ext 'manifest.json'

        if (Test-Path $manifest) {
            $list.Add("--load-extension=`"$ext`"")
        }
    }

    if ($Mode -eq 'App') {
        $url = if ($NewSession) { [string]$Config.url } else { Get-AppLaunchUrl -Config $Config }

        if ($Config.useAppMode -eq $true) {
            $list.Add("--app=$url")
        } else {
            $list.Add($url)
        }

        if (-not $NewSession -and $Config.window.startMaximized -eq $true) {
            $list.Add('--start-maximized')
        }

        if ($NewSession) {
            foreach ($arg in Get-NewSessionWindowArgs) {
                $list.Add($arg)
            }
        }
    }

    if ($Mode -eq 'Extensions') {
        $list.Add('chrome://extensions')
    }

    return ($list -join ' ')
}

function Start-ChromiumPortable {
    param(
        [ValidateSet('App', 'Normal', 'Extensions')]
        [string]$Mode = 'App',
        [switch]$NewSession
    )

    try {
        $config = Read-AppConfig

        $chromiumExe = [string]$config.chromiumPortableExe
        $chromiumDirectExe = [string]$config.chromiumDirectExe
        $chromiumRoot = [string]$config.chromiumPortableRoot
        $chromiumIni = [string]$config.chromiumPortableIni

        $launchExe = if ($chromiumDirectExe -and (Test-Path $chromiumDirectExe)) { $chromiumDirectExe } else { $chromiumExe }

        if (-not (Test-Path $launchExe)) {
            throw "Chromium executable not found: $launchExe"
        }

        Disable-ChromiumProfileBadge -ChromiumRoot $chromiumRoot -LogPath $LogPath

        $argLine = New-ChromiumArgLine -Config $config -Mode $Mode -NewSession:$NewSession
        Write-ChromiumPortableIni -IniPath $chromiumIni -AdditionalParameters $argLine

        Write-TrayLog "Mode=$Mode"
        Write-TrayLog "AdditionalParameters=$argLine"
        Write-TrayLog "Launching=$launchExe"

        Start-Process -FilePath $launchExe -WorkingDirectory (Split-Path -Parent $launchExe) -ArgumentList $argLine
        Set-ChromiumPortableWindowIdentity -ChromiumRoot $chromiumRoot -IconPath (Join-Path $AppRoot 'assets\OpenAI-white.ico') -LogPath $LogPath
    }
    catch {
        Write-TrayLog "ERROR launching Chromium: $($_.Exception.Message)"

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

        Start-Process explorer.exe $Path
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

        Start-Process notepad.exe $Path
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

function Set-LocalExtensionEnabled {
    param([bool]$Enabled)

    try {
        $config = Read-AppConfig
        $config.enableLocalExtension = $Enabled
        Save-AppConfig -Config $config

        Write-TrayLog "Local extension enabled: $Enabled"
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

function Stop-PortableChromium {
    try {
        $config = Read-AppConfig
        $chromiumRoot = [string]$config.chromiumPortableRoot

        $targets = Get-Process -ErrorAction SilentlyContinue | Where-Object {
            try {
                $_.Path -and $_.Path.StartsWith($chromiumRoot, [System.StringComparison]::OrdinalIgnoreCase)
            }
            catch {
                $false
            }
        }

        foreach ($process in $targets) {
            Write-TrayLog "Stopping process: $($process.ProcessName) PID=$($process.Id)"
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
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

function Reset-PortableProfile {
    try {
        $config = Read-AppConfig
        $chromiumRoot = [string]$config.chromiumPortableRoot
        $dataDir = Join-Path $chromiumRoot 'Data'

        if (-not $chromiumRoot.StartsWith($AppRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to reset profile because Chromium Portable is outside this app folder: $chromiumRoot"
        }

        if (-not (Test-Path $dataDir)) {
            [System.Windows.Forms.MessageBox]::Show(
                'No portable Data folder found. Nothing to reset.',
                'ChatGPT App Mode',
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information
            ) | Out-Null
            return
        }

        $result = [System.Windows.Forms.MessageBox]::Show(
            "This will close Chromium Portable and delete:`n`n$dataDir`n`nContinue?",
            'Reset Portable Chromium Profile',
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )

        if ($result -ne [System.Windows.Forms.DialogResult]::Yes) {
            return
        }

        Stop-PortableChromium
        Start-Sleep -Milliseconds 500

        Remove-Item -Path $dataDir -Recurse -Force
        New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

        Write-TrayLog "Reset portable profile: $dataDir"

        [System.Windows.Forms.MessageBox]::Show(
            'Portable Chromium profile reset complete.',
            'ChatGPT App Mode',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
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

function New-MenuItem {
    param(
        [Parameter(Mandatory)][string]$Text,
        [Parameter(Mandatory)][scriptblock]$Action
    )

    $item = New-Object System.Windows.Forms.ToolStripMenuItem
    $item.Text = $Text
    $item.Add_Click($Action)
    return $item
}

function New-Separator {
    return New-Object System.Windows.Forms.ToolStripSeparator
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$topMostItem = New-MenuItem 'Launch Topmost Mini Window' {
    Start-Process powershell.exe -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', "`"$AppRoot\Launch-ChatGPT-TopMost.ps1`"",
        '-Width', '720',
        '-Height', '900'
    ) -WindowStyle Hidden
}

$launchItem = New-MenuItem 'Launch ChatGPT App Mode' { Start-ChromiumPortable -Mode App }
$newSessionItem = New-MenuItem 'Launch New ChatGPT Session' { Start-ChromiumPortable -Mode App -NewSession }
$normalItem = New-MenuItem 'Open Normal Chromium' { Start-ChromiumPortable -Mode Normal }
$extensionsPageItem = New-MenuItem 'Open Chromium Extensions Page' { Start-ChromiumPortable -Mode Extensions }

$openRootItem = New-MenuItem 'Open App Folder' { Open-AppPath -Path $AppRoot }
$openLogsItem = New-MenuItem 'Open Logs Folder' { Open-AppPath -Path $LogDir }

$openConfigItem = New-MenuItem 'Edit config.json' {
    Open-TextFile -Path (Join-Path $AppRoot 'config.json')
}

$openCssItem = New-MenuItem 'Edit CSS Overrides' {
    Open-TextFile -Path (Join-Path $AppRoot 'extension\styles\chatgpt-overrides.css')
}

$openJsItem = New-MenuItem 'Edit JS Overrides' {
    Open-TextFile -Path (Join-Path $AppRoot 'extension\scripts\chatgpt-overrides.js')
}

$toggleExtensionItem = New-Object System.Windows.Forms.ToolStripMenuItem
$toggleExtensionItem.Text = 'Enable Local Override Extension'
$toggleExtensionItem.CheckOnClick = $true
$toggleExtensionItem.Add_Click({
    Set-LocalExtensionEnabled -Enabled $toggleExtensionItem.Checked
})

$killItem = New-MenuItem 'Kill Chromium Portable' { Stop-PortableChromium }
$resetItem = New-MenuItem 'Reset Portable Profile' { Reset-PortableProfile }

$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$exitItem.Text = 'Exit Tray Launcher'

[void]$menu.Items.Add($topMostItem)
[void]$menu.Items.Add($launchItem)
[void]$menu.Items.Add($newSessionItem)
[void]$menu.Items.Add($normalItem)
[void]$menu.Items.Add($extensionsPageItem)
[void]$menu.Items.Add((New-Separator))
[void]$menu.Items.Add($toggleExtensionItem)
[void]$menu.Items.Add($openConfigItem)
[void]$menu.Items.Add($openCssItem)
[void]$menu.Items.Add($openJsItem)
[void]$menu.Items.Add((New-Separator))
[void]$menu.Items.Add($openRootItem)
[void]$menu.Items.Add($openLogsItem)
[void]$menu.Items.Add((New-Separator))
[void]$menu.Items.Add($killItem)
[void]$menu.Items.Add($resetItem)
[void]$menu.Items.Add((New-Separator))
[void]$menu.Items.Add($exitItem)

$menu.Add_Opening({
    try {
        $config = Read-AppConfig
        $toggleExtensionItem.Checked = [bool]$config.enableLocalExtension
    }
    catch {
        $toggleExtensionItem.Checked = $false
    }
})
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
        Start-ChromiumPortable -Mode App
    }
})

$notifyIcon.Add_DoubleClick({
    Start-ChromiumPortable -Mode App
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


