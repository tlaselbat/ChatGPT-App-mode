$ErrorActionPreference = 'Stop'
$AppRoot = $PSScriptRoot
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js 22.12 or newer, then run Install-WindowHost.ps1 again.'
}
Push-Location $AppRoot
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Window host dependency installation failed.' }
    # Electron 45 uses an explicit install command rather than npm postinstall.
    & node.exe (Join-Path $AppRoot 'node_modules\electron\install.js')
    if ($LASTEXITCODE -ne 0) { throw 'Window host runtime installation failed.' }
    Write-Output 'Native window host installed. Start App Mode normally.'
} finally { Pop-Location }
