$ErrorActionPreference = 'Stop'
$AppRoot = $PSScriptRoot
. (Join-Path $AppRoot 'tools\ChatGPT-AppMode.Helpers.ps1')
$config = Get-Content -LiteralPath (Join-Path $AppRoot 'config.json') -Raw | ConvertFrom-Json
$profileDir = Assert-AppModeResetTarget -Config $config -AppRoot $AppRoot
Assert-AppModeBrowserStopped $config
if (-not (Test-Path -LiteralPath $profileDir)) { Write-Host 'No active profile folder found.'; return }
Write-Host "This deletes the active App Mode browser profile: $profileDir"
if ((Read-Host 'Type RESET to continue') -cne 'RESET') { Write-Host 'Cancelled.'; return }
# Revalidate after the prompt; never kill a running browser or delete through a junction.
$config = Get-Content -LiteralPath (Join-Path $AppRoot 'config.json') -Raw | ConvertFrom-Json
$currentTarget = Assert-AppModeResetTarget -Config $config -AppRoot $AppRoot
if ($currentTarget -ne $profileDir) { throw 'The configured profile changed. Reset cancelled.' }
Assert-AppModeBrowserStopped $config
Remove-Item -LiteralPath $profileDir -Recurse -Force
New-Item -ItemType Directory -Path $profileDir | Out-Null
Write-Host 'Profile reset complete.'
