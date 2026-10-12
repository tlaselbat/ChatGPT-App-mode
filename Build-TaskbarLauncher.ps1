$ErrorActionPreference = 'Stop'

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$ReferenceRoot = "${env:ProgramFiles(x86)}\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8"
$OutputPath = Join-Path $AppRoot 'TaskbarLauncher\ChatGPTTaskbarLauncher.exe'
$SourcePath = Join-Path $AppRoot 'TaskbarLauncher\Program.cs'
$IconPath = Join-Path $AppRoot 'assets\OpenAI-white.ico'

if (-not (Test-Path $Compiler)) {
    throw "C# compiler not found: $Compiler"
}

foreach ($path in @($ReferenceRoot, $SourcePath, $IconPath)) {
    if (-not (Test-Path $path)) {
        throw "Required path not found: $path"
    }
}

& $Compiler `
    /nologo `
    /target:winexe `
    /platform:x64 `
    /optimize+ `
    /win32icon:"$IconPath" `
    /out:"$OutputPath" `
    /reference:"$ReferenceRoot\PresentationFramework.dll" `
    /reference:"$ReferenceRoot\PresentationCore.dll" `
    /reference:"$ReferenceRoot\WindowsBase.dll" `
    /reference:"$ReferenceRoot\System.Xaml.dll" `
    "$SourcePath"

if ($LASTEXITCODE -ne 0) {
    throw "Build failed with exit code $LASTEXITCODE"
}

& $OutputPath --register-only
Write-Host "Built and registered: $OutputPath"
