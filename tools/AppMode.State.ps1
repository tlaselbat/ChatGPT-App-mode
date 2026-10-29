# Shared configuration, profile safety, and non-content window state.
function Write-AppModeJson {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][AllowEmptyCollection()]$Value)
    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $temporary = Join-Path $parent ([IO.Path]::GetRandomFileName())
    try {
        $json = ConvertTo-Json -InputObject $Value -Depth 20
        [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
        # MoveFileEx supports same-directory atomic replacement on the portable
        # volumes where .NET Framework File.Replace can fail on metadata/ACLs.
        if (-not ([Management.Automation.PSTypeName]'AppModeAtomicFile').Type) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AppModeAtomicFile {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool MoveFileEx(string source, string destination, uint flags);
}
'@
        }
        if (-not [AppModeAtomicFile]::MoveFileEx($temporary, $Path, 9)) { throw 'Could not save local state atomically.' }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Get-AppModePrivacy {
    param($Config)
    $days = 30
    if ($Config.privacy.retentionDays -ge 1 -and $Config.privacy.retentionDays -le 3650) {
        $days = [int]$Config.privacy.retentionDays
    }
    return [pscustomobject]@{
        saveLastSession = ($Config.privacy.saveLastSession -ne $false)
        trackRecentChats = ($Config.privacy.trackRecentChats -ne $false)
        showChatTitles = ($Config.privacy.showChatTitles -ne $false)
        retentionDays = $days
    }
}

function Get-ActiveProfileDirectory {
    param([Parameter(Mandatory)]$Config)
    if (-not [string]::IsNullOrWhiteSpace([string]$Config.appProfileDir)) {
        return [IO.Path]::GetFullPath([string]$Config.appProfileDir)
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$Config.chromiumPortableRoot)) {
        return [IO.Path]::GetFullPath((Join-Path $Config.chromiumPortableRoot 'Data'))
    }
    throw 'The active browser profile is not configured.'
}

function Assert-AppModeResetTarget {
    param([Parameter(Mandatory)]$Config, [Parameter(Mandatory)][string]$AppRoot)
    $target = (Get-ActiveProfileDirectory $Config).TrimEnd('\', '/')
    $root = [IO.Path]::GetFullPath($AppRoot).TrimEnd('\', '/')
    foreach ($segment in ($target.Substring([IO.Path]::GetPathRoot($target).Length) -split '[\\/]')) {
        if ($segment -ne $segment.TrimEnd(' ', '.') -or $segment.Contains(':')) {
            throw 'Profile reset refuses Windows path aliases and alternate data streams.'
        }
    }
    $browser = Join-Path $root 'Browser'
    if (-not $target.StartsWith($browser + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Profile reset is limited to a dedicated profile beneath this app''s Browser folder.'
    }
    $runtime = [IO.Path]::GetFullPath([string]$Config.chromiumPortableRoot).TrimEnd('\', '/')
    # Never allow a profile setting to erase runtime software or its parent.
    if ($runtime.Equals($target, [StringComparison]::OrdinalIgnoreCase) -or
        $runtime.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The reset target includes browser software.'
    }
    if ($target.StartsWith($runtime + '\', [StringComparison]::OrdinalIgnoreCase) -and
        -not $target.Equals((Join-Path $runtime 'Data'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Only the legacy Data profile may be reset inside the portable runtime.'
    }
    $cursor = $target
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw 'Profile reset refuses files, links, and junctions in the target path.'
            }
        }
        $cursor = Split-Path -Parent $cursor
    }
    if (Test-Path -LiteralPath $target) {
        $pending = [Collections.Generic.Queue[string]]::new()
        $pending.Enqueue($target)
        while ($pending.Count) {
            foreach ($entry in (Get-ChildItem -LiteralPath $pending.Dequeue() -Force -ErrorAction Stop)) {
                if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Profile reset refuses links or junctions inside the profile.' }
                if ($entry.PSIsContainer) { $pending.Enqueue($entry.FullName) }
            }
        }
    }
    return $target
}

function Assert-AppModeBrowserStopped {
    param([Parameter(Mandatory)]$Config)
    $runtime = [IO.Path]::GetFullPath([string]$Config.chromiumPortableRoot).TrimEnd('\', '/') + '\'
    $profile = Get-ActiveProfileDirectory $Config
    $running = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($runtime, [StringComparison]::OrdinalIgnoreCase)) -or
        ($_.Name -match '^(chrome|chromium)\.exe$' -and $_.CommandLine -and $_.CommandLine.IndexOf($profile, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    })
    if ($running.Count) { throw 'Close Chromium and all App Mode review windows before resetting the profile.' }
}

function Merge-AppModeConfig {
    param([Parameter(Mandatory)]$Defaults, $Existing)
    if (-not $Existing) { return $Defaults }
    foreach ($property in $Defaults.PSObject.Properties) {
        if (-not $Existing.PSObject.Properties[$property.Name]) {
            $Existing | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value
        } elseif ($property.Value -is [pscustomobject]) {
            $merged = Merge-AppModeConfig -Defaults $property.Value -Existing $Existing.($property.Name)
            $Existing.($property.Name) = $merged
        }
    }
    return $Existing
}

function Get-AppModeRecentChats {
    param([string]$AppRoot, $Config)
    $privacy = Get-AppModePrivacy $Config
    if (-not $privacy.trackRecentChats) { return @() }
    $path = Join-Path $AppRoot 'logs\recent-chats.json'
    if (-not (Test-Path -LiteralPath $path)) { return @() }
    try {
        $parsed = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        $items = @($parsed)
        foreach ($item in $items) {
            $stamp = [DateTimeOffset]::MinValue
            if ($item.url -and (Test-RestorableChatGptUrl $item.url) -and
                [DateTimeOffset]::TryParse([string]$item.savedAt, [ref]$stamp) -and
                $stamp -gt [DateTimeOffset]::UtcNow.AddDays(-$privacy.retentionDays)) {
                [pscustomobject]@{ url = $item.url; title = $(if ($privacy.showChatTitles) { $item.title } else { $null }); savedAt = $item.savedAt }
            }
        }
    } catch { return @() }
}

function Clear-AppModeHistory {
    param([Parameter(Mandatory)][string]$AppRoot)
    # Fixed filenames only; no recursive removal and no browser data.
    foreach ($name in @('last-session.json', 'recent-chats.json', 'launch.log', 'tray-launcher.log', 'topmost-server.log', 'topmost-launch.log')) {
        $path = Join-Path $AppRoot ('logs\' + $name)
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
}

function Set-AppModeStartup {
    param([string]$AppRoot, [bool]$Enabled, [string]$StartupDirectory = [Environment]::GetFolderPath('Startup'))
    $path = Join-Path $StartupDirectory 'ChatGPT App Mode.lnk'
    if ($Enabled) {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($path)
        $shortcut.TargetPath = (Get-Command powershell.exe -ErrorAction Stop).Source
        $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "' + (Join-Path $AppRoot 'Start-ChatGPT-TrayLauncher.ps1') + '"'
        $shortcut.WorkingDirectory = $AppRoot
        $shortcut.WindowStyle = 7
        $shortcut.Save()
    } elseif (Test-Path -LiteralPath $path) {
        # Do not remove another installation's startup entry.
        $shell = New-Object -ComObject WScript.Shell
        if ($shell.CreateShortcut($path).Arguments.Contains((Join-Path $AppRoot 'Start-ChatGPT-TrayLauncher.ps1'))) {
            Remove-Item -LiteralPath $path -Force
        }
    }
}

function Get-SafeWindowBounds {
    param($Bounds, [Parameter(Mandatory)]$WorkingArea)
    $width = [Math]::Min([Math]::Max(320, [int]$Bounds.width), $WorkingArea.Width)
    $height = [Math]::Min([Math]::Max(300, [int]$Bounds.height), $WorkingArea.Height)
    [pscustomobject]@{
        width = $width; height = $height
        x = [Math]::Max($WorkingArea.Left, [Math]::Min([int]$Bounds.x, $WorkingArea.Right - $width))
        y = [Math]::Max($WorkingArea.Top, [Math]::Min([int]$Bounds.y, $WorkingArea.Bottom - $height))
    }
}

function Get-AppModeWindowArgs {
    param($Config, [switch]$NewSession)
    $bounds = [pscustomobject]@{ width = 1280; height = 900; x = 80; y = 40 }
    if ($Config.window.width -gt 0) { $bounds.width = [int]$Config.window.width }
    if ($Config.window.height -gt 0) { $bounds.height = [int]$Config.window.height }
    $maximized = $Config.window.startMaximized -eq $true
    if ($NewSession) { $bounds.width = 670; $bounds.height = 1000; $maximized = $false }
    elseif ($Config.rememberWindowPlacement -ne $false) {
        $root = Get-AppRootFromConfig $Config
        if ($root) {
            $path = Join-Path $root 'logs\window-state.json'
            try {
                if (Test-Path -LiteralPath $path) {
                    $saved = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
                    if ($saved.width -gt 0 -and $saved.height -gt 0) { $bounds = $saved; $maximized = $saved.maximized -eq $true }
                }
            } catch { }
        }
    }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $rectangle = [Drawing.Rectangle]::new([int]$bounds.x, [int]$bounds.y, [int]$bounds.width, [int]$bounds.height)
        $area = [Windows.Forms.Screen]::FromRectangle($rectangle).WorkingArea
        if ($NewSession) {
            $bounds.x = $area.Left + [int](($area.Width - $bounds.width) / 2)
            $bounds.y = $area.Top + [int](($area.Height - $bounds.height) / 2)
        }
        $bounds = Get-SafeWindowBounds -Bounds $bounds -WorkingArea $area
    } catch { }
    "--window-size=$($bounds.width),$($bounds.height)"
    "--window-position=$($bounds.x),$($bounds.y)"
    if ($maximized) { '--start-maximized' }
}
