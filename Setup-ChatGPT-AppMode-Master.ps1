# Setup-ChatGPT-AppMode-Master.ps1
# Clean v2 setup script for ChatGPT App Mode using PortableApps Chromium Portable.
# No PowerShell here-strings are used in this script.

[CmdletBinding()]
param(
    [string]$AppRoot = 'E:\Tools\ChatGPT-App-mode',
    [string]$AppName = 'ChatGPT App Mode',
    [string]$ChatGptUrl = 'https://chatgpt.com/',
    [string]$ChromiumPortableExe = ''
)

$ErrorActionPreference = 'Stop'
$NL = [Environment]::NewLine

function New-AppDir {
    param([Parameter(Mandatory)][string]$Path)
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Write-AppFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [AllowEmptyString()][AllowEmptyCollection()][string[]]$Lines,
        [string]$Encoding = 'UTF8'
    )

    $parent = Split-Path -Parent $Path
    if ($parent) {
        New-AppDir $parent
    }

    Set-Content -Path $Path -Value ($Lines -join [Environment]::NewLine) -Encoding $Encoding
}

function Resolve-ChromiumPortable {
    param(
        [string]$ExplicitPath,
        [string]$ExpectedPath,
        [string]$SearchRoot
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        if (Test-Path $ExplicitPath) {
            return (Resolve-Path $ExplicitPath).Path
        }

        throw "Explicit ChromiumPortableExe path was provided but not found: $ExplicitPath"
    }

    if (Test-Path $ExpectedPath) {
        return (Resolve-Path $ExpectedPath).Path
    }

    $found = Get-ChildItem -Path $SearchRoot -Filter 'ChromiumPortable.exe' -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if ($found) {
        return $found.FullName
    }

    return $null
}

# -----------------------------
# Folder layout
# -----------------------------

$BrowserRoot = Join-Path $AppRoot 'Browser'
$ExpectedChromiumRoot = Join-Path $BrowserRoot 'ChromiumPortable'
$ExpectedChromiumExe = Join-Path $ExpectedChromiumRoot 'ChromiumPortable.exe'

$ExtensionRoot = Join-Path $AppRoot 'extension'
$StylesRoot = Join-Path $ExtensionRoot 'styles'
$ScriptsRoot = Join-Path $ExtensionRoot 'scripts'
$LogsRoot = Join-Path $AppRoot 'logs'
$ToolsRoot = Join-Path $AppRoot 'tools'
$ShortcutsRoot = Join-Path $AppRoot 'shortcuts'

@(
    $AppRoot,
    $BrowserRoot,
    $ExtensionRoot,
    $StylesRoot,
    $ScriptsRoot,
    $LogsRoot,
    $ToolsRoot,
    $ShortcutsRoot
) | ForEach-Object {
    New-AppDir $_
}

# -----------------------------
# Resolve Chromium Portable
# -----------------------------

$ResolvedChromiumExe = Resolve-ChromiumPortable `
    -ExplicitPath $ChromiumPortableExe `
    -ExpectedPath $ExpectedChromiumExe `
    -SearchRoot $AppRoot

if (-not $ResolvedChromiumExe) {
    $NotePath = Join-Path $BrowserRoot 'INSTALL-CHROMIUM-PORTABLE-HERE.txt'

    Write-AppFile -Path $NotePath -Lines @(
        'Chromium Portable was not found.',
        '',
        'Expected location:',
        $ExpectedChromiumExe,
        '',
        'Recommended layout:',
        $AppRoot,
        '└── Browser',
        '    └── ChromiumPortable',
        '        └── ChromiumPortable.exe',
        '',
        'Fix option 1:',
        'Move your ChromiumPortable folder to:',
        $ExpectedChromiumRoot,
        '',
        'Fix option 2:',
        'Run setup with an explicit path:',
        'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $AppRoot 'Setup-ChatGPT-AppMode-Master.ps1') + '" -ChromiumPortableExe "FULL\PATH\TO\ChromiumPortable.exe"'
    )

    throw "ChromiumPortable.exe not found. Instructions written to: $NotePath"
}

$ResolvedChromiumRoot = Split-Path -Parent $ResolvedChromiumExe
$ChromiumIniPath = Join-Path $ResolvedChromiumRoot 'ChromiumPortable.ini'
$AppUserModelId = 'OpenAI.ChatGPT.AppMode'

# -----------------------------
# Config
# -----------------------------

$ConfigPath = Join-Path $AppRoot 'config.json'

$Config = [ordered]@{
    appName = $AppName
    url = $ChatGptUrl
    chromiumPortableExe = $ResolvedChromiumExe
    chromiumPortableRoot = $ResolvedChromiumRoot
    chromiumPortableIni = $ChromiumIniPath
    extensionDir = $ExtensionRoot
    enableLocalExtension = $true
    useAppMode = $true
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

$Config | ConvertTo-Json -Depth 10 | Set-Content -Path $ConfigPath -Encoding UTF8

# -----------------------------
# Extension files
# -----------------------------

$ManifestPath = Join-Path $ExtensionRoot 'manifest.json'
$CssPath = Join-Path $StylesRoot 'chatgpt-overrides.css'
$JsPath = Join-Path $ScriptsRoot 'chatgpt-overrides.js'

$Manifest = [ordered]@{
    manifest_version = 3
    name = 'ChatGPT App Mode Overrides'
    version = '0.1.0'
    description = 'Local CSS and JS overrides for ChatGPT App Mode.'
    content_scripts = @(
        [ordered]@{
            matches = @(
                'https://chatgpt.com/*',
                'https://chat.openai.com/*'
            )
            css = @(
                'styles/chatgpt-overrides.css'
            )
            js = @(
                'scripts/chatgpt-overrides.js'
            )
            run_at = 'document_idle'
        }
    )
}

$Manifest | ConvertTo-Json -Depth 10 | Set-Content -Path $ManifestPath -Encoding UTF8

Write-AppFile -Path $CssPath -Lines @(
    '/*',
    '  ChatGPT App Mode CSS Overrides',
    '  Keep changes conservative and reversible.',
    '*/',
    '',
    'body {',
    '  text-rendering: optimizeLegibility;',
    '}',
    '',
    'body.faux-chatgpt-app-mode {',
    '}',
    '',
    '/*',
    '  Optional examples:',
    '',
    '  main {',
    '    max-width: none !important;',
    '  }',
    '',
    '  * {',
    '    scrollbar-width: thin;',
    '  }',
    '*/'
)

Write-AppFile -Path $JsPath -Lines @(
    '/*',
    '  ChatGPT App Mode JS Overrides',
    '  Do not store passwords, tokens, secrets, or conversation data here.',
    '*/',
    '',
    '(() => {',
    '  const markerClass = "faux-chatgpt-app-mode";',
    '',
    '  function markBody() {',
    '    if (document.body && !document.body.classList.contains(markerClass)) {',
    '      document.body.classList.add(markerClass);',
    '    }',
    '  }',
    '',
    '  function setTitle() {',
    '    const wanted = "ChatGPT - App Mode";',
    '    if (document.title !== wanted) {',
    '      document.title = wanted;',
    '    }',
    '  }',
    '',
    '  function init() {',
    '    markBody();',
    '    setTitle();',
    '  }',
    '',
    '  init();',
    '',
    '  const observer = new MutationObserver(() => {',
    '    markBody();',
    '  });',
    '',
    '  observer.observe(document.documentElement, {',
    '    childList: true,',
    '    subtree: true',
    '  });',
    '})();'
)

# -----------------------------
# Helper script
# -----------------------------

$HelperPath = Join-Path $ToolsRoot 'ChatGPT-AppMode.Helpers.ps1'

Write-AppFile -Path $HelperPath -Lines @(
    'function ConvertTo-ArgLine {',
    '    param(',
    '        [Parameter(Mandatory)][object]$Config,',
    '        [ValidateSet("App", "Normal")][string]$Mode = "App"',
    '    )',
    '',
    '    $list = New-Object System.Collections.Generic.List[string]',
    '',
    '    if ($Config.flags) {',
    '        foreach ($flag in $Config.flags) {',
    '            if (-not [string]::IsNullOrWhiteSpace([string]$flag)) {',
    '                $list.Add([string]$flag)',
    '            }',
    '        }',
    '    }',
    '',
    '    if ($Config.enableLocalExtension -eq $true) {',
    '        $ext = [string]$Config.extensionDir',
    '        $manifest = Join-Path $ext "manifest.json"',
    '        if (Test-Path $manifest) {',
    '            $list.Add("--load-extension=`"$ext`"")',
    '        }',
    '    }',
    '',
    '    if ($Mode -eq "App") {',
    '        $url = [string]$Config.url',
    '',
    '        if ($Config.useAppMode -eq $true) {',
    '            $list.Add("--app=$url")',
    '        } else {',
    '            $list.Add($url)',
    '        }',
    '',
    '        if ($Config.window.startMaximized -eq $true) {',
    '            $list.Add("--start-maximized")',
    '        } elseif ($Config.window.width -and $Config.window.height) {',
    '            $list.Add("--window-size=$($Config.window.width),$($Config.window.height)")',
    '        }',
    '    }',
    '',
    '    return ($list -join " ")',
    '}',
    '',
    'function Write-ChromiumPortableIni {',
    '    param(',
    '        [Parameter(Mandatory)][string]$IniPath,',
    '        [Parameter(Mandatory)][string]$AdditionalParameters',
    '    )',
    '',
    '    $lines = @(',
    '        "[ChromiumPortable]",',
    '        "AdditionalParameters=$AdditionalParameters"',
    '    )',
    '',
    '    Set-Content -Path $IniPath -Value ($lines -join [Environment]::NewLine) -Encoding UTF8',
    '}',
    '',
    'function Write-AppModeLog {',
    '    param(',
    '        [Parameter(Mandatory)][string]$LogPath,',
    '        [Parameter(Mandatory)][string]$Message',
    '    )',
    '',
    '    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"',
    '    "[$stamp] $Message" | Add-Content -Path $LogPath -Encoding UTF8',
    '}'
)

# -----------------------------
# Launcher scripts
# -----------------------------

$LauncherPath = Join-Path $AppRoot 'Launch-ChatGPT-AppMode.ps1'
$NormalLauncherPath = Join-Path $AppRoot 'Open-Chromium-Normal.ps1'
$BatPath = Join-Path $AppRoot 'Launch-ChatGPT-AppMode.bat'

Write-AppFile -Path $LauncherPath -Lines @(
    '$ErrorActionPreference = "Stop"',
    '',
    '$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$ConfigPath = Join-Path $AppRoot "config.json"',
    '$HelperPath = Join-Path $AppRoot "tools\ChatGPT-AppMode.Helpers.ps1"',
    '$LogDir = Join-Path $AppRoot "logs"',
    '$LogPath = Join-Path $LogDir "launch.log"',
    '',
    'New-Item -ItemType Directory -Force -Path $LogDir | Out-Null',
    '. $HelperPath',
    '',
    '$config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json',
    '$chromiumExe = [string]$config.chromiumPortableExe',
    '$chromiumRoot = [string]$config.chromiumPortableRoot',
    '$chromiumIni = [string]$config.chromiumPortableIni',
    '',
    'if (-not (Test-Path $chromiumExe)) {',
    '    throw "ChromiumPortable.exe not found: $chromiumExe"',
    '}',
    '',
    '$argLine = ConvertTo-ArgLine -Config $config -Mode App',
    'Write-ChromiumPortableIni -IniPath $chromiumIni -AdditionalParameters $argLine',
    '',
    'Write-AppModeLog -LogPath $LogPath -Message "Wrote INI: $chromiumIni"',
    'Write-AppModeLog -LogPath $LogPath -Message "AdditionalParameters=$argLine"',
    'Write-AppModeLog -LogPath $LogPath -Message "Launching: $chromiumExe"',
    '',
    'Start-Process -FilePath $chromiumExe -WorkingDirectory $chromiumRoot'
)

Write-AppFile -Path $NormalLauncherPath -Lines @(
    '$ErrorActionPreference = "Stop"',
    '',
    '$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$ConfigPath = Join-Path $AppRoot "config.json"',
    '$HelperPath = Join-Path $AppRoot "tools\ChatGPT-AppMode.Helpers.ps1"',
    '$LogDir = Join-Path $AppRoot "logs"',
    '$LogPath = Join-Path $LogDir "launch.log"',
    '',
    'New-Item -ItemType Directory -Force -Path $LogDir | Out-Null',
    '. $HelperPath',
    '',
    '$config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json',
    '$chromiumExe = [string]$config.chromiumPortableExe',
    '$chromiumRoot = [string]$config.chromiumPortableRoot',
    '$chromiumIni = [string]$config.chromiumPortableIni',
    '',
    'if (-not (Test-Path $chromiumExe)) {',
    '    throw "ChromiumPortable.exe not found: $chromiumExe"',
    '}',
    '',
    '$argLine = ConvertTo-ArgLine -Config $config -Mode Normal',
    'Write-ChromiumPortableIni -IniPath $chromiumIni -AdditionalParameters $argLine',
    '',
    'Write-AppModeLog -LogPath $LogPath -Message "Opening Chromium Portable normal mode."',
    'Write-AppModeLog -LogPath $LogPath -Message "AdditionalParameters=$argLine"',
    '',
    'Start-Process -FilePath $chromiumExe -WorkingDirectory $chromiumRoot'
)

Write-AppFile -Path $BatPath -Encoding ASCII -Lines @(
    '@echo off',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch-ChatGPT-AppMode.ps1"'
)

# -----------------------------
# Utility scripts
# -----------------------------

Write-AppFile -Path (Join-Path $AppRoot 'Open-Config.ps1') -Lines @(
    '$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$ConfigPath = Join-Path $AppRoot "config.json"',
    'Start-Process notepad.exe $ConfigPath'
)

Write-AppFile -Path (Join-Path $AppRoot 'Open-Extension-Folder.ps1') -Lines @(
    '$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$ExtensionDir = Join-Path $AppRoot "extension"',
    'Start-Process explorer.exe $ExtensionDir'
)

Write-AppFile -Path (Join-Path $AppRoot 'Toggle-LocalExtension.ps1') -Lines @(
    'param(',
    '    [ValidateSet("On", "Off")]',
    '    [string]$State = "On"',
    ')',
    '',
    '$ErrorActionPreference = "Stop"',
    '$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$ConfigPath = Join-Path $AppRoot "config.json"',
    '$config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json',
    '$config.enableLocalExtension = ($State -eq "On")',
    '$config | ConvertTo-Json -Depth 10 | Set-Content -Path $ConfigPath -Encoding UTF8',
    'Write-Host "Local extension enabled: $($config.enableLocalExtension)"',
    'Write-Host "Close and relaunch ChatGPT App Mode."'
)

Write-AppFile -Path (Join-Path $AppRoot 'Reset-Portable-Chromium-Profile.ps1') -Lines @(
    '$ErrorActionPreference = "Stop"',
    '',
    '$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$ConfigPath = Join-Path $AppRoot "config.json"',
    '$config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json',
    '$chromiumRoot = [string]$config.chromiumPortableRoot',
    '$dataDir = Join-Path $chromiumRoot "Data"',
    '',
    'if (-not $chromiumRoot.StartsWith($AppRoot, [System.StringComparison]::OrdinalIgnoreCase)) {',
    '    throw "Refusing to reset profile because Chromium Portable is outside this app folder: $chromiumRoot"',
    '}',
    '',
    'if (-not (Test-Path $dataDir)) {',
    '    Write-Host "No Data folder found. Nothing to reset."',
    '    return',
    '}',
    '',
    'Write-Host "This will delete the portable Chromium profile:"',
    'Write-Host "  $dataDir"',
    '$confirm = Read-Host "Type RESET to continue"',
    '',
    'if ($confirm -ne "RESET") {',
    '    Write-Host "Cancelled."',
    '    return',
    '}',
    '',
    'Remove-Item -Path $dataDir -Recurse -Force',
    'New-Item -ItemType Directory -Force -Path $dataDir | Out-Null',
    'Write-Host "Profile reset complete."'
)

# -----------------------------
# README
# -----------------------------

$ReadmePath = Join-Path $AppRoot 'README.md'

Write-AppFile -Path $ReadmePath -Lines @(
    '# ChatGPT App Mode',
    '',
    'Launches ChatGPT using PortableApps Chromium Portable in app mode.',
    '',
    '## Main launch',
    '',
    'Run:',
    '',
    '```powershell',
    '.\Launch-ChatGPT-AppMode.ps1',
    '```',
    '',
    'Or use the Desktop / Start Menu shortcut.',
    '',
    '## Normal Chromium mode',
    '',
    'Run:',
    '',
    '```powershell',
    '.\Open-Chromium-Normal.ps1',
    '```',
    '',
    'Use normal mode for browser settings and regular extension management.',
    '',
    '## Override files',
    '',
    'CSS:',
    '',
    '```text',
    'extension\styles\chatgpt-overrides.css',
    '```',
    '',
    'JS:',
    '',
    '```text',
    'extension\scripts\chatgpt-overrides.js',
    '```',
    '',
    '## Config',
    '',
    '```text',
    'config.json',
    '```',
    '',
    '## Reset profile',
    '',
    '```powershell',
    '.\Reset-Portable-Chromium-Profile.ps1',
    '```'
)

# -----------------------------
# Initial INI write
# -----------------------------

. $HelperPath
$configObj = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
$initialArgLine = ConvertTo-ArgLine -Config $configObj -Mode App
Write-ChromiumPortableIni -IniPath $ChromiumIniPath -AdditionalParameters $initialArgLine

$ChromiumAppInfoPath = Join-Path $ResolvedChromiumRoot 'App\AppInfo\appinfo.ini'
if (Test-Path $ChromiumAppInfoPath) {
    $appInfo = Get-Content -Path $ChromiumAppInfoPath -Raw
    if ($appInfo -match '(?m)^BaseAppID=') {
        $appInfo = $appInfo -replace '(?m)^BaseAppID=.*$', "BaseAppID=$AppUserModelId"
    } else {
        $appInfo = $appInfo -replace '(?m)^\[Control\]\s*$', "[Control]`r`nBaseAppID=$AppUserModelId"
    }

    Set-Content -Path $ChromiumAppInfoPath -Value $appInfo -Encoding UTF8
}

# -----------------------------
# Shortcuts
# -----------------------------

$DesktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"
$StartMenuFolder = Join-Path ([Environment]::GetFolderPath('Programs')) $AppName
$StartMenuShortcut = Join-Path $StartMenuFolder "$AppName.lnk"

New-AppDir $StartMenuFolder

$WshShell = New-Object -ComObject WScript.Shell

foreach ($ShortcutPath in @($DesktopShortcut, $StartMenuShortcut)) {
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $BatPath
    $Shortcut.WorkingDirectory = $AppRoot
    $Shortcut.WindowStyle = 1
    $Shortcut.Description = 'Launch ChatGPT using Chromium Portable app mode.'
    $Shortcut.IconLocation = $ResolvedChromiumExe
    $Shortcut.Save()
}

# -----------------------------
# Install complete
# -----------------------------

Write-AppFile -Path (Join-Path $AppRoot 'INSTALL-COMPLETE.txt') -Lines @(
    'Install complete.',
    '',
    'App root:',
    $AppRoot,
    '',
    'Chromium Portable:',
    $ResolvedChromiumExe,
    '',
    'Launch script:',
    $LauncherPath,
    '',
    'Normal Chromium mode:',
    $NormalLauncherPath,
    '',
    'Config:',
    $ConfigPath,
    '',
    'ChromiumPortable.ini:',
    $ChromiumIniPath,
    '',
    'Desktop shortcut:',
    $DesktopShortcut,
    '',
    'Start Menu shortcut:',
    $StartMenuShortcut
)

Write-Host ''
Write-Host 'Done.'
Write-Host "App root: $AppRoot"
Write-Host "Chromium Portable: $ResolvedChromiumExe"
Write-Host "Launch script: $LauncherPath"
Write-Host "Desktop shortcut: $DesktopShortcut"
