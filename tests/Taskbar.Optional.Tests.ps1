param([Parameter(Mandatory)][string]$Scratch)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $Scratch 'TaskbarLauncher'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$source = Get-Content -LiteralPath (Join-Path $root 'TaskbarLauncher/Program.cs') -Raw
function Replace-MethodBody([string]$Text, [string]$Signature, [string]$Body) {
    $start = $Text.IndexOf('{', $Text.IndexOf($Signature))
    $depth = 1; $end = $start + 1
    while ($depth -gt 0) {
        if ($Text[$end] -eq '{') { $depth++ }
        if ($Text[$end] -eq '}') { $depth-- }
        $end++
    }
    return $Text.Substring(0, $start) + '{' + $Body + '}' + $Text.Substring($end)
}
# Compile the real dispatcher with shell/launch side effects replaced at their
# method boundaries. Each invocation runs in a fresh process/WPF Application.
$source = $source.Replace('SetCurrentProcessExplicitAppUserModelID(AppUserModelId);', '')
$source = $source.Replace('RegisterJumpList(app);', 'if (Environment.GetEnvironmentVariable("APP_MODE_TEST_REGISTER") != "success") throw new InvalidOperationException("Synthetic");')
$source = Replace-MethodBody $source 'private static void CreateShortcut()' 'File.WriteAllText(Environment.GetEnvironmentVariable("APP_MODE_TEST_RESULT"), "shortcut");'
$source = Replace-MethodBody $source 'private static void StartPowerShellScript(' 'File.WriteAllText(Environment.GetEnvironmentVariable("APP_MODE_TEST_RESULT"), Path.GetFileName(scriptPath) + "|" + scriptArguments);'
$file = Join-Path $dir 'probe.cs'; $exe = Join-Path $dir 'probe.exe'
$source | Set-Content -LiteralPath $file -Encoding UTF8
Set-Content -LiteralPath (Join-Path $Scratch 'Launch-ChatGPT-AppMode.ps1') -Value '# Synthetic'
$refs = "${env:ProgramFiles(x86)}\Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8"
& (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe') /nologo /target:exe /out:$exe "/reference:$refs\PresentationFramework.dll" "/reference:$refs\PresentationCore.dll" "/reference:$refs\WindowsBase.dll" "/reference:$refs\System.Xaml.dll" $file
if ($LASTEXITCODE -ne 0) { throw 'Taskbar probe build failed.' }
$env:APP_MODE_TEST_RESULT = Join-Path $Scratch 'result.txt'
try {
    foreach ($mode in @('success', 'unavailable', 'throws')) {
        $env:APP_MODE_TEST_REGISTER = $mode
        foreach ($command in @('--app', '--new-session', '--create-shortcut', '--register-only')) {
            $info = [Diagnostics.ProcessStartInfo]::new($exe, $command)
            $info.UseShellExecute = $false; $info.CreateNoWindow = $true; $info.RedirectStandardError = $true
            $probe = [Diagnostics.Process]::Start($info)
            $diagnostic = $probe.StandardError.ReadToEnd(); $probe.WaitForExit()
            $expectedExit = if ($command -eq '--register-only' -and $mode -ne 'success') { 1 } else { 0 }
            if ($probe.ExitCode -ne $expectedExit) { throw 'Optional registration blocked command or hid explicit failure.' }
            if ($command -ne '--register-only') {
                $expected = switch ($command) {
                    '--app' { 'Launch-ChatGPT-AppMode.ps1|' }
                    '--new-session' { 'Launch-ChatGPT-AppMode.ps1|-NewSession' }
                    '--create-shortcut' { 'shortcut' }
                }
                if ((Get-Content -LiteralPath $env:APP_MODE_TEST_RESULT -Raw) -ne $expected) { throw 'Taskbar command dispatch changed.' }
            }
        }
    }
} finally {
    Remove-Item Env:APP_MODE_TEST_REGISTER, Env:APP_MODE_TEST_RESULT -ErrorAction SilentlyContinue
}
Write-Output 'Optional taskbar registration and command dispatch passed.'
