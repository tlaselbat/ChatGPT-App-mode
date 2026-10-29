param([Parameter(Mandatory)][string]$Scratch)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
$configPath = Join-Path $Scratch 'config.json'
@{ custom = 'preserve'; pinnedWindow = @{ inactiveOpacityPercent = 30; fadeWhenInactive = $true; custom = 'preserve' } } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath
# Build the production menu with a synthetic configuration, no NotifyIcon,
# service startup, browser launches, or production-profile access.
$trayMenu = . (Join-Path $root 'Start-ChatGPT-TrayLauncher.ps1') -AppRoot $Scratch -MenuOnly
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
try {
    $mutexName = 'Local\AppModeTrayTest-' + [Guid]::NewGuid().ToString('N')
    $staleMutex = [Threading.Mutex]::new($false, $mutexName)
    $recoveredMutex = $null
    try {
        $recoveredMutex = Enter-TrayMutex -Name $mutexName
        Assert ($null -ne $recoveredMutex) 'Existing unowned mutex blocked tray startup.'
        # A distinct process must be rejected while this test owns the mutex.
        $mutexProbe = Join-Path $Scratch 'mutex-probe.ps1'
        $mutexFunction = (Get-Command Enter-TrayMutex).Definition
        @("function Enter-TrayMutex { $mutexFunction }", "`$probe = Enter-TrayMutex -Name '$mutexName'", 'if ($null -eq $probe) { exit 0 }; $probe.ReleaseMutex(); $probe.Dispose(); exit 1') |
            Set-Content -LiteralPath $mutexProbe
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $mutexProbe
        Assert ($LASTEXITCODE -eq 0) 'Two tray processes could acquire the same mutex.'
    } finally {
        if ($recoveredMutex) { $recoveredMutex.ReleaseMutex(); $recoveredMutex.Dispose() }
        $staleMutex.Dispose()
    }
    $labels = @($trayMenu.Items | Where-Object { $_ -is [Windows.Forms.ToolStripMenuItem] } | ForEach-Object Text)
    Assert (($labels -join '|') -eq 'Open ChatGPT|New chat|Open pinned mini window|Settings and privacy...|Pinned opacity: 30%|Advanced|Exit tray launcher') 'Primary actions or menu grouping are wrong.'
    Assert ($fadeItem.Checked) 'Configuration checks were not loaded.'
    Assert (@($opacityItems | Where-Object Checked).Count -eq 1) 'Opacity preset check is ambiguous.'
    ($opacityItems | Where-Object { $_.Tag.Percent -eq 50 }).PerformClick()
    Update-TrayMenu
    $saved = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    Assert ($saved.pinnedWindow.inactiveOpacityPercent -eq 50 -and $saved.pinnedWindow.custom -eq 'preserve' -and $saved.custom -eq 'preserve') 'Preset did not preserve unrelated configuration.'
    $fadeItem.PerformClick()
    Update-TrayMenu
    Assert (-not $fadeItem.Checked -and $opacityMenu.Text -eq 'Pinned transparency: off') 'Fade toggle failed.'
    ($opacityItems | Where-Object { $_.Tag.Percent -eq 75 }).PerformClick()
    Update-TrayMenu
    Assert ($fadeItem.Checked -and $opacityMenu.Text -eq 'Pinned opacity: 75%') 'Choosing opacity did not enable fading.'
    # External Settings edits must be reflected whenever the menu opens.
    Set-TrayOpacity -Percent 42 -Enabled $true
    Update-TrayMenu
    Assert ($opacityMenu.Text -eq 'Pinned opacity: 42%' -and @($opacityItems | Where-Object Checked).Count -eq 0) 'Custom opacity was misrepresented.'
    $script:launchCalls = @()
    function Start-Process { param($FilePath, $WindowStyle, $ArgumentList); $script:launchCalls += [pscustomobject]@{file=$FilePath; style=$WindowStyle; args=$ArgumentList} }
    $launchItem.PerformClick()
    $newSessionItem.PerformClick()
    Assert ($script:launchCalls.Count -eq 2) 'Launch clicks did not dispatch.'
    Assert ($script:launchCalls[0].style -eq 'Hidden' -and $script:launchCalls[0].args -contains '-LaunchMode') 'Launch is not offloaded from the tray UI thread.'
    Assert ($script:launchCalls[1].args -contains '-NewSession') 'New chat lost its fresh-session flag.'
    $script:serverEnsured = $false
    $script:identityApplied = $false
    function Ensure-TopMostServerRunning { param($AppRoot, $LogPath); $script:serverEnsured = $true }
    function Start-AppModeNativeHost { param($Config, $AppRoot, $NewSession, $LaunchUrl); return $true }
    function Set-AppModeWindowIdentity { param($Config, $IconPath, $LogPath); $script:identityApplied = $true }
    Start-AppModeWindow -NewSession
    Assert ($script:serverEnsured -and $script:identityApplied) 'Launch worker did not recover its control server or host identity.'
    $settingsItem.PerformClick()
    $customOpacityItem.PerformClick()
    Assert ($script:launchCalls.Count -eq 4) 'Settings or custom opacity did not dispatch.'
    Assert ($script:launchCalls[2].args -contains ('"' + (Join-Path $root 'Open-AppMode-Settings.ps1') + '"') -and $script:launchCalls[2].args -contains ('"' + $Scratch + '"')) 'Settings lost its script path or isolated AppRoot.'
    Remove-Item Function:\Start-Process
    # Execute the real tray event and hidden child-process launch. Checking only
    # dispatch or a preview image misses a running dialog hidden by STARTUPINFO.
    $script:settingsChild = $null
    function Start-Process {
        param($FilePath, $WindowStyle, $ArgumentList)
        $script:settingsChild = Microsoft.PowerShell.Management\Start-Process -FilePath $FilePath -WindowStyle $WindowStyle -ArgumentList $ArgumentList -PassThru
    }
    try {
        $settingsItem.PerformClick()
        Assert ($null -ne $script:settingsChild) 'Settings click did not create a child.'
        Initialize-WindowIdentityApi
        $settingsDeadline = [DateTime]::UtcNow.AddSeconds(6)
        $visibleSettings = @()
        do {
            $visibleSettings = @([ChatGptAppModeWindowIdentity]::GetVisibleTopLevelWindowsForProcessId($script:settingsChild.Id) |
                Where-Object { [ChatGptAppModeWindowIdentity]::GetWindowTitle($_) -eq 'ChatGPT App Mode - Settings' })
            if (-not $visibleSettings.Count) { Start-Sleep -Milliseconds 100 }
        } while (-not $visibleSettings.Count -and [DateTime]::UtcNow -lt $settingsDeadline -and -not $script:settingsChild.HasExited)
        Assert ($visibleSettings.Count -eq 1) 'Tray Settings launched without a visible settings window.'
    } finally {
        if ($script:settingsChild -and -not $script:settingsChild.HasExited) { Microsoft.PowerShell.Management\Stop-Process -Id $script:settingsChild.Id -Force }
        Remove-Item Function:\Start-Process
    }
    # No reset or real process termination is executed in this test.
    $script:stopped = @()
    function Stop-Process { param($Id, [switch]$Force, $ErrorAction); $script:stopped += $Id }
    $fixture = New-Object Windows.Forms.Form
    $script:ownedTarget = [pscustomobject]@{ handle=$fixture.Handle.ToInt64(); processId=$PID }
    function Get-AppModeOwnedWindows { param($Config); return $script:ownedTarget }
    function Confirm-TrayForceClose { return $false }
    Stop-AppModeWindows
    Assert ($script:stopped.Count -eq 0) 'Canceled force close terminated a process.'
    function Confirm-TrayForceClose { return $true }
    Stop-AppModeWindows
    Assert ($script:stopped.Count -eq 1 -and $script:stopped[0] -eq $PID) 'Force close did not use the validated profile owner.'
    $script:ownedTarget.processId = 2147483647
    Stop-AppModeWindows
    Assert ($script:stopped.Count -eq 1) 'Recycled/mismatched HWND was allowed to terminate a process.'
    $fixture.Dispose()
    Remove-Item Function:\Stop-Process
    # Render only synthetic menu labels. No desktop or private data is captured.
    foreach ($entry in @(@{name='tray'; control=$trayMenu}, @{name='opacity';control=$opacityMenu.DropDown}, @{name='advanced';control=$advancedMenu.DropDown})) {
        $control = $entry.control
        $control.Size = $control.GetPreferredSize([Drawing.Size]::Empty)
        $control.CreateControl()
        $control.PerformLayout()
        $bitmap = [Drawing.Bitmap]::new($control.Width, $control.Height)
        try { $control.DrawToBitmap($bitmap, [Drawing.Rectangle]::new(0,0,$control.Width,$control.Height)); $bitmap.Save((Join-Path $Scratch ($entry.name + '.png'))) } finally { $bitmap.Dispose() }
    }
    'malformed' | Set-Content -LiteralPath $configPath
    Update-TrayMenu
    Assert (-not $opacityMenu.Enabled -and -not $toggleExtensionItem.Enabled) 'Invalid configuration left preference controls active.'
    Write-Output 'PASS: tray grouping, persisted controls, async launch dispatch, visible Settings from real tray action, force-close safety, malformed configuration, and synthetic menu rendering.'
} finally { $trayMenu.Dispose() }
