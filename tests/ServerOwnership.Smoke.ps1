param([Parameter(Mandatory)][string]$Scratch)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\tools\ChatGPT-AppMode.Helpers.ps1')
New-Item -ItemType Directory -Path $Scratch -Force | Out-Null
$scriptFile = Join-Path $Scratch 'Start-ChatGPT-TopMostServer.ps1'
Set-Content -LiteralPath $scriptFile -Value 'Start-Sleep -Seconds 30'
$shells = @((Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'), (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source) | Where-Object { $_ } | Select-Object -Unique
foreach ($shellPath in $shells) {
    # Only a task-created sleeping process beneath this disposable root. No
    # production server or unrelated process is selected or terminated.
    $child = Start-Process -FilePath $shellPath -ArgumentList @('-NoProfile', '-File', "`"$scriptFile`"") -WindowStyle Hidden -PassThru
    try {
        $null = $child.Handle
        Start-Sleep -Milliseconds 200
        $snapshot = Get-CimInstance Win32_Process -Filter ("ProcessId={0}" -f $child.Id)
        if (-not (Test-AppModeServerProcess $snapshot $Scratch)) { throw 'Real shell identity did not match its explicit synthetic script.' }
        if (-not (Stop-AppModeVerifiedServer $snapshot $Scratch)) { throw 'Real shell creation-time/handle verification failed.' }
        if (-not $child.WaitForExit(5000)) { throw 'Verified synthetic process did not exit.' }
    } finally {
        if (-not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
        $child.Dispose()
    }
}
Write-Output 'Real PowerShell shell identity/held-handle smoke checks passed.'
