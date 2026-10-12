param(
    [ValidateSet("On", "Off")]
    [string]$State = "On"
)

$ErrorActionPreference = "Stop"
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $AppRoot "config.json"
$config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
$config.enableLocalExtension = ($State -eq "On")
$config | ConvertTo-Json -Depth 10 | Set-Content -Path $ConfigPath -Encoding UTF8
Write-Host "Local extension enabled: $($config.enableLocalExtension)"
Write-Host "Close and relaunch ChatGPT App Mode."
