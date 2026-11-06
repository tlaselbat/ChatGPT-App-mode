param([string]$Revision)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$testSource = Get-Content -LiteralPath (Join-Path $root 'tests/Runtime.Tests.ps1') -Raw
$start = $testSource.IndexOf('using System;', $testSource.IndexOf('# Deterministic window'))
$end = $testSource.IndexOf("'@", $start)
$native = $testSource.Substring($start, $end - $start)
$native = $native.Replace('public static long Foreground', 'public static int Queries = 0; public static int Writes = 0; public static long Foreground')
$native = $native.Replace('return new IntPtr(Pointer);', 'Queries++; return new IntPtr(Pointer);')
$native = $native.Replace('Opacity[hwnd.ToInt64()] = percent;', 'Writes++; Opacity[hwnd.ToInt64()] = percent;')
Add-Type -TypeDefinition $native
if ($Revision) { $source = (git -C $root show "${Revision}:tools/AppMode.Windows.ps1") -join "`n" }
else { $source = Get-Content -LiteralPath (Join-Path $root 'tools/AppMode.Windows.ps1') -Raw }
. ([scriptblock]::Create($source))
$results = foreach ($scenario in @('empty', 'disabled', 'unpinned', 'pinned', 'transition', 'pointer', 'multiple')) {
    $config = [pscustomobject]@{ pinnedWindow = [pscustomobject]@{ fadeWhenInactive=($scenario -ne 'disabled'); inactiveOpacityPercent=30 } }
    $windows = @([pscustomobject]@{handle=100101;processId=1001})
    if ($scenario -eq 'empty') { $windows = @() }
    if ($scenario -eq 'multiple') { $windows += [pscustomobject]@{handle=100102;processId=1001} }
    [AppModeNative]::SetTopMost([IntPtr]100101, ($scenario -ne 'unpinned')) | Out-Null
    [AppModeNative]::SetTopMost([IntPtr]100102, ($scenario -eq 'multiple')) | Out-Null
    [AppModeNative]::Opacity.Clear(); $script:appModeOpacityTransitions.Clear(); $script:appModeInteractionUntil.Clear()
    [AppModeNative]::Pointer = 999999; [AppModeNative]::Queries = 0; [AppModeNative]::Writes = 0
    $ticks = 0; $watch = [Diagnostics.Stopwatch]::StartNew()
    for ($now = 0; $now -lt 5000;) {
        if ($scenario -eq 'pointer') { [AppModeNative]::Pointer = if (($now % 1000) -lt 500) { 100101 } else { 999999 } }
        if ($scenario -eq 'transition') { [AppModeNative]::Pointer = if ($now -lt 1000) { 100101 } else { 999999 } }
        Update-AppModePinnedOpacity -Config $config -Windows $windows -NowMs $now
        $ticks++
        $now += $(if ($Revision) { 16 } else { Get-AppModeOpacityDelay -Config $config -Windows $windows -NowMs $now })
    }
    [pscustomobject]@{ scenario=$scenario; simulatedMs=5000; ticks=$ticks; pointerQueries=[AppModeNative]::Queries; opacityWrites=[AppModeNative]::Writes; harnessMs=$watch.Elapsed.TotalMilliseconds }
}
ConvertTo-Json -InputObject @($results) -Depth 4
