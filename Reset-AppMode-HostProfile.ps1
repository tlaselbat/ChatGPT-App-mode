$ErrorActionPreference = 'Stop'
$AppRoot = $PSScriptRoot
. (Join-Path $AppRoot 'tools\ChatGPT-AppMode.Helpers.ps1')
# The native host profile is the only profile; the Electron runtime acts as the
# protected software boundary for the shared reset validators.
$profileDir = Join-Path $AppRoot 'Browser\AppModeHostProfile'
$config = [pscustomobject]@{
    appProfileDir = $profileDir
    chromiumPortableRoot = (Join-Path $AppRoot 'node_modules\electron')
}
$target = Assert-AppModeResetTarget -Config $config -AppRoot $AppRoot
Assert-AppModeBrowserStopped $config
if (-not (Test-Path -LiteralPath $target)) { Write-Host 'No App Mode host profile folder found.'; return }
Write-Host "This deletes the App Mode host profile, including its sign-in: $target"
if ((Read-Host 'Type RESET to continue') -cne 'RESET') { Write-Host 'Cancelled.'; return }
Assert-AppModeBrowserStopped $config
Remove-Item -LiteralPath $target -Recurse -Force
New-Item -ItemType Directory -Path $target | Out-Null
Write-Host 'Profile reset complete. Sign in again on the next launch.'
