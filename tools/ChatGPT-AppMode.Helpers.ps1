. (Join-Path $PSScriptRoot 'AppMode.State.ps1')
. (Join-Path $PSScriptRoot 'AppMode.Windows.ps1')

function Start-AppModeNativeHost {
    param($Config, [string]$AppRoot, [switch]$NewSession, [string]$LaunchUrl)
    if ($Config.windowHost -and $Config.windowHost -ne 'electron') {
        Write-Warning "Unsupported windowHost '$($Config.windowHost)'. The Electron host is the only supported runtime."
    }
    $hostExe = Join-Path $AppRoot 'node_modules\electron\dist\electron.exe'
    $entry = Join-Path $AppRoot 'WindowHost\main.cjs'
    if (-not (Test-Path -LiteralPath $hostExe) -or -not (Test-Path -LiteralPath $entry)) {
        Write-Warning 'Native window runtime is missing. Run Install-WindowHost.ps1 to install it.'
        return $false
    }
    $profile = Join-Path $AppRoot 'Browser\AppModeHostProfile'
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
            Write-Warning 'Native window host failed to start. Reinstall with Install-WindowHost.ps1.'
            return $false
        }
    } finally {
        if ($null -ne $priorRunAsNode) { $env:ELECTRON_RUN_AS_NODE = $priorRunAsNode }
    }
    return $true
}

function Get-AppRootFromConfig {
    param([Parameter(Mandatory)][object]$Config)

    if ($Config.installRoot) { return [string]$Config.installRoot }

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

function Write-AppModeLog {
    param(
        [Parameter(Mandatory)][string]$LogPath,
        [Parameter(Mandatory)][string]$Message
    )

    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[$stamp] $Message" | Add-Content -Path $LogPath -Encoding UTF8
}

# Profile metadata is owned by the host runtime; launchers never rewrite it.

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

function Set-AppModeWindowIdentity {
    param(
        [Parameter(Mandatory)]$Config,
        [string]$AppUserModelId = "OpenAI.ChatGPT.AppMode",
        [string]$IconPath,
        [int]$TimeoutSeconds = 15,
        [string]$LogPath
    )

    Initialize-WindowIdentityApi

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $windows = @()

    while ((Get-Date) -lt $deadline -and $windows.Count -eq 0) {
        Start-Sleep -Milliseconds 250
        $windows = @(Get-AppModeOwnedWindows $Config | ForEach-Object {
            [pscustomobject]@{ Id=$_.processId; MainWindowHandle=[IntPtr]$_.handle }
        })
    }

    if ($windows.Count -eq 0) {
        if ($LogPath) {
            Write-AppModeLog -LogPath $LogPath -Message "No visible App Mode window was found for taskbar AppUserModelID."
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
