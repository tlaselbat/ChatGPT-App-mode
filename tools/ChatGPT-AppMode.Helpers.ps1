. (Join-Path $PSScriptRoot 'AppMode.State.ps1')
. (Join-Path $PSScriptRoot 'AppMode.Windows.ps1')

function Start-AppModeNativeHost {
    param($Config, [string]$AppRoot, [switch]$NewSession, [string]$LaunchUrl)
    if ($Config.windowHost -eq 'chromium' -or $Config.useAppMode -eq $false) { return $false }
    if ($Config.windowHost -and $Config.windowHost -notin @('electron', 'chromium')) { throw 'Unknown windowHost setting.' }
    $hostExe = Join-Path $AppRoot 'node_modules\electron\dist\electron.exe'
    $entry = Join-Path $AppRoot 'WindowHost\main.cjs'
    if (-not (Test-Path -LiteralPath $hostExe) -or -not (Test-Path -LiteralPath $entry)) {
        # Older portable packages remain usable without a new runtime.
        Write-Warning 'Native header runtime is missing. Using Chromium title bar. Run Install-WindowHost.ps1 to install integrated controls.'
        return $false
    }
    $profile = Join-Path $AppRoot 'Browser\AppModeHostProfile'
    if ($Config.appProfileDir -and [IO.Path]::GetFullPath($profile).TrimEnd('\').Equals(
        [IO.Path]::GetFullPath([string]$Config.appProfileDir).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Native host profile must be separate from the Chromium profile.'
    }
    $url = Get-AppLaunchUrl -Config $Config -NewSession:$NewSession -LaunchUrl $LaunchUrl
    $arguments = @('"' + $entry + '"', '--app-mode-root="' + $AppRoot + '"',
        '--user-data-dir="' + $profile + '"', '--url="' + $url + '"')
    $arguments += @(Get-AppModeWindowArgs -Config $Config -NewSession:$NewSession)
    $priorRunAsNode = $env:ELECTRON_RUN_AS_NODE
    try {
        Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
        $nativeProcess = Start-Process -FilePath $hostExe -WorkingDirectory $AppRoot -ArgumentList ($arguments -join ' ') -PassThru
        # Detect immediate configuration/runtime failures, including launch from
        # environments that otherwise hide the child process's error console.
        if ($nativeProcess.WaitForExit(1500) -and $nativeProcess.ExitCode -ne 0) {
            Write-Warning 'Native header host failed to start. Using Chromium title bar; reinstall with Install-WindowHost.ps1.'
            return $false
        }
    } finally {
        if ($null -ne $priorRunAsNode) { $env:ELECTRON_RUN_AS_NODE = $priorRunAsNode }
    }
    return $true
}

function ConvertTo-ArgLine {
    param(
        [Parameter(Mandatory)][object]$Config,
        [ValidateSet("App", "Normal")][string]$Mode = "App",
        [switch]$NewSession,
        [string]$LaunchUrl
    )

    $list = New-Object System.Collections.Generic.List[string]

    if ($Config.flags) {
        foreach ($flag in $Config.flags) {
            if (-not [string]::IsNullOrWhiteSpace([string]$flag)) {
                if (($NewSession -or $Config.restoreLastUrl -eq $false) -and (Test-NewSessionSuppressedFlag -Flag ([string]$flag))) {
                    continue
                }

                $list.Add([string]$flag)
            }
        }
    }

    if (-not $NewSession -and $Config.restoreLastUrl -ne $false -and -not ($list -contains '--restore-last-session')) {
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
        $manifest = Join-Path $ext "manifest.json"
        if (Test-Path $manifest) {
            $list.Add("--load-extension=`"$ext`"")
        }
    }

    if ($Mode -eq "App") {
        $url = Get-AppLaunchUrl -Config $Config -NewSession:$NewSession -LaunchUrl $LaunchUrl

        if ($Config.useAppMode -eq $true) {
            $list.Add("--app=$url")
        } else {
            $list.Add($url)
        }

        foreach ($arg in Get-AppModeWindowArgs -Config $Config -NewSession:$NewSession) {
            $list.Add($arg)
        }
    }

    return ($list -join " ")
}

function Test-NewSessionSuppressedFlag {
    param([string]$Flag)

    return (
        $Flag -eq '--restore-last-session' -or
        $Flag -eq '--start-maximized' -or
        $Flag -like '--window-size=*' -or
        $Flag -like '--window-position=*'
    )
}

function Get-NewSessionWindowArgs {
    $width = 670
    $height = 1000
    $x = 80
    $y = 40

    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
        $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
        $x = [Math]::Max($area.Left, [int]($area.Left + (($area.Width - $width) / 2)))
        $y = [Math]::Max($area.Top, [int]($area.Top + (($area.Height - $height) / 2)))
    }
    catch {
    }

    return @(
        "--window-size=$width,$height",
        "--window-position=$x,$y"
    )
}

function Get-AppRootFromConfig {
    param([Parameter(Mandatory)][object]$Config)

    if ($Config.installRoot) { return [string]$Config.installRoot }
    if ($Config.extensionDir) {
        return Split-Path -Parent ([string]$Config.extensionDir)
    }

    if ($Config.chromiumPortableRoot) {
        return Split-Path -Parent (Split-Path -Parent ([string]$Config.chromiumPortableRoot))
    }

    return $null
}

function Get-AppLaunchUrl {
    param(
        [Parameter(Mandatory)][object]$Config,
        [switch]$NewSession,
        [string]$LaunchUrl
    )

    $fallbackUrl = [string]$Config.url

    if (-not [string]::IsNullOrWhiteSpace($LaunchUrl) -and (Test-RestorableChatGptUrl -Url $LaunchUrl)) {
        return $LaunchUrl
    }

    if ($NewSession) {
        return $fallbackUrl
    }

    if ($Config.restoreLastUrl -eq $false -or -not (Get-AppModePrivacy $Config).saveLastSession) {
        return $fallbackUrl
    }

    $appRoot = Get-AppRootFromConfig -Config $Config
    if ([string]::IsNullOrWhiteSpace($appRoot)) {
        return $fallbackUrl
    }

    $lastSessionPath = Join-Path $appRoot 'logs\last-session.json'
    if (-not (Test-Path $lastSessionPath)) {
        return $fallbackUrl
    }

    try {
        $lastSession = Get-Content -Path $lastSessionPath -Raw | ConvertFrom-Json
        $lastUrl = [string]$lastSession.url

        $savedAt = [DateTimeOffset]::MinValue
        if ((Test-RestorableChatGptUrl -Url $lastUrl) -and
            [DateTimeOffset]::TryParse([string]$lastSession.savedAt, [ref]$savedAt) -and
            $savedAt -gt [DateTimeOffset]::UtcNow.AddDays(-(Get-AppModePrivacy $Config).retentionDays)) {
            return $lastUrl
        }
    }
    catch {
        return $fallbackUrl
    }

    return $fallbackUrl
}

function Test-RestorableChatGptUrl {
    param([Parameter(Mandatory)][string]$Url)

    # Accepted URLs become native command-line arguments; reject raw quoting,
    # whitespace, or control characters before URI normalization can hide them.
    if ($Url -match '\s' -or $Url.IndexOfAny([char[]]@([char]34, [char]39, [char]96)) -ge 0) { return $false }

    try {
        $uri = [System.Uri]$Url
    }
    catch {
        return $false
    }

    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.Port -ne 443 -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
        ($uri.Host -ne 'chatgpt.com' -and $uri.Host -ne 'chat.openai.com')) {
        return $false
    }

    $path = $uri.AbsolutePath
    return (
        $path -eq '/' -or
        $path -match '^/c/[A-Za-z0-9-]+/?$' -or
        $path -match '^/g/[A-Za-z0-9_-]+/?$' -or
        $path -match '^/g/[A-Za-z0-9_-]+/c/[A-Za-z0-9-]+/?$'
    )
}

function Write-ChromiumPortableIni {
    param(
        [Parameter(Mandatory)][string]$IniPath,
        [Parameter(Mandatory)][string]$AdditionalParameters
    )

    $lines = @(
        "[ChromiumPortable]",
        "AdditionalParameters=$AdditionalParameters"
    )

    Set-Content -Path $IniPath -Value ($lines -join [Environment]::NewLine) -Encoding UTF8
}

function Write-AppModeLog {
    param(
        [Parameter(Mandatory)][string]$LogPath,
        [Parameter(Mandatory)][string]$Message
    )

    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[$stamp] $Message" | Add-Content -Path $LogPath -Encoding UTF8
}

# Profile metadata is owned by Chromium; launchers never rewrite it.

function Ensure-TopMostServerRunning {
    param(
        [Parameter(Mandatory)][string]$AppRoot,
        [string]$LogPath,
        [switch]$ForceRestart
    )

    $serverScript = Join-Path $AppRoot 'Start-ChatGPT-TopMostServer.ps1'

    if (-not (Test-Path $serverScript)) {
        if ($LogPath) {
            Write-AppModeLog -LogPath $LogPath -Message "Topmost server script not found: $serverScript"
        }

        return
    }

    $existingServer = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine.IndexOf($serverScript, [StringComparison]::OrdinalIgnoreCase) -ge 0
        } |
        Select-Object -First 1

    if ($existingServer) {
        try {
            $serverWriteTime = (Get-Item $serverScript).LastWriteTime
            $serverProcess = Get-Process -Id $existingServer.ProcessId -ErrorAction Stop
            $serverStartTime = $serverProcess.StartTime

            $dependencyWriteTime = (Get-Item (Join-Path $AppRoot 'tools\AppMode.Windows.ps1')).LastWriteTime
            $helperWriteTime = (Get-Item (Join-Path $AppRoot 'tools\AppMode.State.ps1')).LastWriteTime
            $sharedWriteTime = (Get-Item (Join-Path $AppRoot 'tools\ChatGPT-AppMode.Helpers.ps1')).LastWriteTime
            if (-not $ForceRestart -and $serverStartTime -ge $serverWriteTime -and $serverStartTime -ge $dependencyWriteTime -and $serverStartTime -ge $helperWriteTime -and $serverStartTime -ge $sharedWriteTime) {
                return
            }

            Stop-Process -Id $existingServer.ProcessId -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 300

            if ($LogPath) {
                Write-AppModeLog -LogPath $LogPath -Message 'Restarted stale topmost control server.'
            }
        }
        catch {
            if ($LogPath) {
                Write-AppModeLog -LogPath $LogPath -Message "Restarting topmost control server after stale-check error: $($_.Exception.Message)"
            }

            Stop-Process -Id $existingServer.ProcessId -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 300
        }
    }

    $pwsh = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
    if (-not $pwsh) {
        $pwsh = (Get-Command powershell.exe).Source
    }

    Start-Process -FilePath $pwsh -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden',
        '-File', "`"$serverScript`""
    ) -WindowStyle Hidden

    if ($LogPath) {
        Write-AppModeLog -LogPath $LogPath -Message 'Started topmost control server.'
    }
}

function Initialize-WindowIdentityApi {
    if (([System.Management.Automation.PSTypeName]"ChatGptAppModeWindowIdentity").Type) {
        return
    }

    $typeDefinition = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class ChatGptAppModeWindowIdentity
{
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PropertyKey
    {
        public Guid FormatId;
        public uint PropertyId;

        public PropertyKey(Guid formatId, uint propertyId)
        {
            FormatId = formatId;
            PropertyId = propertyId;
        }
    }

    [StructLayout(LayoutKind.Explicit)]
    private sealed class PropVariant : IDisposable
    {
        [FieldOffset(0)]
        private ushort valueType;
        [FieldOffset(8)]
        private IntPtr value;

        public PropVariant(string text)
        {
            valueType = 31;
            value = Marshal.StringToCoTaskMemUni(text);
        }

        ~PropVariant()
        {
            Dispose();
        }

        public void Dispose()
        {
            if (value != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(value);
                value = IntPtr.Zero;
            }

            GC.SuppressFinalize(this);
        }
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    private interface IPropertyStore
    {
        void GetCount(out uint cProps);
        void GetAt(uint iProp, out PropertyKey pkey);
        void GetValue(ref PropertyKey key, out PropVariant pv);
        void SetValue(ref PropertyKey key, PropVariant pv);
        void Commit();
    }

    [DllImport("shell32.dll", PreserveSig = false)]
    private static extern void SHGetPropertyStoreForWindow(
        IntPtr hwnd,
        ref Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out IPropertyStore propertyStore);

    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadImage(IntPtr hinst, string name, uint type, int cx, int cy, uint fuLoad);

    private const uint WM_SETICON = 0x0080;
    private static readonly IntPtr ICON_SMALL = new IntPtr(0);
    private static readonly IntPtr ICON_BIG = new IntPtr(1);
    private const uint IMAGE_ICON = 1;
    private const uint LR_LOADFROMFILE = 0x0010;

    private static readonly PropertyKey AppUserModelId = new PropertyKey(
        new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
        5);

    public static void SetAppUserModelId(IntPtr hwnd, string appId)
    {
        Guid propertyStoreId = typeof(IPropertyStore).GUID;
        IPropertyStore propertyStore;
        SHGetPropertyStoreForWindow(hwnd, ref propertyStoreId, out propertyStore);

        using (PropVariant appIdValue = new PropVariant(appId))
        {
            PropertyKey appUserModelId = AppUserModelId;
            propertyStore.SetValue(ref appUserModelId, appIdValue);
            propertyStore.Commit();
        }
    }

    public static void SetWindowIcon(IntPtr hwnd, string iconPath)
    {
        IntPtr smallIcon = LoadImage(IntPtr.Zero, iconPath, IMAGE_ICON, 16, 16, LR_LOADFROMFILE);
        IntPtr bigIcon = LoadImage(IntPtr.Zero, iconPath, IMAGE_ICON, 32, 32, LR_LOADFROMFILE);

        if (smallIcon != IntPtr.Zero)
        {
            SendMessage(hwnd, WM_SETICON, ICON_SMALL, smallIcon);
        }

        if (bigIcon != IntPtr.Zero)
        {
            SendMessage(hwnd, WM_SETICON, ICON_BIG, bigIcon);
        }
    }

    public static IntPtr[] GetVisibleTopLevelWindowsForProcessId(int targetProcessId)
    {
        List<IntPtr> windows = new List<IntPtr>();

        EnumWindows(delegate(IntPtr hwnd, IntPtr lParam)
        {
            uint processId;
            GetWindowThreadProcessId(hwnd, out processId);

            if (processId == targetProcessId && IsWindowVisible(hwnd))
            {
                windows.Add(hwnd);
            }

            return true;
        }, IntPtr.Zero);

        return windows.ToArray();
    }

    public static string GetWindowTitle(IntPtr hwnd)
    {
        int length = GetWindowTextLength(hwnd);
        if (length <= 0)
        {
            return String.Empty;
        }

        StringBuilder text = new StringBuilder(length + 1);
        GetWindowText(hwnd, text, text.Capacity);
        return text.ToString();
    }
}
'@

    Add-Type -TypeDefinition $typeDefinition
}

function Get-ChromiumPortableWindow {
    param([Parameter(Mandatory)][string]$ChromiumRoot)

    Initialize-WindowIdentityApi

    $normalizedRoot = [IO.Path]::GetFullPath($ChromiumRoot).TrimEnd('\', '/') + '\'
    $processes = @(Get-Process -Name chrome -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -and $_.Path.StartsWith($normalizedRoot, [StringComparison]::OrdinalIgnoreCase) }
        catch { $false }
    })

    foreach ($process in $processes) {
        $handles = [ChatGptAppModeWindowIdentity]::GetVisibleTopLevelWindowsForProcessId($process.Id)

        foreach ($handle in $handles) {
            [pscustomobject]@{
                Id = $process.Id
                ProcessName = $process.ProcessName
                MainWindowHandle = $handle
                MainWindowTitle = [ChatGptAppModeWindowIdentity]::GetWindowTitle($handle)
                Path = $process.Path
                StartTime = $process.StartTime
            }
        }
    }
}

function Set-ChromiumPortableWindowIdentity {
    param(
        [Parameter(Mandatory)][string]$ChromiumRoot,
        [string]$AppUserModelId = "OpenAI.ChatGPT.AppMode",
        [string]$IconPath,
        [int]$TimeoutSeconds = 15,
        [string]$LogPath,
        $Config
    )

    Initialize-WindowIdentityApi

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $windows = @()

    while ((Get-Date) -lt $deadline -and $windows.Count -eq 0) {
        Start-Sleep -Milliseconds 250
        if ($Config) {
            $windows = @(Get-AppModeOwnedWindows $Config | ForEach-Object {
                [pscustomobject]@{ Id=$_.processId; MainWindowHandle=[IntPtr]$_.handle }
            })
        } else { $windows = @(Get-ChromiumPortableWindow -ChromiumRoot $ChromiumRoot) }
    }

    if ($windows.Count -eq 0) {
        if ($LogPath) {
            Write-AppModeLog -LogPath $LogPath -Message "No visible Chromium window was found for taskbar AppUserModelID."
        }

        return
    }

    foreach ($window in $windows) {
        try {
            [ChatGptAppModeWindowIdentity]::SetAppUserModelId(
                [IntPtr]$window.MainWindowHandle,
                $AppUserModelId
            )

            if (-not [string]::IsNullOrWhiteSpace($IconPath) -and (Test-Path $IconPath)) {
                [ChatGptAppModeWindowIdentity]::SetWindowIcon(
                    [IntPtr]$window.MainWindowHandle,
                    $IconPath
                )
            }

            if ($LogPath) {
                Write-AppModeLog -LogPath $LogPath -Message "Applied taskbar AppUserModelID to PID=$($window.Id)."
            }
        }
        catch {
            if ($LogPath) {
                Write-AppModeLog -LogPath $LogPath -Message "Could not apply taskbar AppUserModelID to PID=$($window.Id): $($_.Exception.Message)"
            }
        }
    }
}
