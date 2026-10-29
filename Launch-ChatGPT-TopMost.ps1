param([int]$Width=720, [int]$Height=900, [int]$X=80, [int]$Y=80)
$ErrorActionPreference = 'Stop'
$AppRoot = $PSScriptRoot
. (Join-Path $AppRoot 'tools\ChatGPT-AppMode.Helpers.ps1')
$config = Get-Content -LiteralPath (Join-Path $AppRoot 'config.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path (Join-Path $AppRoot 'logs') | Out-Null
Ensure-TopMostServerRunning -AppRoot $AppRoot
$target = Get-AppModeTargetWindow $config -AllowBackground
if (-not $target) {
    # Create a dedicated window rather than resizing an arbitrary browser or review profile.
    $before = @(Get-AppModeOwnedWindows $config | ForEach-Object { $_.handle })
    $launchConfig = $config | ConvertTo-Json -Depth 20 | ConvertFrom-Json
    $launchConfig | Add-Member -NotePropertyName restoreLastUrl -NotePropertyValue $false -Force
    $launchConfig | Add-Member -NotePropertyName rememberWindowPlacement -NotePropertyValue $false -Force
    $launchConfig | Add-Member -NotePropertyName window -NotePropertyValue ([pscustomobject]@{width=$Width;height=$Height;startMaximized=$false}) -Force
    if (-not (Start-AppModeNativeHost -Config $launchConfig -AppRoot $AppRoot)) { throw 'Native window host is unavailable.' }
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not $target -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 300
        $target = Get-AppModeOwnedWindows $config | Where-Object { $_.handle -notin $before } | Select-Object -First 1
    }
}
if (-not $target) { throw 'No App Mode window was found.' }
Initialize-AppModeNativeApi
Add-Type -AssemblyName System.Windows.Forms
$area = [Windows.Forms.Screen]::FromHandle([IntPtr]$target.handle).WorkingArea
$bounds = Get-SafeWindowBounds -Bounds ([pscustomobject]@{x=$X;y=$Y;width=$Width;height=$Height}) -WorkingArea $area
[AppModeNative]::Resize([IntPtr]$target.handle, $bounds.x, $bounds.y, $bounds.width, $bounds.height)
if (-not [AppModeNative]::SetTopMost([IntPtr]$target.handle, $true)) { throw 'Could not pin this App Mode window.' }
Set-AppModeWindowIdentity -Config $config -IconPath (Join-Path $AppRoot 'assets\OpenAI-white.ico') -TimeoutSeconds 1
