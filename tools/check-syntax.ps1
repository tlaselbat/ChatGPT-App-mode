$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$files = @(git -C $root ls-files --cached --others --exclude-standard)
foreach ($relative in $files) {
    $file = Join-Path $root $relative
    if ($relative -match '\.(js|cjs)$') {
        & node --check $file
        if ($LASTEXITCODE -ne 0) { throw 'JavaScript syntax check failed.' }
    }
    if ($relative -match '\.ps1$') {
        $tokens = $null; $parseErrors = $null
        $null = [Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$parseErrors)
        if ($parseErrors.Count) { throw "PowerShell syntax check failed: $relative" }
    }
}
Write-Output 'JavaScript and PowerShell syntax checks passed.'
