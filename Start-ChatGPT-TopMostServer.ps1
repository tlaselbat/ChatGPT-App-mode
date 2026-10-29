param(
    [ValidateRange(1024, 65535)][int]$Port = 17863,
    [string]$AppRoot = $PSScriptRoot
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tools\ChatGPT-AppMode.Helpers.ps1')
. (Join-Path $PSScriptRoot 'tools\AppMode.Windows.ps1')
$ConfigPath = Join-Path $AppRoot 'config.json'
$LogDir = Join-Path $AppRoot 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogPath = Join-Path $LogDir 'topmost-server.log'
$LastSessionPath = Join-Path $LogDir 'last-session.json'
$RecentChatsPath = Join-Path $LogDir 'recent-chats.json'

function Write-ServerLog {
    param([string]$Message)
    # Do not log URLs, titles, payloads, or request headers.
    Write-AppModeLog -LogPath $LogPath -Message $Message
}

function Update-TaskbarJumpList {
    $launcher = Join-Path $AppRoot 'TaskbarLauncher\ChatGPTTaskbarLauncher.exe'
    if (Test-Path -LiteralPath $launcher) {
        Start-Process -FilePath $launcher -ArgumentList '--register-only' -WindowStyle Hidden
    }
}

function Update-SessionRetention {
    param($Config)
    $privacy = Get-AppModePrivacy $Config
    if (Test-Path -LiteralPath $LastSessionPath) {
        try {
            $session = Get-Content -LiteralPath $LastSessionPath -Raw | ConvertFrom-Json
            $stamp = [DateTimeOffset]::MinValue
            if (-not $privacy.saveLastSession -or
                -not [DateTimeOffset]::TryParse([string]$session.savedAt, [ref]$stamp) -or
                $stamp -le [DateTimeOffset]::UtcNow.AddDays(-$privacy.retentionDays)) {
                Remove-Item -LiteralPath $LastSessionPath -Force
            }
        } catch { Remove-Item -LiteralPath $LastSessionPath -Force -ErrorAction SilentlyContinue }
    }
    if (Test-Path -LiteralPath $RecentChatsPath) {
        $items = @(Get-AppModeRecentChats -AppRoot $AppRoot -Config $Config | Select-Object -First 3)
        $before = Get-Content -LiteralPath $RecentChatsPath -Raw
        $after = ConvertTo-Json -InputObject $items -Depth 4
        if ($before.Trim() -ne $after.Trim()) {
            Write-AppModeJson -Path $RecentChatsPath -Value $items
            Update-TaskbarJumpList
        }
    }
}

function Save-LastSessionUrl {
    param([string]$Url, [string]$Title, $Config)
    if (-not $Url -or -not (Test-RestorableChatGptUrl $Url)) { return $false }
    $privacy = Get-AppModePrivacy $Config
    $now = [DateTimeOffset]::UtcNow.ToString('o')
    if ($privacy.saveLastSession) { Write-AppModeJson -Path $LastSessionPath -Value @{ url = $Url; savedAt = $now } }
    if ($privacy.trackRecentChats -and ([Uri]$Url).AbsolutePath -match '/c/[A-Za-z0-9-]+/?$') {
        $cleanTitle = $null
        if ($privacy.showChatTitles -and $Title) {
            $cleanTitle = ($Title -replace '\s*[-|]\s*ChatGPT\s*$', '').Trim()
            if ($cleanTitle -eq 'ChatGPT') { $cleanTitle = $null }
            if ($cleanTitle -and $cleanTitle.Length -gt 60) { $cleanTitle = $cleanTitle.Substring(0, 57) + '...' }
        }
        $existing = @(Get-AppModeRecentChats -AppRoot $AppRoot -Config $Config)
        $old = $existing | Where-Object { $_.url -eq $Url } | Select-Object -First 1
        if (-not $cleanTitle -and $privacy.showChatTitles -and $old) { $cleanTitle = $old.title }
        $items = @([pscustomobject]@{ url = $Url; title = $cleanTitle; savedAt = $now })
        $items += @($existing | Where-Object { $_.url -ne $Url } | Select-Object -First 2)
        Write-AppModeJson -Path $RecentChatsPath -Value $items
        # Refresh shell metadata only when the list or displayed title changes.
        if (-not $existing.Count -or $existing[0].url -ne $Url -or $existing[0].title -ne $cleanTitle) { Update-TaskbarJumpList }
    }
    # A valid request with recording disabled is acknowledged so the extension doesn't retry forever.
    return $true
}

function Send-HttpJson {
    param($Client, [string]$Json, [int]$StatusCode = 200, [string]$Origin, [switch]$PrivateNetwork)
    $body = [Text.Encoding]::UTF8.GetBytes($Json)
    $headers = @("HTTP/1.1 $StatusCode Response", 'Content-Type: application/json; charset=utf-8',
        "Content-Length: $($body.Length)", 'Cache-Control: no-store', 'Connection: close')
    if ($Origin) {
        $headers += @("Access-Control-Allow-Origin: $Origin", 'Vary: Origin', 'Access-Control-Allow-Methods: POST, OPTIONS', 'Access-Control-Allow-Headers: Content-Type')
        # Retained only for an explicit PNA preflight from an allowed origin.
        if ($PrivateNetwork) { $headers += 'Access-Control-Allow-Private-Network: true' }
    }
    $stream = $Client.GetStream()
    $stream.WriteTimeout = 1500
    $bytes = [Text.Encoding]::ASCII.GetBytes(($headers -join "`r`n") + "`r`n`r`n")
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Write($body, 0, $body.Length)
}

function Read-HttpRequest {
    param($Client)
    $stream = $Client.GetStream()
    $deadline = [DateTime]::UtcNow.AddMilliseconds(2000)
    $bytes = [Collections.Generic.List[byte]]::new()
    # Read headers one byte at a time to avoid accepting unbounded or ambiguous framing.
    while ($true) {
        $remaining = [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds
        if ($remaining -le 0) { throw 'Request timeout.' }
        $stream.ReadTimeout = [Math]::Max(1, $remaining)
        $value = $stream.ReadByte()
        if ($value -lt 0) { throw 'Incomplete headers.' }
        $bytes.Add([byte]$value)
        if ($bytes.Count -gt 8192) { throw 'Headers too large.' }
        $count = $bytes.Count
        if ($count -ge 4 -and $bytes[$count-4] -eq 13 -and $bytes[$count-3] -eq 10 -and $bytes[$count-2] -eq 13 -and $bytes[$count-1] -eq 10) { break }
    }
    $lines = [Text.Encoding]::ASCII.GetString($bytes.ToArray()) -split "`r`n"
    if ($lines[0] -notmatch '^(POST|OPTIONS) (/topmost|/session) HTTP/1\.[01]$') { throw 'Unsupported request.' }
    $method = $Matches[1]; $path = $Matches[2]
    $headers = @{}
    foreach ($line in $lines[1..($lines.Length-3)]) {
        if ($line -notmatch '^([A-Za-z0-9-]+):[ \t]*(.*)$') { throw 'Malformed headers.' }
        $name = $Matches[1].ToLowerInvariant(); $value = $Matches[2].Trim()
        if ($headers.ContainsKey($name)) { throw 'Duplicate header.' }
        $headers[$name] = $value
    }
    $forbidden = $headers['host'] -ne "127.0.0.1:$Port" -or
        $headers['origin'] -cnotin @('https://chatgpt.com', 'https://chat.openai.com')
    if ($headers.ContainsKey('transfer-encoding')) { throw 'Transfer encoding is unsupported.' }
    $length = 0
    if ($headers.ContainsKey('content-length') -and
        (-not [int]::TryParse($headers['content-length'], [ref]$length) -or $length -lt 0 -or $length -gt 16384)) { throw 'Invalid content length.' }
    if ($method -eq 'POST' -and -not $headers.ContainsKey('content-length')) { throw 'Content length required.' }
    $body = New-Object byte[] $length
    $offset = 0
    while ($offset -lt $length) {
        $remaining = [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds
        if ($remaining -le 0) { throw 'Request timeout.' }
        $stream.ReadTimeout = [Math]::Max(1, $remaining)
        $read = $stream.Read($body, $offset, $length - $offset)
        if ($read -le 0) { throw 'Incomplete body.' }
        $offset += $read
    }
    [pscustomobject]@{ forbidden = $forbidden; method = $method; path = $path; headers = $headers; body = [Text.UTF8Encoding]::new($false, $true).GetString($body) }
}

function Handle-Request {
    param($Client)
    $origin = $null
    try {
        $request = Read-HttpRequest $Client
        if ($request.forbidden) {
            if ($request.path -eq '/topmost') { Write-ServerLog 'Pin diagnostic: origin or Host rejected.' }
            Send-HttpJson $Client '{"error":"forbidden"}' 403; return
        }
        $origin = $request.headers['origin']
        if ($request.method -eq 'OPTIONS') {
            $requestedHeaders = @($request.headers['access-control-request-headers'] -split ',' | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
            if ($request.headers['access-control-request-method'] -ne 'POST' -or @($requestedHeaders | Where-Object { $_ -ne 'content-type' }).Count) {
                Send-HttpJson $Client '{"error":"forbidden_preflight"}' 403 $origin
                return
            }
            Send-HttpJson -Client $Client -Json '{}' -Origin $origin -PrivateNetwork:($request.headers['access-control-request-private-network'] -eq 'true')
            return
        }
        if ($request.headers['content-type'] -notmatch '^(text/plain|application/x-www-form-urlencoded)(;|$)') {
            Send-HttpJson $Client '{"error":"unsupported_media_type"}' 415 $origin; return
        }
        $fields = @{}
        foreach ($pair in ($request.body -split '&')) {
            $parts = $pair -split '=', 2
            if ($parts.Count -ne 2 -or $fields.ContainsKey($parts[0])) { throw 'Invalid form.' }
            $fields[$parts[0]] = [Uri]::UnescapeDataString($parts[1].Replace('+', ' '))
        }
        $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
        Update-SessionRetention $config
        if ($request.path -eq '/session') {
            $saved = Save-LastSessionUrl -Url $fields['url'] -Title $fields['title'] -Config $config
            Send-HttpJson $Client (@{ saved = $saved } | ConvertTo-Json -Compress) 200 $origin
            return
        }
        $action = $fields['action']
        if ($action -notin @('status', 'toggle', 'on', 'off', 'activity')) { Send-HttpJson $Client '{"error":"invalid_action"}' 400 $origin; return }
        $handle = 0L; $ownerId = 0
        if ($fields['handle'] -and -not [long]::TryParse($fields['handle'], [ref]$handle)) { throw 'Invalid handle.' }
        if ($fields['processId'] -and -not [int]::TryParse($fields['processId'], [ref]$ownerId)) { throw 'Invalid process.' }
        # Activity must carry an existing binding; never adopt another foreground window.
        if ($action -eq 'activity' -and ($handle -le 0 -or $ownerId -le 0)) { Send-HttpJson $Client '{"error":"window_binding_required"}' 409 $origin; return }
        $target = Get-AppModeTargetWindow -Config $config -Handle $handle -ProcessId $ownerId
        if (-not $target) { Write-ServerLog 'Pin diagnostic: no matching active app window.'; Send-HttpJson $Client '{"error":"focus_app_window"}' 409 $origin; return }
        $enabled = [AppModeNative]::IsTopMost([IntPtr]$target.handle)
        if ($action -eq 'activity') {
            # Inactive-window scrolling is allowed only while the pointer is over that window.
            if (-not $enabled -or ([AppModeNative]::GetForegroundWindow().ToInt64() -ne $target.handle -and
                [AppModeNative]::GetPointerWindow().ToInt64() -ne $target.handle)) {
                Send-HttpJson $Client '{"error":"window_not_interacting"}' 409 $origin; return
            }
            $key = '{0}:{1}' -f $target.processId, $target.handle
            $script:appModeInteractionUntil[$key] = (Get-AppModeMonotonicMs) + 500
            Send-HttpJson $Client '{"accepted":true}' 200 $origin
            return
        }
        if ($action -ne 'status') {
            # A background page must never pin another foreground app window.
            if ([AppModeNative]::GetForegroundWindow().ToInt64() -ne $target.handle) { Write-ServerLog 'Pin diagnostic: target is not foreground.'; Send-HttpJson $Client '{"error":"focus_app_window"}' 409 $origin; return }
            $enabled = if ($action -eq 'toggle') { -not $enabled } else { $action -eq 'on' }
            if (-not [AppModeNative]::SetTopMost([IntPtr]$target.handle, $enabled)) { throw 'Pin operation failed.' }
            if (-not $enabled) { [AppModeNative]::RestoreOpacity([IntPtr]$target.handle) | Out-Null }
            Write-ServerLog ("Pin diagnostic: action={0}, enabled={1}." -f $action, $enabled)
        }
        Send-HttpJson $Client (@{ enabled = $enabled; windows = 1; handle = [string]$target.handle; processId = $target.processId } | ConvertTo-Json -Compress) 200 $origin
    } catch {
        # Avoid echoing malformed/private input into logs or responses.
        try { Write-ServerLog ("Request rejected at source line {0} ({1})." -f $_.InvocationInfo.ScriptLineNumber, $_.Exception.GetType().Name) } catch { }
        try { Send-HttpJson $Client '{"error":"invalid_request"}' 400 $origin } catch { }
    } finally { $Client.Close() }
}

$createdNew = $false
$mutex = [Threading.Mutex]::new($true, "Local\ChatGPTAppModeTopMostServer-$Port", [ref]$createdNew)
if (-not $createdNew) { $mutex.Dispose(); return }
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$opacityWindows = @()
$opacityConfig = $null
try {
    $listener.Start()
    Write-ServerLog 'Control server started.'
    $nextMaintenance = [DateTime]::MinValue
    $nextWindowRefresh = [DateTime]::MinValue
    $nextOpacity = [DateTime]::MinValue
    while ($true) {
        if ($listener.Pending()) { Handle-Request ($listener.AcceptTcpClient()) }
        else { Start-Sleep -Milliseconds 16 }
        if ([DateTime]::UtcNow -ge $nextWindowRefresh) {
            $nextWindowRefresh = [DateTime]::UtcNow.AddSeconds(1)
            try {
                $opacityConfig = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
                $discovered = @(Get-AppModeOwnedWindows $opacityConfig)
                foreach ($previous in $opacityWindows) {
                    if (-not @($discovered | Where-Object { $_.handle -eq $previous.handle -and $_.processId -eq $previous.processId }).Count) {
                        Update-AppModePinnedOpacity -Config $opacityConfig -Windows @($previous) -Restore
                    }
                }
                $opacityWindows = $discovered
            } catch {
                # Fail open to full opacity if settings/discovery cannot be refreshed.
                try { Update-AppModePinnedOpacity -Config $opacityConfig -Windows $opacityWindows -Restore } catch { }
                $opacityWindows = @()
            }
        }
        if ([DateTime]::UtcNow -ge $nextOpacity) {
            $nextOpacity = [DateTime]::UtcNow.AddMilliseconds(16)
            try { Update-AppModePinnedOpacity -Config $opacityConfig -Windows $opacityWindows } catch { }
        }
        if ([DateTime]::UtcNow -ge $nextMaintenance) {
            $nextMaintenance = [DateTime]::UtcNow.AddSeconds(3)
            try {
                $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
                Update-SessionRetention $config
                Save-AppModeWindowPlacement -Config $config -AppRoot $AppRoot
            } catch { }
        }
    }
} finally {
    try { Update-AppModePinnedOpacity -Config $opacityConfig -Windows $opacityWindows -Restore } catch { }
    $listener.Stop()
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
