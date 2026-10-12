param(
    [int]$Width = 720,
    [int]$Height = 900,
    [int]$X = 80,
    [int]$Y = 80
)

$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $AppRoot "config.json"
$HelperPath = Join-Path $AppRoot "tools\ChatGPT-AppMode.Helpers.ps1"
$LogDir = Join-Path $AppRoot "logs"
$LogPath = Join-Path $LogDir "topmost-launch.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
. $HelperPath

function Write-TopMostLog {
    param([string]$Message)
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[$stamp] $Message" | Add-Content -Path $LogPath -Encoding UTF8
}

$typeDefinition = @(
    'using System;'
    'using System.Runtime.InteropServices;'
    'public static class TopMostWindow {'
    '    static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);'
    '    const UInt32 SWP_SHOWWINDOW = 0x0040;'
    '    [DllImport("user32.dll")]'
    '    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, UInt32 uFlags);'
    '    [DllImport("user32.dll")]'
    '    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'
    '    public static bool MakeTopMostResizeMove(IntPtr hWnd, int x, int y, int width, int height) {'
    '        ShowWindow(hWnd, 5);'
    '        return SetWindowPos(hWnd, HWND_TOPMOST, x, y, width, height, SWP_SHOWWINDOW);'
    '    }'
    '}'
) -join [Environment]::NewLine

if (-not ([System.Management.Automation.PSTypeName]"TopMostWindow").Type) {
    Add-Type -TypeDefinition $typeDefinition
}

function Build-AppModeArgLine {
    param([Parameter(Mandatory)][object]$Config)

    $args = New-Object System.Collections.Generic.List[string]

    if ($Config.flags) {
        foreach ($flag in $Config.flags) {
            if (-not [string]::IsNullOrWhiteSpace([string]$flag)) {
                $args.Add([string]$flag)
            }
        }
    }

    if ($Config.appProfileDir) {
        $profileDir = [string]$Config.appProfileDir
        if (-not [string]::IsNullOrWhiteSpace($profileDir)) {
            New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
            $args.Add("--user-data-dir=`"$profileDir`"")
        }
    }

    if ($Config.enableLocalExtension -eq $true) {
        $ext = [string]$Config.extensionDir
        if (Test-Path (Join-Path $ext "manifest.json")) {
            $args.Add("--load-extension=`"$ext`"")
        }
    }

    $url = [string]$Config.url
    $args.Add("--app=$url")
    $args.Add("--window-size=$Width,$Height")
    $args.Add("--window-position=$X,$Y")

    return ($args -join " ")
}

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

$target = Get-ChromiumPortableWindow -ChromiumRoot $chromiumRoot |
    Where-Object { $_.MainWindowTitle -match "ChatGPT|OpenAI" } |
    Sort-Object StartTime -Descending |
    Select-Object -First 1

if (-not $target) {
    $target = Get-ChromiumPortableWindow -ChromiumRoot $chromiumRoot |
        Sort-Object StartTime -Descending |
        Select-Object -First 1
}

if ($target) {
    Write-TopMostLog "Chromium Portable is already running. Reusing existing window handle=$($target.MainWindowHandle)."
}
else {
    $argLine = Build-AppModeArgLine -Config $config

    Set-Content -Path $chromiumIni -Encoding UTF8 -Value @(
        "[ChromiumPortable]",
        "AdditionalParameters=$argLine"
    )

    Write-TopMostLog "Launching Chromium with args: $argLine"
    Start-Process -FilePath $launchExe -WorkingDirectory (Split-Path -Parent $launchExe) -ArgumentList $argLine

    $deadline = (Get-Date).AddSeconds(20)

    while ((Get-Date) -lt $deadline -and -not $target) {
        Start-Sleep -Milliseconds 300
        $target = Get-ChromiumPortableWindow -ChromiumRoot $chromiumRoot |
            Where-Object { $_.MainWindowTitle -match "ChatGPT|OpenAI" } |
            Sort-Object StartTime -Descending |
            Select-Object -First 1

        if (-not $target) {
            $target = Get-ChromiumPortableWindow -ChromiumRoot $chromiumRoot |
                Sort-Object StartTime -Descending |
                Select-Object -First 1
        }
    }
}

if (-not $target) {
    throw "Could not find a Chromium Portable window to resize/topmost."
}

Set-ChromiumPortableWindowIdentity -ChromiumRoot $chromiumRoot -IconPath (Join-Path $AppRoot 'assets\OpenAI-white.ico') -TimeoutSeconds 1 -LogPath $LogPath
[TopMostWindow]::MakeTopMostResizeMove($target.MainWindowHandle, $X, $Y, $Width, $Height) | Out-Null
Write-TopMostLog "Applied topmost size ${Width}x${Height} at X=$X Y=$Y to PID=$($target.Id)."
