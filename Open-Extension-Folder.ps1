$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExtensionDir = Join-Path $AppRoot "extension"
Start-Process explorer.exe $ExtensionDir
