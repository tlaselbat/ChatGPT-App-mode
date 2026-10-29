param([Parameter(Mandatory)][string]$Scratch)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'tools\ChatGPT-AppMode.Helpers.ps1')
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Rejected([scriptblock]$Action, [string]$Message) {
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    Assert $rejected $Message
}
New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
$nativeProcess = [pscustomobject]@{
    Name = 'electron.exe'; ExecutablePath = (Join-Path $Scratch 'node_modules\electron\dist\electron.exe')
    CommandLine = ('electron.exe --app-mode-root="{0}" --user-data-dir="{0}\Browser\AppModeHostProfile"' -f $Scratch)
}
Assert (Test-AppModeNativeHostProcess $nativeProcess $Scratch) 'Native host ownership rejected its exact root/profile.'
$fullyQuoted = $nativeProcess | ConvertTo-Json | ConvertFrom-Json
$fullyQuoted.CommandLine = ('electron.exe "--app-mode-root={0}" "--user-data-dir={0}\Browser\AppModeHostProfile"' -f $Scratch)
Assert (Test-AppModeNativeHostProcess $fullyQuoted $Scratch) 'Fully quoted native host arguments were rejected.'
foreach ($badArgument in @(' --type=renderer', ' --app-mode-root=E:\Other', ' --user-data-dir=E:\Other')) {
    $bad = $nativeProcess | ConvertTo-Json | ConvertFrom-Json
    $bad.CommandLine += $badArgument
    Assert (-not (Test-AppModeNativeHostProcess $bad $Scratch)) 'Native ownership accepted renderer or duplicate bindings.'
}
$bad = $nativeProcess | ConvertTo-Json | ConvertFrom-Json
$bad.ExecutablePath = Join-Path $Scratch 'unrelated\electron.exe'
Assert (-not (Test-AppModeNativeHostProcess $bad $Scratch)) 'Unrelated Electron executable was accepted.'
$bad = $nativeProcess | ConvertTo-Json | ConvertFrom-Json
$bad.CommandLine = $bad.CommandLine.Replace('AppModeHostProfile', 'ChromiumProfile')
Assert (-not (Test-AppModeNativeHostProcess $bad $Scratch)) 'Native ownership accepted a different profile.'
Assert (-not (Start-AppModeNativeHost -Config ([pscustomobject]@{windowHost='chromium'}) -AppRoot $Scratch)) 'Chromium rollback was ignored.'
Assert (-not (Start-AppModeNativeHost -Config ([pscustomobject]@{windowHost='electron'}) -AppRoot $Scratch)) 'Missing native runtime did not fall back.'
$config = [pscustomobject]@{
    url = 'https://chatgpt.com/'; useAppMode = $true; restoreLastUrl = $false
    chromiumPortableRoot = (Join-Path $Scratch 'Browser\ChromiumPortable')
    appProfileDir = (Join-Path $Scratch 'Browser\AppProfile')
    extensionDir = (Join-Path $Scratch 'extension')
    window = [pscustomobject]@{width=1100; height=700; startMaximized=$false}
    flags = @('--restore-last-session')
    privacy = [pscustomobject]@{trackRecentChats=$true; showChatTitles=$false; retentionDays=7}
}
New-Item -ItemType Directory -Force -Path $config.appProfileDir | Out-Null
Assert ((Assert-AppModeResetTarget $config $Scratch) -eq $config.appProfileDir) 'Reset must resolve the launch profile.'
foreach ($unsafe in @($Scratch, (Join-Path $Scratch 'Browser'), $config.chromiumPortableRoot, (Join-Path $Scratch 'extension'), (Join-Path $Scratch '..\Outside'), (Join-Path $config.chromiumPortableRoot 'App'), (Join-Path $Scratch 'Browser\ChromiumPortable.\App'))) {
    $copy = $config | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    $copy.appProfileDir = $unsafe
    Assert-Rejected { Assert-AppModeResetTarget $copy $Scratch } 'Unsafe reset path accepted.'
}
$outside = Join-Path $Scratch 'outside'
New-Item -ItemType Directory -Force -Path $outside | Out-Null
$junction = Join-Path $Scratch 'Browser\linked-profile'
New-Item -ItemType Junction -Path $junction -Target $outside | Out-Null
$copy = $config | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$copy.appProfileDir = $junction
Assert-Rejected { Assert-AppModeResetTarget $copy $Scratch } 'Junction reset accepted.'
Remove-Item -LiteralPath $junction -Force
$nestedJunction = Join-Path $config.appProfileDir 'nested-junction'
New-Item -ItemType Junction -Path $nestedJunction -Target $outside | Out-Null
Assert-Rejected { Assert-AppModeResetTarget $config $Scratch } 'Nested junction reset accepted.'
Remove-Item -LiteralPath $nestedJunction -Force
function Get-CimInstance { return [pscustomobject]@{ExecutablePath=(Join-Path $config.chromiumPortableRoot 'App\chrome.exe'); Name='chrome.exe'; CommandLine='synthetic'} }
Assert-Rejected { Assert-AppModeBrowserStopped $config } 'Running browser was accepted.'
Remove-Item Function:\Get-CimInstance

$argsLine = ConvertTo-ArgLine -Config $config
Assert ($argsLine -like '*--window-size=1100,700*') 'Configured dimensions missing.'
Assert ($argsLine -notlike '*--restore-last-session*') 'Restore disabled but Chromium restore remains enabled.'
foreach ($url in @('https://chatgpt.com.evil.test/c/synthetic', 'https://chatgpt.com:444/c/synthetic', 'https://x@chatgpt.com/c/synthetic', 'https://chatgpt.com/c/synthetic?token=synthetic', "'https://chatgpt.com/c/synthetic'", 'https://chatgpt.com/g/synthetic" --user-data-dir=synthetic')) {
    Assert (-not (Test-RestorableChatGptUrl $url)) 'Unsafe restore URL accepted.'
}
$area = [pscustomobject]@{Left=-1920; Top=0; Width=1920; Height=1080; Right=0; Bottom=1080}
$bounds = Get-SafeWindowBounds -Bounds ([pscustomobject]@{x=99999;y=-99999;width=3000;height=1600}) -WorkingArea $area
Assert ($bounds.x -eq -1920 -and $bounds.y -eq 0 -and $bounds.width -eq 1920 -and $bounds.height -eq 1080) 'Window bounds were not clamped to the monitor.'
$defaults = [pscustomobject]@{window=[pscustomobject]@{width=1280;height=900}; restoreLastUrl=$true; privacy=[pscustomobject]@{showChatTitles=$true; retentionDays=30}}
$existing = [pscustomobject]@{window=[pscustomobject]@{width=850};restoreLastUrl=$false;custom='preserve';privacy=[pscustomobject]@{showChatTitles=$false}}
$merged = Merge-AppModeConfig $defaults $existing
Assert ($merged.window.width -eq 850 -and $merged.window.height -eq 900 -and -not $merged.restoreLastUrl -and -not $merged.privacy.showChatTitles -and $merged.custom -eq 'preserve') 'Configuration merge overwrote existing settings.'

$recentPath = Join-Path $Scratch 'logs\recent-chats.json'
$items = @([pscustomobject]@{url='https://chatgpt.com/c/synthetic-one';title='Synthetic fixture';savedAt=[DateTimeOffset]::UtcNow.ToString('o')})
Write-AppModeJson -Path $recentPath -Value $items
Assert ((Get-Content -LiteralPath $recentPath -Raw).TrimStart().StartsWith('[')) 'Singleton history is not an array.'
Write-AppModeJson -Path $recentPath -Value @($items + [pscustomobject]@{url='https://chatgpt.com/c/synthetic-expired';title='Synthetic';savedAt=[DateTimeOffset]::UtcNow.AddDays(-30).ToString('o')})
$filtered = @(Get-AppModeRecentChats -AppRoot $Scratch -Config $config)
Assert ($filtered.Count -eq 1 -and -not $filtered[0].title) 'History privacy or retention policy failed.'
$config.privacy.trackRecentChats = $false
Assert (@(Get-AppModeRecentChats -AppRoot $Scratch -Config $config).Count -eq 0) 'History disabled but returned entries.'
$startupTest = Join-Path $Scratch 'synthetic-startup'
New-Item -ItemType Directory -Path $startupTest | Out-Null
Set-AppModeStartup -AppRoot $Scratch -Enabled $true -StartupDirectory $startupTest
$startupPath = Join-Path $startupTest 'ChatGPT App Mode.lnk'
Assert (Test-Path -LiteralPath $startupPath) 'Startup shortcut not created.'
$shell = New-Object -ComObject WScript.Shell
Assert ($shell.CreateShortcut($startupPath).Arguments.Contains((Join-Path $Scratch 'Start-ChatGPT-TrayLauncher.ps1'))) 'Startup shortcut targets the wrong installation.'
Set-AppModeStartup -AppRoot (Join-Path $Scratch 'other-install') -Enabled $false -StartupDirectory $startupTest
Assert (Test-Path -LiteralPath $startupPath) 'Disabling startup removed another installation entry.'
Set-AppModeStartup -AppRoot $Scratch -Enabled $false -StartupDirectory $startupTest
Assert (-not (Test-Path -LiteralPath $startupPath)) 'Startup shortcut not removed.'

# Compile and reflect without invoking Main (which would modify taskbar state).
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$refs = "${env:ProgramFiles(x86)}\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8"
$launcherDir = Join-Path $Scratch 'TaskbarLauncher'
New-Item -ItemType Directory -Force -Path $launcherDir | Out-Null
$exe = Join-Path $launcherDir 'launcher.exe'
& $compiler /nologo /target:winexe /platform:x64 "/out:$exe" "/reference:$refs\PresentationFramework.dll" "/reference:$refs\PresentationCore.dll" "/reference:$refs\WindowsBase.dll" "/reference:$refs\System.Xaml.dll" (Join-Path $root 'TaskbarLauncher\Program.cs')
Assert ($LASTEXITCODE -eq 0) 'Taskbar build failed.'
$assembly = [Reflection.Assembly]::LoadFile($exe)
$program = $assembly.GetType('ChatGPTTaskbarLauncher.Program')
$flags = [Reflection.BindingFlags]'Static,NonPublic,Public'
$quote = $program.GetMethod('QuoteNativeArgument', $flags)
$argumentProbe = Join-Path $Scratch 'argument probe.ps1'
'param([string]$Url); [Console]::Write($Url)' | Set-Content -LiteralPath $argumentProbe
foreach ($url in @('https://chatgpt.com/c/synthetic-one', 'synthetic "quoted" value', 'C:\Synthetic folder\')) {
    $native = $quote.Invoke($null, [object[]]@([string]$url))
    $scriptArgument = $quote.Invoke($null, [object[]]@([string]$argumentProbe))
    $start = [Diagnostics.ProcessStartInfo]::new('powershell.exe', "-NoProfile -File $scriptArgument -Url $native")
    $start.UseShellExecute=$false; $start.CreateNoWindow=$true; $start.RedirectStandardOutput=$true
    $process = [Diagnostics.Process]::Start($start)
    $actual=$process.StandardOutput.ReadToEnd(); $process.WaitForExit()
    Assert ($actual -ceq $url) 'Native argument round trip failed.'
    $process.Dispose()
}
$config.privacy.trackRecentChats = $true
Write-AppModeJson -Path (Join-Path $Scratch 'config.json') -Value $config
# Simulate the legacy singleton on disk and verify the C# reader migrates it.
Write-AppModeJson -Path $recentPath -Value $items[0]
$reader = $program.GetMethod('ReadRecentChats', $flags)
$read = $reader.Invoke($null, [object[]]@([string]$Scratch))
Assert ($read.Count -eq 1 -and -not $read[0].title) 'Taskbar singleton migration/title privacy failed.'
$config.privacy.trackRecentChats = $false
Write-AppModeJson -Path (Join-Path $Scratch 'config.json') -Value $config
Assert ($reader.Invoke($null, [object[]]@([string]$Scratch)).Count -eq 0) 'Taskbar ignored disabled history.'

# Exercise installer configuration in a disposable copy, never the active install.
$install = Join-Path $Scratch 'install'
New-Item -ItemType Directory -Force -Path (Join-Path $install 'tools'), (Join-Path $install 'Browser\ChromiumPortable') | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'Install-ChatGPT-AppMode.ps1') -Destination $install
Copy-Item -Path (Join-Path $root 'tools\*.ps1') -Destination (Join-Path $install 'tools')
Set-Content -LiteralPath (Join-Path $install 'Browser\ChromiumPortable\ChromiumPortable.exe') -Value 'Synthetic executable placeholder; never executed.'
$installConfig = Join-Path $install 'config.json'
$customExtension = Join-Path $Scratch 'custom-extension'
Write-AppModeJson -Path $installConfig -Value ([pscustomobject]@{url='https://chatgpt.com/';restoreLastUrl=$false;extensionDir=$customExtension;window=[pscustomobject]@{width=875};custom='preserve'})
& (Join-Path $install 'Install-ChatGPT-AppMode.ps1') -ConfigureOnly
$installed = Get-Content -LiteralPath $installConfig -Raw | ConvertFrom-Json
Assert ($installed.window.width -eq 875 -and $installed.window.height -eq 900 -and -not $installed.restoreLastUrl -and $installed.custom -eq 'preserve') 'Installer overwrote preferences.'
Assert ($installed.appProfileDir -eq '' -and $installed.chromiumDirectExe -eq '') 'Installer switched a legacy install to a fresh profile.'
Assert ($installed.extensionDir -eq $customExtension) 'Installer rebased a custom external extension path.'
Assert (Test-Path -LiteralPath (Join-Path $install 'logs\config-backup.json')) 'Installer did not back up config.'

# Deterministic window ownership/state checks. Native calls are replaced in this
# test process only; no active desktop window can be resized or pinned by tests.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
public static class AppModeNative {
    public static long Foreground = 100101;
    public static long Pointer = 100101;
    public static bool ButtonsDown = false;
    public static HashSet<long> Boundary = new HashSet<long>();
    public static HashSet<long> Interacting = new HashSet<long>();
    public static bool MouseButtonsDown() { return ButtonsDown; }
    public static bool IsPointerInBoundaryBand(IntPtr hwnd) { return Boundary.Contains(hwnd.ToInt64()); }
    public static bool HasMouseInteraction(IntPtr hwnd) { return Interacting.Contains(hwnd.ToInt64()); }
    public static Dictionary<long, double> Opacity = new Dictionary<long, double>();
    public static IntPtr GetPointerWindow() { return new IntPtr(Pointer); }
    public static bool WindowMatchesProcess(IntPtr hwnd, int pid) { return hwnd.ToInt64() / 100 == pid; }
    public static bool SetOpacity(IntPtr hwnd, double percent) { Opacity[hwnd.ToInt64()] = percent; return true; }
    public static int GetOpacityAlpha(IntPtr hwnd) { return Opacity.ContainsKey(hwnd.ToInt64()) ? (int)Math.Round(Opacity[hwnd.ToInt64()] * 2.55) : 255; }
    public static bool RestoreOpacity(IntPtr hwnd) { Opacity[hwnd.ToInt64()] = 100; return true; }
    private static HashSet<long> pinned = new HashSet<long>();
    public static IntPtr GetForegroundWindow() { return new IntPtr(Foreground); }
    public static bool IsTopMost(IntPtr hwnd) { return pinned.Contains(hwnd.ToInt64()); }
    public static bool SetTopMost(IntPtr hwnd, bool enabled) {
        if (enabled) pinned.Add(hwnd.ToInt64()); else pinned.Remove(hwnd.ToInt64());
        return true;
    }
}
public static class ChatGptAppModeWindowIdentity {
    public static IntPtr[] GetVisibleTopLevelWindowsForProcessId(int pid) {
        return new [] { new IntPtr(pid * 100 + 1), new IntPtr(pid * 100 + 2) };
    }
}
'@
$script:syntheticProcesses = @(
    [pscustomobject]@{Name='chrome.exe';ProcessId=1001;ExecutablePath=(Join-Path $config.chromiumPortableRoot 'App\chrome.exe');CommandLine=('--user-data-dir="' + $config.appProfileDir + '" --app=https://chatgpt.com/')},
    [pscustomobject]@{Name='chrome.exe';ProcessId=1002;ExecutablePath=(Join-Path $config.chromiumPortableRoot 'App\chrome.exe');CommandLine='--user-data-dir="C:\SyntheticOtherProfile"'},
    [pscustomobject]@{Name='chrome.exe';ProcessId=1003;ExecutablePath=($config.chromiumPortableRoot + '-other\chrome.exe');CommandLine=('--user-data-dir="' + $config.appProfileDir + '"')},
    [pscustomobject]@{Name='chrome.exe';ProcessId=1004;ExecutablePath=(Join-Path $config.chromiumPortableRoot 'App\chrome.exe');CommandLine=('--user-data-dir="' + $config.appProfileDir + '" --type=renderer')}
)
function Get-CimInstance { return $script:syntheticProcesses }
$owned = @(Get-AppModeOwnedWindows $config)
Assert ($owned.Count -eq 2 -and $owned[0].processId -eq 1001 -and $owned[1].processId -eq 1001) 'Ownership accepted another profile, executable boundary, or renderer.'
Assert (-not (Get-AppModeTargetWindow -Config $config -Handle 100101 -ProcessId 7777)) 'Stale PID was accepted.'
$serverAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'Start-ChatGPT-TopMostServer.ps1'), [ref]$null, [ref]$null)
$serverAst.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]}, $false) | ForEach-Object { . ([scriptblock]::Create($_.Extent.Text)) }
$ConfigPath = Join-Path $Scratch 'config.json'
function Update-SessionRetention { }
function Write-ServerLog { }
function Read-HttpRequest { return $script:syntheticRequest }
function Send-HttpJson { param($Client, [string]$Json, [int]$StatusCode=200, [string]$Origin); $script:capturedResponse=[pscustomobject]@{status=$StatusCode;body=($Json | ConvertFrom-Json)} }
$client = New-Object psobject
$client | Add-Member -MemberType ScriptMethod -Name Close -Value { }
function Invoke-SyntheticPin([string]$Action, [long]$Handle=0, [int]$OwnerId=0) {
    $script:syntheticRequest = [pscustomobject]@{forbidden=$false;method='POST';path='/topmost';headers=@{origin='https://chatgpt.com';'content-type'='text/plain'};body="action=$Action&handle=$Handle&processId=$OwnerId"}
    Handle-Request $client
    return $script:capturedResponse
}
Assert ((Invoke-SyntheticPin 'on').body.enabled) 'Foreground app window was not pinned.'
Assert (-not (Invoke-SyntheticPin 'status' 100102 1001).body.enabled) 'Pin state leaked between windows.'
[AppModeNative]::Foreground = 100102
Assert ((Invoke-SyntheticPin 'off' 100101 1001).status -eq 409) 'Background mutation changed another window.'
Assert ((Invoke-SyntheticPin 'on').body.enabled) 'Second window was not pinned.'
[AppModeNative]::Foreground = 100101
Assert (-not (Invoke-SyntheticPin 'off' 100101 1001).body.enabled) 'First window could not be unpinned.'
Assert ((Invoke-SyntheticPin 'status' 100102 1001).body.enabled) 'Unpinning the first window affected the second.'
Assert ((Invoke-SyntheticPin 'toggle' 123456 1001).status -eq 409) 'Unknown HWND accepted.'
Assert ((Invoke-SyntheticPin 'toggle' 100101 9999).status -eq 409) 'Recycled HWND/PID accepted.'
[AppModeNative]::Foreground = 999999
Assert ((Invoke-SyntheticPin 'on').status -eq 409) 'An unrelated foreground window was pinned.'
Assert ((Invoke-SyntheticPin 'activity').status -eq 409) 'Unbound activity adopted a foreground window.'
Assert ((Invoke-SyntheticPin 'activity' 100102 7777).status -eq 409) 'Activity accepted a recycled HWND/PID.'
Assert ((Invoke-SyntheticPin 'activity' 100102 1001).status -eq 409) 'An unrelated background page held a window open.'
[AppModeNative]::Pointer = 100102
Assert ((Invoke-SyntheticPin 'activity' 100102 1001).body.accepted) 'Hovered inactive-window scroll activity was rejected.'
Assert ([AppModeNative]::Foreground -eq 999999) 'Scroll activity took focus.'
Assert ([AppModeNative]::IsTopMost([IntPtr]100102)) 'Scroll activity changed pin state.'
Assert ((Invoke-SyntheticPin 'activity' 100101 1001).status -eq 409) 'Activity was accepted for an unpinned window.'
$script:appModeInteractionUntil.Clear()
[AppModeNative]::Pointer = 100101

$config | Add-Member -NotePropertyName pinnedWindow -NotePropertyValue ([pscustomobject]@{fadeWhenInactive=$true;inactiveOpacityPercent=30}) -Force
# Only the second window remains pinned from the tests above.
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 0
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 150
Assert ([AppModeNative]::Opacity[100102] -eq 100) 'Brief pointer exits should not dim the window.'
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 330
Assert ([Math]::Abs([AppModeNative]::Opacity[100102] - 65) -lt 0.01) 'Fade midpoint should be eased, not an immediate jump.'
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 480
Assert ([AppModeNative]::Opacity[100102] -eq 30 -and [AppModeNative]::Opacity[100101] -eq 100) 'Only inactive pinned windows should fade.'
[AppModeNative]::Foreground = 100102
[AppModeNative]::Pointer = 100102
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 500
Assert ([AppModeNative]::Opacity[100102] -eq 30) 'Reveal should start at the current opacity.'
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 570
Assert ([Math]::Abs([AppModeNative]::Opacity[100102] - 65) -lt 0.01) 'Reveal midpoint was not smooth.'
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 640
Assert ([AppModeNative]::Opacity[100102] -eq 100) 'Refocused pinned window did not restore opacity.'
[AppModeNative]::Pointer = 999999
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 700
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 1180
Assert ([AppModeNative]::Opacity[100102] -eq 30) 'Mouse over another window did not fade the pinned window.'
$config.pinnedWindow.inactiveOpacityPercent=55
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 1200
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 1500
Assert ([AppModeNative]::Opacity[100102] -eq 55) 'Configured opacity was ignored.'
$config.pinnedWindow.fadeWhenInactive=$false
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 1510
Assert ([AppModeNative]::Opacity[100102] -eq 100) 'Disabling fade did not restore full opacity.'
$config.pinnedWindow.fadeWhenInactive=$true
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 1600
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 1930
$midFade = [AppModeNative]::Opacity[100102]
[AppModeNative]::Pointer = 100102
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 1930
Assert ([AppModeNative]::Opacity[100102] -eq $midFade) 'Reversing mid-fade introduced an opacity jump.'
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 2070
Assert ([AppModeNative]::Opacity[100102] -eq 100) 'Reversed fade did not settle at full opacity.'
Assert ($script:appModeOpacityTransitions.Count -eq 1) 'Unpinned windows retained transition state.'
[AppModeNative]::Foreground = 999999
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 2080
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 2220
Assert ([AppModeNative]::Opacity[100102] -eq 100 -and [AppModeNative]::Foreground -eq 999999) 'Hover should reveal without taking focus.'
[void][AppModeNative]::Boundary.Add(100102)
[AppModeNative]::Pointer = 999999
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 2230
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 3000
Assert ([AppModeNative]::Opacity[100102] -eq 100) 'Boundary tolerance did not retain hover.'
[AppModeNative]::Boundary.Clear()
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 3010
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 3490
Assert ([AppModeNative]::Opacity[100102] -eq 55) 'Leaving the boundary did not fade.'
[void][AppModeNative]::Boundary.Add(100102)
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 3495
Assert ([AppModeNative]::Opacity[100102] -eq 55) 'Boundary band revealed a window that was not hovered.'
[AppModeNative]::Boundary.Clear()
[AppModeNative]::Pointer = 100102
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 3500
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 3640
[AppModeNative]::ButtonsDown = $true
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 3650
[AppModeNative]::Pointer = 999999
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 3660
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 4200
Assert ([AppModeNative]::Opacity[100102] -eq 100) 'Dragging/selecting outside the window should retain opacity.'
[AppModeNative]::ButtonsDown = $false
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 4210
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 4690
Assert ([AppModeNative]::Opacity[100102] -eq 55) 'Releasing a gesture did not resume fading.'
[AppModeNative]::ButtonsDown = $true
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 4700
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 5200
Assert ([AppModeNative]::Opacity[100102] -eq 55) 'An unrelated mouse press revealed the window.'
[AppModeNative]::ButtonsDown = $false
[void][AppModeNative]::Interacting.Add(100102)
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 5210
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 5350
Assert ([AppModeNative]::Opacity[100102] -eq 100) 'Native capture or move/resize did not hold opacity.'
[AppModeNative]::Interacting.Clear()
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 5360
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 5840
$script:appModeInteractionUntil['1001:100102'] = 6500
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 5850
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 5990
Assert ([AppModeNative]::Opacity[100102] -eq 100) 'Scroll hold expired before the scroll ended.'
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 6500
Update-AppModePinnedOpacity -Config $config -Windows $owned -NowMs 6980
Assert ([AppModeNative]::Opacity[100102] -eq 55) 'Scroll hold did not expire automatically.'
Assert ($script:appModeInteractionUntil.Count -eq 0) 'Expired interaction state was retained.'
Update-AppModePinnedOpacity -Config $config -Windows $owned -Restore
Assert ($script:appModeOpacityTransitions.Count -eq 0) 'Shutdown retained transition state.'
Assert ([AppModeNative]::Opacity[100102] -eq 100) 'Shutdown cleanup did not restore opacity.'
[AppModeNative]::Opacity.Remove(123456) | Out-Null
Update-AppModePinnedOpacity -Config $config -Windows @([pscustomobject]@{handle=123456;processId=1001})
Assert (-not [AppModeNative]::Opacity.ContainsKey(123456)) 'Opacity touched a recycled HWND with a different PID.'
[AppModeNative]::Foreground=100102
Assert (-not (Invoke-SyntheticPin 'off' 100102 1001).body.enabled) 'Unpin failed.'
Assert ([AppModeNative]::Opacity[100102] -eq 100) 'Unpin did not immediately restore full opacity.'

Write-Output 'PASS: reset guards, native arguments, settings/startup, history/privacy, atomic JSON, taskbar migration, monitor bounds, per-window pinning and inactive/hover opacity.'
