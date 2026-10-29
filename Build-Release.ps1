param(
    [string]$Revision = 'HEAD',
    [string]$OutputPath = (Join-Path $PSScriptRoot 'ChatGPT-AppMode-source.zip')
)
$ErrorActionPreference = 'Stop'
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
if (Test-Path -LiteralPath $OutputPath) { throw 'Choose a new output path; release archives are never overwritten.' }
# Archive a committed tree, never local runtime, config, or profile data.
$commit = & git -C $PSScriptRoot rev-parse --verify "$Revision^{commit}"
if ($LASTEXITCODE -ne 0) { throw 'Release revision must resolve to a commit.' }
$files = @(& git -C $PSScriptRoot ls-tree -r --name-only $commit)
if ($LASTEXITCODE -ne 0 -or -not $files.Count) { throw 'Cannot enumerate release source.' }
foreach ($file in $files) {
    if ($file -match '(?i)(^|/)(Browser|logs|archive|node_modules|test-results|playwright-report|shortcuts|package_build_[^/]*)(/|$)|(^|/)config\.json$|\.(exe|dll|pdb|msi|zip|lnk|log)$|(^|/)(last-session|recent-chats)\.json$') {
        throw 'Release revision contains a prohibited runtime or private-data path.'
    }
}
& git -C $PSScriptRoot archive --format=zip "--output=$OutputPath" $commit
if ($LASTEXITCODE -ne 0) { throw 'Source archive failed.' }
Write-Output "Created source archive from commit $commit (runtime installs separately): $OutputPath"
