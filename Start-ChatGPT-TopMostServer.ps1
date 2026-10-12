$ErrorActionPreference = 'Stop'

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $AppRoot 'config.json'
$HelperPath = Join-Path $AppRoot 'tools\ChatGPT-AppMode.Helpers.ps1'
$LogDir = Join-Path $AppRoot 'logs'
$LogPath = Join-Path $LogDir 'topmost-server.log'
$StatePath = Join-Path $LogDir 'topmost-state.json'
$LastSessionPath = Join-Path $LogDir 'last-session.json'
$RecentChatsPath = Join-Path $LogDir 'recent-chats.json'
$Port = 17863

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
. $HelperPath

function Write-ServerLog {
    param([string]$Message)

    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    "[$stamp] $Message" | Add-Content -Path $LogPath -Encoding UTF8
}

$typeDefinition = @'
using System;
using System.Runtime.InteropServices;

public static class ChatGptTopMostControl
{
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    private const UInt32 SWP_NOSIZE = 0x0001;
    private const UInt32 SWP_NOMOVE = 0x0002;
    private const UInt32 SWP_NOACTIVATE = 0x0010;
    private const UInt32 SWP_SHOWWINDOW = 0x0040;

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, UInt32 uFlags);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    public static bool SetTopMost(IntPtr hWnd, bool enabled)
    {
        IntPtr insertAfter = enabled ? HWND_TOPMOST : HWND_NOTOPMOST;
        return SetWindowPos(hWnd, insertAfter, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'ChatGptTopMostControl').Type) {
    Add-Type -TypeDefinition $typeDefinition
}

function Get-State {
    if (Test-Path $StatePath) {
        try {
            $state = Get-Content -Path $StatePath -Raw | ConvertFrom-Json
            return $state
        }
        catch {
        }
    }

    return [pscustomobject]@{
        enabled = $false
        handles = @()
    }
}

function Set-State {
    param(
        [bool]$Enabled,
        [long[]]$Handles = @()
    )

    @{ enabled = $Enabled; handles = $Handles } | ConvertTo-Json | Set-Content -Path $StatePath -Encoding UTF8
}

function Set-AppWindowsTopMost {
    param(
        [bool]$Enabled,
        [long[]]$KnownHandles = @(),
        [bool]$IncludeForeground = $false
    )

    $config = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
    $chromiumRoot = [string]$config.chromiumPortableRoot
    $windows = @(Get-ChromiumPortableWindow -ChromiumRoot $chromiumRoot)
    $handles = New-Object System.Collections.Generic.List[long]

    foreach ($window in $windows) {
        $handleValue = [Int64]$window.MainWindowHandle
        if ($handleValue -ne 0 -and -not $handles.Contains($handleValue)) {
            $handles.Add($handleValue)
        }
    }

    foreach ($knownHandle in $KnownHandles) {
        if ($knownHandle -ne 0 -and -not $handles.Contains($knownHandle)) {
            $handles.Add($knownHandle)
        }
    }

    if ($IncludeForeground) {
        $foreground = [ChatGptTopMostControl]::GetForegroundWindow()
        $foregroundValue = $foreground.ToInt64()
        if ($foregroundValue -ne 0 -and -not $handles.Contains($foregroundValue)) {
            $handles.Add($foregroundValue)
        }
    }

    $applied = New-Object System.Collections.Generic.List[long]

    foreach ($handleValue in $handles) {
        $handle = [IntPtr]$handleValue
        if ([ChatGptTopMostControl]::IsWindow($handle)) {
            [ChatGptTopMostControl]::SetTopMost($handle, $Enabled) | Out-Null
            $applied.Add($handleValue)
        }
    }

    Write-ServerLog "Set topmost=$Enabled for $($applied.Count) window(s). Handles=$($applied -join ',')."
    return $applied.ToArray()
}

function Send-HttpJson {
    param(
        [Parameter(Mandatory)]$Client,
        [Parameter(Mandatory)][string]$Json,
        [int]$StatusCode = 200
    )

    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
    $statusText = if ($StatusCode -eq 200) { 'OK' } else { 'Error' }
    $headers = @(
        "HTTP/1.1 $StatusCode $statusText",
        'Content-Type: application/json; charset=utf-8',
        "Content-Length: $($bodyBytes.Length)",
        'Access-Control-Allow-Origin: *',
        'Access-Control-Allow-Methods: POST, OPTIONS',
        'Access-Control-Allow-Headers: Content-Type',
        'Access-Control-Allow-Private-Network: true',
        'Connection: close',
        '',
        ''
    ) -join "`r`n"

    $stream = $Client.GetStream()
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    $stream.Write($bodyBytes, 0, $bodyBytes.Length)
    $stream.Flush()
}

function Test-ChatGptUrl {
    param([Parameter(Mandatory)][string]$Url)

    try {
        $uri = [System.Uri]$Url
    }
    catch {
        return $false
    }

    if ($uri.Scheme -ne 'https' -or ($uri.Host -ne 'chatgpt.com' -and $uri.Host -ne 'chat.openai.com')) {
        return $false
    }

    $path = $uri.AbsolutePath
    return (
        $path -eq '/' -or
        $path -match '^/c/[A-Za-z0-9-]+/?$' -or
        $path -match '^/g/[^/]+/?$' -or
        $path -match '^/g/[^/]+/c/[A-Za-z0-9-]+/?$'
    )
}

function Test-ChatSessionUrl {
    param([Parameter(Mandatory)][string]$Url)

    return $Url -match '^https://(chatgpt\.com|chat\.openai\.com)/(g/[^/]+/)?c/[A-Za-z0-9-]+'
}

function Get-CleanChatTitle {
    param([string]$Title)

    if ([string]::IsNullOrWhiteSpace($Title)) {
        return $null
    }

    $clean = $Title -replace '\s*[-|]\s*ChatGPT\s*$', ''
    $clean = $clean.Trim()

    if ([string]::IsNullOrWhiteSpace($clean) -or $clean -eq 'ChatGPT') {
        return $null
    }

    if ($clean.Length -gt 60) {
        $clean = $clean.Substring(0, 57) + '...'
    }

    return $clean
}

function Update-TaskbarJumpList {
    $launcherPath = Join-Path $AppRoot 'TaskbarLauncher\ChatGPTTaskbarLauncher.exe'

    if (-not (Test-Path $launcherPath)) {
        return
    }

    try {
        Start-Process -FilePath $launcherPath -ArgumentList '--register-only' -WindowStyle Hidden
    }
    catch {
        Write-ServerLog "Could not refresh taskbar jump list: $($_.Exception.Message)"
    }
}

function Save-RecentChatUrl {
    param(
        [Parameter(Mandatory)][string]$Url,
        [string]$Title
    )

    if (-not (Test-ChatSessionUrl -Url $Url)) {
        return $false
    }

    $existing = @()
    if (Test-Path $RecentChatsPath) {
        try {
            $existing = @(Get-Content -Path $RecentChatsPath -Raw | ConvertFrom-Json)
        }
        catch {
            $existing = @()
        }
    }

    $now = (Get-Date).ToString('o')
    $cleanTitle = Get-CleanChatTitle -Title $Title
    $matchingExisting = $existing | Where-Object { $_.url -and [string]$_.url -eq $Url } | Select-Object -First 1

    if (-not $cleanTitle -and $matchingExisting -and $matchingExisting.title) {
        $cleanTitle = [string]$matchingExisting.title
    }

    $items = New-Object System.Collections.Generic.List[object]

    $items.Add([pscustomobject]@{
        url = $Url
        title = $cleanTitle
        savedAt = $now
    })

    foreach ($item in $existing) {
        if (-not $item.url -or [string]$item.url -eq $Url) {
            continue
        }

        $items.Add([pscustomobject]@{
            url = [string]$item.url
            title = if ($item.title) { [string]$item.title } else { $null }
            savedAt = if ($item.savedAt) { [string]$item.savedAt } else { $now }
        })

        if ($items.Count -ge 3) {
            break
        }
    }

    $items.ToArray() | ConvertTo-Json -Depth 4 | Set-Content -Path $RecentChatsPath -Encoding UTF8
    Update-TaskbarJumpList

    Write-ServerLog "Saved recent chat URL: $Url"
    return $true
}

function Save-LastSessionUrl {
    param(
        [Parameter(Mandatory)][string]$Url,
        [string]$Title
    )

    if (-not (Test-ChatGptUrl -Url $Url)) {
        return $false
    }

    @{
        url = $Url
        savedAt = (Get-Date).ToString('o')
    } | ConvertTo-Json | Set-Content -Path $LastSessionPath -Encoding UTF8

    Save-RecentChatUrl -Url $Url -Title $Title | Out-Null

    Write-ServerLog "Saved last session URL: $Url"
    return $true
}

function Read-HttpRequest {
    param([Parameter(Mandatory)]$Client)

    $stream = $Client.GetStream()
    $buffer = New-Object byte[] 8192
    $bytes = New-Object System.Collections.Generic.List[byte]
    $headerText = ''

    do {
        $read = $stream.Read($buffer, 0, $buffer.Length)
        if ($read -le 0) {
            break
        }

        for ($i = 0; $i -lt $read; $i++) {
            $bytes.Add($buffer[$i])
        }

        $headerText = [System.Text.Encoding]::UTF8.GetString($bytes.ToArray())
    } while ($headerText.IndexOf("`r`n`r`n") -lt 0)

    $headerEnd = $headerText.IndexOf("`r`n`r`n")
    if ($headerEnd -lt 0) {
        return $headerText
    }

    $headersOnly = $headerText.Substring(0, $headerEnd)
    $contentLength = 0

    foreach ($line in ($headersOnly -split "`r?`n")) {
        if ($line -match '^Content-Length:\s*(\d+)\s*$') {
            $contentLength = [int]$Matches[1]
            break
        }
    }

    $bodyStart = $headerEnd + 4
    $currentBodyLength = $bytes.Count - $bodyStart

    while ($currentBodyLength -lt $contentLength) {
        $read = $stream.Read($buffer, 0, [Math]::Min($buffer.Length, $contentLength - $currentBodyLength))
        if ($read -le 0) {
            break
        }

        for ($i = 0; $i -lt $read; $i++) {
            $bytes.Add($buffer[$i])
        }

        $currentBodyLength = $bytes.Count - $bodyStart
    }

    return [System.Text.Encoding]::UTF8.GetString($bytes.ToArray())
}

function Handle-Request {
    param([Parameter(Mandatory)]$Client)

    try {
        $request = Read-HttpRequest -Client $Client
        $firstLine = (($request -split "`r?`n") | Select-Object -First 1)

        if ($firstLine -match '^OPTIONS\s+') {
            Send-HttpJson -Client $Client -Json '{}' -StatusCode 200
            return
        }

        if ($firstLine -notmatch '^POST\s+/(topmost|session)\s+') {
            Send-HttpJson -Client $Client -Json '{"error":"not_found"}' -StatusCode 404
            return
        }

        $path = $Matches[1]

        $body = ''
        $bodyIndex = $request.IndexOf("`r`n`r`n")
        if ($bodyIndex -ge 0) {
            $body = $request.Substring($bodyIndex + 4)
        }

        if ($path -eq 'session') {
            $saved = $false
            if ($body -match '(^|&)url=([^&]+)') {
                $url = [System.Uri]::UnescapeDataString($Matches[2])
                $title = $null
                if ($body -match '(^|&)title=([^&]*)') {
                    $title = [System.Uri]::UnescapeDataString($Matches[2])
                }

                $saved = Save-LastSessionUrl -Url $url -Title $title
            }

            $json = @{ saved = $saved } | ConvertTo-Json -Compress
            Send-HttpJson -Client $Client -Json $json
            return
        }

        $action = 'toggle'
        if (-not [string]::IsNullOrWhiteSpace($body)) {
            if ($body -match '(^|&)action=([^&]+)') {
                $action = [System.Uri]::UnescapeDataString($Matches[2])
            } else {
                try {
                $payload = $body | ConvertFrom-Json
                if ($payload.action) {
                    $action = [string]$payload.action
                }
                }
                catch {
                    $action = 'toggle'
                }
            }
        }

        $state = Get-State
        $enabled = [bool]$state.enabled
        $knownHandles = @($state.handles | ForEach-Object { [Int64]$_ })
        $appliedHandles = @()

        if ($action -eq 'toggle') {
            $enabled = -not $enabled
            $appliedHandles = @(Set-AppWindowsTopMost -Enabled $enabled -KnownHandles $knownHandles -IncludeForeground $enabled)
            Set-State -Enabled $enabled -Handles $appliedHandles
        } elseif ($action -eq 'status') {
            if ($enabled) {
                $appliedHandles = @(Set-AppWindowsTopMost -Enabled $true -KnownHandles $knownHandles)
            }
        } elseif ($action -eq 'on') {
            $enabled = $true
            $appliedHandles = @(Set-AppWindowsTopMost -Enabled $enabled -KnownHandles $knownHandles -IncludeForeground $true)
            Set-State -Enabled $enabled -Handles $appliedHandles
        } elseif ($action -eq 'off') {
            $enabled = $false
            $appliedHandles = @(Set-AppWindowsTopMost -Enabled $enabled -KnownHandles $knownHandles)
            Set-State -Enabled $enabled -Handles @()
        }

        Write-ServerLog "Request action=$action enabled=$enabled windows=$($appliedHandles.Count)."
        $json = @{ enabled = $enabled; windows = $appliedHandles.Count } | ConvertTo-Json -Compress
        Send-HttpJson -Client $Client -Json $json
    }
    catch {
        Write-ServerLog "ERROR: $($_.Exception.Message)"
        Send-HttpJson -Client $Client -Json '{"error":"server_error"}' -StatusCode 500
    }
    finally {
        $Client.Close()
    }
}

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\ChatGPTAppModeTopMostServer', [ref]$createdNew)
if (-not $createdNew) {
    return
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), $Port)
$listener.Start()
Write-ServerLog "Topmost control server listening on 127.0.0.1:$Port."

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        Handle-Request -Client $client
    }
}
finally {
    $listener.Stop()
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
