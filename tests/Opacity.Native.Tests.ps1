$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\ChatGPT-AppMode.Helpers.ps1')
Initialize-AppModeNativeApi
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PinFixture {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern IntPtr CreateWindowEx(int exStyle, string className, string title, uint style,
        int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr hwnd);
}
'@
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
# HWNDs belong to synthetic forms and an off-screen popup. No foreground window,
# browser profile, or user window is read, activated, or changed.
$form = New-Object Windows.Forms.Form
$otherLayeredForm = New-Object Windows.Forms.Form
$pinHandle = [PinFixture]::CreateWindowEx(0, 'STATIC', 'Synthetic native pin fixture', 2415919104,
    -32000, -32000, 1, 1, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero, [IntPtr]::Zero)
try {
    # Exercise raw Z-order before WinForms initializes its thread's HWND machinery.
    Assert ($pinHandle -ne [IntPtr]::Zero) 'Could not create the native pin fixture.'
    Assert (-not [AppModeNative]::IsTopMost($pinHandle)) 'Synthetic window unexpectedly started pinned.'
    Assert ([AppModeNative]::SetTopMost($pinHandle, $true)) 'Native pin operation failed.'
    Assert ([AppModeNative]::IsTopMost($pinHandle)) 'Native pin did not set WS_EX_TOPMOST.'
    Assert ([AppModeNative]::SetTopMost($pinHandle, $false)) 'Native unpin operation failed.'
    Assert (-not [AppModeNative]::IsTopMost($pinHandle)) 'Native unpin did not clear WS_EX_TOPMOST.'
    $handle = $form.Handle
    Assert ([AppModeNative]::WindowMatchesProcess($handle, $PID)) 'Synthetic HWND owner check failed.'
    Assert (-not [AppModeNative]::HasMouseInteraction($handle)) 'Idle fixture reported a mouse interaction.'
    $rect = New-Object AppModeNative+RECT
    $rect.Left = -100; $rect.Top = 100; $rect.Right = 100; $rect.Bottom = 300
    $point = New-Object AppModeNative+POINT
    $point.X = 104; $point.Y = 200
    Assert ([AppModeNative]::InBoundaryBand($rect, $point, 8)) 'Nearby pointer was outside the tolerance band.'
    $point.X = 109
    Assert (-not [AppModeNative]::InBoundaryBand($rect, $point, 8)) 'Distant pointer was inside the tolerance band.'
    $point.X = 0
    Assert (-not [AppModeNative]::InBoundaryBand($rect, $point, 8)) 'Tolerance treated a covered interior as an edge.'
    $point.X = -104
    Assert ([AppModeNative]::InBoundaryBand($rect, $point, 8)) 'Negative-monitor coordinates broke edge tolerance.'
    Assert ([AppModeNative]::SetOpacity($handle, 30)) 'Native whole-window opacity failed.'
    Assert ([Math]::Abs([AppModeNative]::GetOpacityAlpha($handle) - 76.5) -le 0.5) 'Native alpha does not match 30% opacity.'
    Assert ([AppModeNative]::SetOpacity($handle, 55)) 'Native opacity update failed.'
    Assert ([Math]::Abs([AppModeNative]::GetOpacityAlpha($handle) - 140.25) -lt 1) 'Native alpha does not match 55% opacity.'
    Assert ([AppModeNative]::SetOpacity($handle, 55.5)) 'Fractional animation frame failed.'
    Assert ([AppModeNative]::GetOpacityAlpha($handle) -eq 142) 'Fractional animation frame lost alpha precision.'
    Assert ([AppModeNative]::RestoreOpacity($handle)) 'Native opacity restore failed.'
    Assert ([AppModeNative]::GetOpacityAlpha($handle) -eq 255) 'Native restore did not return full opacity.'
    Assert ([AppModeNative]::RestoreOpacity($handle)) 'Repeated native cleanup failed.'
    $otherLayeredForm.Opacity=0.8
    $otherHandle=$otherLayeredForm.Handle
    Assert (-not [AppModeNative]::SetOpacity($otherHandle, 30)) 'Existing layered-window state was overwritten.'
    Assert ([AppModeNative]::GetOpacityAlpha($otherHandle) -eq 204) 'An existing opacity setting was changed.'
    Write-Output 'PASS: real Win32 pin/unpin, alpha changes/restoration and preservation of pre-existing layered windows (isolated fixture HWNDs).'
} finally {
    if ($pinHandle -ne [IntPtr]::Zero) { [PinFixture]::DestroyWindow($pinHandle) | Out-Null }
    [AppModeNative]::RestoreOpacity($form.Handle) | Out-Null
    $form.Dispose(); $otherLayeredForm.Dispose()
}
