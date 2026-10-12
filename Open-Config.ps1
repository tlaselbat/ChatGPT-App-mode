$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $AppRoot "config.json"
Start-Process notepad.exe $ConfigPath
