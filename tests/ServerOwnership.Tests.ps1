$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\tools\ChatGPT-AppMode.Helpers.ps1')
function Assert($value, $message) { if (-not $value) { throw $message } }
$installation = 'C:\Synthetic App'
$shellPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$sample = [pscustomobject]@{ ExecutablePath=$shellPath; CommandLine=''; ProcessId=424242; CreationDate=[datetime]'2026-01-01' }
foreach ($exe in @($shellPath, (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source) | Where-Object { $_ }) {
    $sample.ExecutablePath = $exe
    foreach ($prefix in @('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden', '-NonInteractive -NoProfile', '')) {
        $sample.CommandLine = '"{0}" {1} -File "{2}\Start-ChatGPT-TopMostServer.ps1"' -f $exe, $prefix, $installation
        Assert (Test-AppModeServerProcess $sample $installation) 'Supported launch rejected.'
    }
}
$sample.ExecutablePath = $shellPath
foreach ($suffix in @(
    '-Command "C:\Synthetic App\Start-ChatGPT-TopMostServer.ps1"',
    '-File "C:\Synthetic App-lookalike\Start-ChatGPT-TopMostServer.ps1"',
    '-File "C:\Synthetic App\Start-ChatGPT-TopMostServer.ps1" -File other',
    '-NoProfile -NoProfile -File "C:\Synthetic App\Start-ChatGPT-TopMostServer.ps1"',
    '-File "C:\Synthetic App\Start-ChatGPT-TopMostServer.ps1" incidental',
    '-File C:\Synthetic App\Start-ChatGPT-TopMostServer.ps1',
    '-EncodedCommand ignored', '-File "unterminated')) {
    $sample.CommandLine = '"{0}" {1}' -f $shellPath, $suffix
    Assert (-not (Test-AppModeServerProcess $sample $installation)) 'Ambiguous/unrelated launch accepted.'
}
$sample.CommandLine = '"{0}" -File C:\Synthetic\Start-ChatGPT-TopMostServer.ps1' -f $shellPath
Assert (Test-AppModeServerProcess $sample 'C:\Synthetic') 'Unquoted path rejected.'
$sample.ExecutablePath = 'C:\Unrelated\powershell.exe'
Assert (-not (Test-AppModeServerProcess $sample 'C:\Synthetic')) 'Unrelated executable accepted.'
# Every process operation is mocked. Never terminate a real process in these tests.
$script:stopped = 0
function Stop-Process { param($InputObject, [switch]$Force, $ErrorAction) $script:stopped++ }
function Get-Process { param($Id, $ErrorAction) return [pscustomobject]@{ Handle=1; HasExited=$false; StartTime=[datetime]'2026-01-01' } }
function Get-CimInstance { param($ClassName, $Filter, $ErrorAction) return $script:fresh }
$sample.ExecutablePath = $shellPath
$script:fresh = $sample.PSObject.Copy()
Assert (Stop-AppModeVerifiedServer $sample 'C:\Synthetic') 'Verified synthetic process not stopped.'
$script:fresh.CreationDate = [datetime]'2026-01-02'
Assert (-not (Stop-AppModeVerifiedServer $sample 'C:\Synthetic')) 'Reused PID stopped.'
$script:fresh = $null
Assert (-not (Stop-AppModeVerifiedServer $sample 'C:\Synthetic')) 'Exited process stopped.'
$script:fresh = $sample.PSObject.Copy(); $script:fresh.CommandLine += ' incidental'
Assert (-not (Stop-AppModeVerifiedServer $sample 'C:\Synthetic')) 'Changed process stopped.'
Assert ($script:stopped -eq 1) 'Unverified stop reached mocked termination.'
function Test-Path { return $true }
function Start-Process { throw 'Ambiguous ownership attempted to launch.' }
function Get-CimInstance { return @($sample, $sample.PSObject.Copy()) }
Ensure-TopMostServerRunning -AppRoot 'C:\Synthetic' -ForceRestart
Assert ($script:stopped -eq 1) 'Ambiguous ownership reached termination.'
Write-Output 'Server ownership synthetic checks passed.'
