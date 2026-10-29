function Initialize-AppModeNativeApi {
    if (([Management.Automation.PSTypeName]'AppModeNative').Type) { return }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AppModeNative {
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct GUIINFO {
        public int size, flags;
        public IntPtr active, focus, capture, menuOwner, moveSize, caret;
        public RECT caretRect;
    }
    [StructLayout(LayoutKind.Sequential)] public struct PLACEMENT {
        public int length, flags, showCmd; public POINT min, max; public RECT normal;
    }
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr hwnd, ref PLACEMENT placement);
    [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUIINFO info);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr64(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll", EntryPoint="SetWindowLongW")] static extern int SetWindowLong32(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool SetProp(IntPtr hwnd, string name, IntPtr value);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetProp(IntPtr hwnd, string name);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr RemoveProp(IntPtr hwnd, string name);
    [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint key, byte alpha, uint flags);
    [DllImport("user32.dll")] static extern bool GetLayeredWindowAttributes(IntPtr hwnd, out uint key, out byte alpha, out uint flags);
    const int Layered = 0x80000;
    const string OpacityMarker = "OpenAI.ChatGPT.AppMode.ManagedOpacity.v1";
    static void WriteExtendedStyle(IntPtr hwnd, int style) {
        if (IntPtr.Size == 8) SetWindowLongPtr64(hwnd, -20, new IntPtr(style));
        else SetWindowLong32(hwnd, -20, style);
    }
    public static bool WindowMatchesProcess(IntPtr hwnd, int processId) {
        uint actual; GetWindowThreadProcessId(hwnd, out actual);
        return actual != 0 && actual == processId;
    }
    public static IntPtr GetPointerWindow() {
        POINT point;
        return GetCursorPos(out point) ? GetAncestor(WindowFromPoint(point), 2) : IntPtr.Zero;
    }
    public static bool MouseButtonsDown() {
        return GetAsyncKeyState(1) < 0 || GetAsyncKeyState(2) < 0 || GetAsyncKeyState(4) < 0;
    }
    static bool BelongsToWindow(IntPtr child, IntPtr hwnd) {
        return child != IntPtr.Zero && (child == hwnd || GetAncestor(child, 2) == hwnd);
    }
    public static bool HasMouseInteraction(IntPtr hwnd) {
        uint pid;
        uint thread = GetWindowThreadProcessId(hwnd, out pid);
        if (thread == 0) return false;
        var info = new GUIINFO(); info.size = Marshal.SizeOf(info);
        // Capture covers selections/scrollbar drags; moveSize covers native dragging/resizing.
        return GetGUIThreadInfo(thread, ref info) &&
            (BelongsToWindow(info.capture, hwnd) || BelongsToWindow(info.moveSize, hwnd) ||
             BelongsToWindow(info.menuOwner, hwnd));
    }
    public static bool InBoundaryBand(RECT rect, POINT point, int margin) {
        bool inside = point.X >= rect.Left && point.X < rect.Right && point.Y >= rect.Top && point.Y < rect.Bottom;
        return !inside && point.X >= rect.Left - margin && point.X < rect.Right + margin &&
            point.Y >= rect.Top - margin && point.Y < rect.Bottom + margin;
    }
    public static bool IsPointerInBoundaryBand(IntPtr hwnd) {
        POINT point; RECT rect;
        if (!GetCursorPos(out point) || !GetWindowRect(hwnd, out rect) || IsIconic(hwnd)) return false;
        int margin = Math.Max(8, (int)Math.Round(8 * GetDpiForWindow(hwnd) / 96.0));
        // Only retain an existing hover just outside the border. Never reveal a covered window.
        return InBoundaryBand(rect, point, margin);
    }
    public static bool SetOpacity(IntPtr hwnd, double percent) {
        if (percent < 10 || percent > 100) return false;
        if (percent == 100) return RestoreOpacity(hwnd);
        int style = GetWindowLong(hwnd, -20);
        if (GetProp(hwnd, OpacityMarker) == IntPtr.Zero) {
            // Do not overwrite opacity/compositing managed by Chromium or another app.
            if ((style & Layered) != 0 || !SetProp(hwnd, OpacityMarker, new IntPtr(1))) return false;
        }
        if ((style & Layered) == 0) WriteExtendedStyle(hwnd, style | Layered);
        if ((GetWindowLong(hwnd, -20) & Layered) == 0) { RemoveProp(hwnd, OpacityMarker); return false; }
        byte desired = (byte)Math.Round(255 * percent / 100.0);
        uint key, flags; byte alpha;
        if (GetLayeredWindowAttributes(hwnd, out key, out alpha, out flags) && flags == 2 && alpha == desired) return true;
        if (SetLayeredWindowAttributes(hwnd, 0, desired, 2)) return true;
        RestoreOpacity(hwnd);
        return false;
    }
    public static int GetOpacityAlpha(IntPtr hwnd) {
        if ((GetWindowLong(hwnd, -20) & Layered) == 0) return 255;
        uint key, flags; byte alpha;
        return GetLayeredWindowAttributes(hwnd, out key, out alpha, out flags) ? alpha : -1;
    }
    public static bool RestoreOpacity(IntPtr hwnd) {
        // The marker survives a control-server restart; no old HWND file is trusted.
        if (GetProp(hwnd, OpacityMarker) == IntPtr.Zero) return true;
        int style = GetWindowLong(hwnd, -20);
        if ((style & Layered) != 0) {
            SetLayeredWindowAttributes(hwnd, 0, 255, 2);
            WriteExtendedStyle(hwnd, style & ~Layered);
            if ((GetWindowLong(hwnd, -20) & Layered) != 0) return false;
            SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0, 0x37);
        }
        RemoveProp(hwnd, OpacityMarker);
        return true;
    }
    public static bool IsTopMost(IntPtr hwnd) { return (GetWindowLong(hwnd, -20) & 8) != 0; }
    public static bool SetTopMost(IntPtr hwnd, bool on) { return SetWindowPos(hwnd, new IntPtr(on ? -1 : -2), 0, 0, 0, 0, 0x13); }
    public static void Resize(IntPtr hwnd, int x, int y, int width, int height) {
        ShowWindow(hwnd, 9);
        if (!SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height, 0x14)) throw new InvalidOperationException("Window resize failed.");
    }
    public static PLACEMENT GetPlacement(IntPtr hwnd) {
        var result = new PLACEMENT(); result.length = Marshal.SizeOf(result);
        if (!GetWindowPlacement(hwnd, ref result)) throw new InvalidOperationException("Window placement unavailable.");
        return result;
    }
}
'@
}

function Get-AppModeOpacitySettings {
    param($Config)
    $percent = 30
    $parsed = 0
    if ([int]::TryParse([string]$Config.pinnedWindow.inactiveOpacityPercent, [ref]$parsed) -and $parsed -ge 10 -and $parsed -le 100) { $percent = $parsed }
    [pscustomobject]@{ enabled = $Config.pinnedWindow.fadeWhenInactive -ne $false; percent = $percent }
}

$script:appModeOpacityTransitions = @{}
$script:appModeInteractionUntil = @{}

function Get-AppModeMonotonicMs {
    return [Diagnostics.Stopwatch]::GetTimestamp() * 1000.0 / [Diagnostics.Stopwatch]::Frequency
}

function Get-AppModeOpacityFrame {
    param($State, [double]$NowMs)
    $progress = [Math]::Max(0.0, [Math]::Min(1.0, ($NowMs - $State.start) / $State.duration))
    # Smoothstep has zero velocity at both ends, without overshooting the target.
    $ease = $progress * $progress * (3 - 2 * $progress)
    return $State.from + ($State.target - $State.from) * $ease
}

function Update-AppModePinnedOpacity {
    param($Config, [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Windows, [switch]$Restore,
        [double]$NowMs = (Get-AppModeMonotonicMs))
    Initialize-AppModeNativeApi
    $settings = Get-AppModeOpacitySettings $Config
    $pointer = [AppModeNative]::GetPointerWindow().ToInt64()
    $buttonsDown = [AppModeNative]::MouseButtonsDown()
    foreach ($window in $Windows) {
        $handle = [IntPtr]$window.handle
        $key = '{0}:{1}' -f $window.processId, $window.handle
        # Cached discovery never authorizes a recycled HWND owned by another PID.
        if (-not [AppModeNative]::WindowMatchesProcess($handle, [int]$window.processId)) {
            $script:appModeOpacityTransitions.Remove($key)
            $script:appModeInteractionUntil.Remove($key)
            continue
        }
        if ($Restore -or -not $settings.enabled -or $settings.percent -eq 100 -or -not [AppModeNative]::IsTopMost($handle)) {
            [AppModeNative]::RestoreOpacity($handle) | Out-Null
            $script:appModeOpacityTransitions.Remove($key)
            $script:appModeInteractionUntil.Remove($key)
            continue
        }
        $state = $script:appModeOpacityTransitions[$key]
        if (-not $state) {
            $alpha = [AppModeNative]::GetOpacityAlpha($handle)
            if ($alpha -lt 0) { continue }
            $current = $alpha * 100.0 / 255
            $state = @{ from = $current; target = $current; start = $NowMs; duration = 1; hovered = $false; dragging = $false }
            $script:appModeOpacityTransitions[$key] = $state
        }
        $hover = $pointer -eq $window.handle
        # Latch only gestures observed over this window; unrelated outside clicks cannot hold it open.
        $state.dragging = $buttonsDown -and ($hover -or $state.dragging)
        $state.hovered = $hover -or ($state.hovered -and [AppModeNative]::IsPointerInBoundaryBand($handle))
        $scrolling = $script:appModeInteractionUntil.ContainsKey($key) -and $NowMs -lt $script:appModeInteractionUntil[$key]
        if (-not $scrolling) { $script:appModeInteractionUntil.Remove($key) }
        $fade = -not ($state.hovered -or $state.dragging -or $scrolling -or [AppModeNative]::HasMouseInteraction($handle))
        $target = if ($fade) { $settings.percent } else { 100 }
        $current = Get-AppModeOpacityFrame $state $NowMs
        if ($state.target -ne $target) {
            # Reverse from the current frame. Brief pointer exits never start dimming.
            $delay = if ($fade -and $state.target -eq 100) { 180 } else { 0 }
            $state.from = $current
            $state.target = $target
            $state.start = $NowMs + $delay
            $state.duration = if ($fade) { 300 } else { 140 }
        }
        $value = Get-AppModeOpacityFrame $state $NowMs
        if (-not [AppModeNative]::SetOpacity($handle, $value)) {
            $script:appModeOpacityTransitions.Remove($key)
        }
    }
}

function Test-AppModeNativeHostProcess {
    param($Process, [string]$AppRoot)
    if (-not $AppRoot -or $Process.Name -ne 'electron.exe' -or -not $Process.ExecutablePath -or -not $Process.CommandLine) { return $false }
    $expectedExe = Join-Path $AppRoot 'node_modules\electron\dist\electron.exe'
    if (-not [IO.Path]::GetFullPath([string]$Process.ExecutablePath).Equals([IO.Path]::GetFullPath($expectedExe), [StringComparison]::OrdinalIgnoreCase)) { return $false }
    if ($Process.CommandLine -match '(?:^|\s)"?--type=') { return $false }
    foreach ($entry in @(
        @{ name = 'app-mode-root'; expected = $AppRoot },
        @{ name = 'user-data-dir'; expected = (Join-Path $AppRoot 'Browser\AppModeHostProfile') }
    )) {
        # Windows launchers may quote the complete argument or just its value.
        $name = $entry.name
        $matchesForArgument = [regex]::Matches($Process.CommandLine, ('(?:^|\s)(?:"--' + $name + '=([^"]+)"|--' + $name + '=(?:"([^"]+)"|([^\s"]+)))'))
        if ($matchesForArgument.Count -ne 1) { return $false }
        $match = $matchesForArgument[0]
        $actual = if ($match.Groups[1].Success) { $match.Groups[1].Value } elseif ($match.Groups[2].Success) { $match.Groups[2].Value } else { $match.Groups[3].Value }
        try {
            if (-not [IO.Path]::GetFullPath($actual).TrimEnd('\').Equals([IO.Path]::GetFullPath($entry.expected).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { return $false }
        } catch { return $false }
    }
    return $true
}

function Get-AppModeOwnedWindows {
    param([Parameter(Mandatory)]$Config)
    # Match the executable boundary AND the browser's explicit user-data-dir.
    # Never match arbitrary command lines that merely mention the installation.
    $root = [IO.Path]::GetFullPath([string]$Config.chromiumPortableRoot).TrimEnd('\', '/') + '\'
    $profile = [string]$Config.appProfileDir
    if (-not $profile) { $profile = Join-Path $Config.chromiumPortableRoot 'Data\profile' }
    $appRoot = Get-AppRootFromConfig $Config
    $candidates = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='electron.exe'" -ErrorAction Stop)
    $processes = @($candidates | Where-Object {
        $_.Name -eq 'chrome.exe' -and $_.ExecutablePath -and
        $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and
        $_.CommandLine -and $_.CommandLine -notmatch '(?:^|\s)--type='
    })
    Initialize-WindowIdentityApi
    foreach ($process in @($candidates | Where-Object { Test-AppModeNativeHostProcess $_ $appRoot })) {
        foreach ($handle in [ChatGptAppModeWindowIdentity]::GetVisibleTopLevelWindowsForProcessId([int]$process.ProcessId)) {
            [pscustomobject]@{ handle = $handle.ToInt64(); processId = [int]$process.ProcessId }
        }
    }
    foreach ($process in $processes) {
        if ($profile) {
            $match = [regex]::Match($process.CommandLine, '(?:^|\s)--user-data-dir=(?:"([^"]+)"|([^\s]+))')
            if (-not $match.Success) { continue }
            $actual = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
            if (-not [IO.Path]::GetFullPath($actual).TrimEnd('\').Equals([IO.Path]::GetFullPath($profile).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { continue }
        }
        foreach ($handle in [ChatGptAppModeWindowIdentity]::GetVisibleTopLevelWindowsForProcessId([int]$process.ProcessId)) {
            [pscustomobject]@{ handle = $handle.ToInt64(); processId = [int]$process.ProcessId }
        }
    }
}

function Get-AppModeTargetWindow {
    param($Config, [long]$Handle = 0, [int]$ProcessId = 0)
    Initialize-AppModeNativeApi
    $windows = @(Get-AppModeOwnedWindows $Config)
    $foreground = [AppModeNative]::GetForegroundWindow().ToInt64()
    if (-not $Handle) { return $windows | Where-Object { $_.handle -eq $foreground } | Select-Object -First 1 }
    # PID revalidation prevents reusing a stale HWND after its original process exits.
    return $windows | Where-Object { $_.handle -eq $Handle -and $_.processId -eq $ProcessId } | Select-Object -First 1
}

function Save-AppModeWindowPlacement {
    param($Config, [string]$AppRoot)
    if ($Config.rememberWindowPlacement -eq $false) { return }
    $target = Get-AppModeTargetWindow $Config
    if (-not $target -or [AppModeNative]::IsIconic([IntPtr]$target.handle)) { return }
    $placement = [AppModeNative]::GetPlacement([IntPtr]$target.handle)
    $bounds = $placement.normal
    if ($bounds.Right -le $bounds.Left -or $bounds.Bottom -le $bounds.Top) { return }
    Add-Type -AssemblyName System.Windows.Forms
    $screen = [Windows.Forms.Screen]::FromHandle([IntPtr]$target.handle)
    $state = [ordered]@{
        # WINDOWPLACEMENT uses workspace coordinates; Chromium launch flags use screen coordinates.
        x = $bounds.Left + $screen.WorkingArea.Left - $screen.Bounds.Left
        y = $bounds.Top + $screen.WorkingArea.Top - $screen.Bounds.Top
        width = $bounds.Right - $bounds.Left; height = $bounds.Bottom - $bounds.Top
        maximized = $placement.showCmd -eq 3
    }
    $path = Join-Path $AppRoot 'logs\window-state.json'
    $json = ConvertTo-Json $state -Compress
    if ((Test-Path -LiteralPath $path) -and ((Get-Content -LiteralPath $path -Raw | ConvertFrom-Json | ConvertTo-Json -Compress) -eq $json)) { return }
    Write-AppModeJson -Path $path -Value $state
}
