param([long]$Handle, [int]$OwnerId, [ValidateSet('ZoomKeyIn','ZoomReset','Reload','ForceReload','ReloadR','ForceReloadR','DevTools','ZoomIn','ZoomOut','Activate','Capture','CaptureNarrow','Maximize','Restore','Minimize','Drag','Resize','Close')][string]$Mode, [string]$Scratch)
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\ChatGPT-AppMode.Helpers.ps1')
Initialize-AppModeNativeApi
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$OwnerId"
$runs = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $PSScriptRoot) 'test-results\runs')) + '\'
if (-not ([IO.Path]::GetFullPath($Scratch) + '\').StartsWith($runs, [StringComparison]::OrdinalIgnoreCase) -or
    $process.Name -ne 'electron.exe' -or $process.CommandLine -notlike '*--fixture=*' -or
    $process.CommandLine.IndexOf($Scratch, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
    -not [AppModeNative]::WindowMatchesProcess([IntPtr]$Handle, $OwnerId)) { throw 'Only isolated fixture windows may be exercised.' }
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HostFixtureNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder text, int count);
}
'@
function Get-CoveringWindowDescription {
    $covering = [AppModeNative]::GetPointerWindow()
    if ($covering -eq [IntPtr]::Zero) { return 'no window under pointer' }
    $coverPid = [uint32]0
    [HostFixtureNative]::GetWindowThreadProcessId($covering, [ref]$coverPid) | Out-Null
    $title = New-Object System.Text.StringBuilder 256
    [HostFixtureNative]::GetWindowText($covering, $title, 256) | Out-Null
    $procName = try { (Get-Process -Id $coverPid -ErrorAction Stop).ProcessName } catch { "pid $coverPid" }
    return "covered by '$($title.ToString())' ($procName, hwnd $($covering.ToInt64()), pid $coverPid)"
}
$hwnd = [IntPtr]$Handle
$rect = New-Object HostFixtureNative+RECT
[HostFixtureNative]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
function Click-At([int]$X, [int]$Y) {
    [HostFixtureNative]::SetForegroundWindow($hwnd) | Out-Null
    [HostFixtureNative]::SetCursorPos($X, $Y) | Out-Null
    Start-Sleep -Milliseconds 120
    if ([AppModeNative]::GetPointerWindow().ToInt64() -ne $Handle) { throw "Fixture is covered; refusing to click another window ($(Get-CoveringWindowDescription))." }
    [HostFixtureNative]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    [HostFixtureNative]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    Start-Sleep -Milliseconds 250
}
switch ($Mode) {
    { $_ -in 'ZoomKeyIn','ZoomReset','Reload','ForceReload','ReloadR','ForceReloadR','DevTools' } {
        [HostFixtureNative]::SetForegroundWindow($hwnd) | Out-Null
        Start-Sleep -Milliseconds 100
        if ([AppModeNative]::GetForegroundWindow().ToInt64() -ne $Handle) { throw 'Fixture is not active; refusing keyboard input.' }
        $control = $Mode -in 'ZoomKeyIn','ZoomReset','ForceReload','ReloadR','ForceReloadR'
        $shift = $Mode -eq 'ForceReloadR'
        $key = switch ($Mode) { 'ZoomKeyIn' {187}; 'ZoomReset' {48}; 'Reload' {116}; 'ForceReload' {116}; 'ReloadR' {82}; 'ForceReloadR' {82}; 'DevTools' {123} }
        try {
            if ($control) { [HostFixtureNative]::keybd_event(17,0,0,[UIntPtr]::Zero) }
            if ($shift) { [HostFixtureNative]::keybd_event(16,0,0,[UIntPtr]::Zero) }
            Start-Sleep -Milliseconds 50
            [HostFixtureNative]::keybd_event([byte]$key,0,0,[UIntPtr]::Zero)
            [HostFixtureNative]::keybd_event([byte]$key,0,2,[UIntPtr]::Zero)
            Start-Sleep -Milliseconds 100
        } finally {
            if ($shift) { [HostFixtureNative]::keybd_event(16,0,2,[UIntPtr]::Zero) }
            if ($control) { [HostFixtureNative]::keybd_event(17,0,2,[UIntPtr]::Zero) }
        }
        Start-Sleep -Milliseconds 200
    }
    { $_ -in 'ZoomIn','ZoomOut' } {
        [HostFixtureNative]::SetForegroundWindow($hwnd) | Out-Null
        [HostFixtureNative]::SetCursorPos(($rect.Left + 150), ($rect.Top + 150)) | Out-Null
        Start-Sleep -Milliseconds 120
        if ([AppModeNative]::GetPointerWindow().ToInt64() -ne $Handle) { throw "Fixture is covered; refusing wheel input ($(Get-CoveringWindowDescription))." }
        try {
            [HostFixtureNative]::keybd_event(17,0,0,[UIntPtr]::Zero)
            Start-Sleep -Milliseconds 40
            $delta = if ($Mode -eq 'ZoomIn') { [uint32]120 } else { [uint32]4294967176 }
            [HostFixtureNative]::mouse_event(0x800,0,0,$delta,[UIntPtr]::Zero)
            Start-Sleep -Milliseconds 100
        } finally { [HostFixtureNative]::keybd_event(17,0,2,[UIntPtr]::Zero) }
        Start-Sleep -Milliseconds 200
    }
    'Activate' { Click-At ($rect.Left + 300) ($rect.Top + 24) }
    'Maximize' { Click-At ($rect.Right - 69) ($rect.Top + 24) }
    'Restore' { Click-At ($rect.Right - 69) ($rect.Top + 24) }
    'Minimize' { Click-At ($rect.Right - 115) ($rect.Top + 24) }
    'Close' { Click-At ($rect.Right - 23) ($rect.Top + 24) }
    { $_ -in 'Drag','Resize' } {
        [HostFixtureNative]::SetForegroundWindow($hwnd) | Out-Null
        $x = if ($Mode -eq 'Drag') { $rect.Left + 300 } else { $rect.Right - 1 }
        $y = if ($Mode -eq 'Drag') { $rect.Top + 24 } else { $rect.Bottom - 1 }
        $hit = [HostFixtureNative]::SendMessage($hwnd, 0x84, [IntPtr]::Zero, [IntPtr](($y -shl 16) -bor ($x -band 65535))).ToInt64()
        [HostFixtureNative]::SetCursorPos($x,$y) | Out-Null
        Start-Sleep -Milliseconds 100
        if ([AppModeNative]::GetPointerWindow().ToInt64() -ne $Handle) { throw "Fixture is covered; refusing to drag another window ($(Get-CoveringWindowDescription))." }
        [HostFixtureNative]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
        Start-Sleep -Milliseconds 150
        for ($step = 1; $step -le 8; $step++) {
            [HostFixtureNative]::SetCursorPos(($x + $step * 5),($y + $step * 4)) | Out-Null
            Start-Sleep -Milliseconds 30
        }
        [HostFixtureNative]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
        Start-Sleep -Milliseconds 100
        $after = New-Object HostFixtureNative+RECT
        [HostFixtureNative]::GetWindowRect($hwnd, [ref]$after) | Out-Null
        if ($Mode -eq 'Drag' -and $after.Left -eq $rect.Left -and $after.Top -eq $rect.Top) { throw "Header drag did not move the fixture (hit=$hit, x=$x, y=$y)." }
        if ($Mode -eq 'Resize' -and ($after.Right - $after.Left) -eq ($rect.Right - $rect.Left)) { throw 'Border drag did not resize the fixture.' }
    }
    default {
        $bitmap = New-Object Drawing.Bitmap (($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top))
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $dc = $graphics.GetHdc()
        try { if (-not [HostFixtureNative]::PrintWindow($hwnd,$dc,2)) { throw 'Fixture capture failed.' } }
        finally { $graphics.ReleaseHdc($dc) }
        $file = if ($Mode -eq 'CaptureNarrow') { 'native-header-narrow.png' } else { 'native-header-desktop.png' }
        try { $bitmap.Save((Join-Path $Scratch $file), [Drawing.Imaging.ImageFormat]::Png) }
        finally { $graphics.Dispose(); $bitmap.Dispose() }
    }
}
