param([string]$AppRoot = $PSScriptRoot, [string]$PreviewPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AppModeSettingsWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
}
'@
. (Join-Path $PSScriptRoot 'tools\ChatGPT-AppMode.Helpers.ps1')
$configPath = Join-Path $AppRoot 'config.json'
New-Item -ItemType Directory -Force -Path (Join-Path $AppRoot 'logs') | Out-Null
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$privacy = Get-AppModePrivacy $config
[Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object Windows.Forms.Form
$form.Text = 'ChatGPT App Mode - Settings'
$availableHeight = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea.Height - 70
$form.ClientSize = [Drawing.Size]::new(530, [Math]::Min(720, $availableHeight))
$form.AutoScaleMode = 'Dpi'
$form.Font = [Drawing.Font]::new('Segoe UI', 10)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.StartPosition = 'CenterScreen'
# A hidden PowerShell launch supplies SW_HIDE through STARTUPINFO. Windows can
# apply it to the first form show as well; explicitly show the dialog afterward.
# Preview rendering intentionally stays invisible.
if (-not $PreviewPath) {
    $form.Add_Shown({
        [AppModeSettingsWindow]::ShowWindow($form.Handle, 5) | Out-Null
        $form.Activate()
    })
}
$panel = New-Object Windows.Forms.FlowLayoutPanel
$panel.Dock = 'Fill'
$panel.FlowDirection = 'TopDown'
$panel.WrapContents = $false
$panel.AutoScroll = $true
$panel.Padding = [Windows.Forms.Padding]::new(22, 14, 22, 14)
$form.Controls.Add($panel)
function Add-Heading([string]$Text) {
    $label = New-Object Windows.Forms.Label
    $label.Text = $Text; $label.AutoSize = $true
    $label.Font = [Drawing.Font]::new('Segoe UI', 12, [Drawing.FontStyle]::Bold)
    $label.Margin = [Windows.Forms.Padding]::new(0, 10, 0, 8)
    $panel.Controls.Add($label)
}
function Add-Check([string]$Text, [bool]$Checked) {
    $check = New-Object Windows.Forms.CheckBox
    $check.Text = $Text; $check.Checked = $Checked; $check.AutoSize = $true
    $check.Margin = [Windows.Forms.Padding]::new(0, 4, 0, 4)
    $panel.Controls.Add($check)
    return $check
}
function Add-Number([string]$Text, [int]$Value, [int]$Minimum, [int]$Maximum) {
    $row = New-Object Windows.Forms.FlowLayoutPanel
    $row.Size = [Drawing.Size]::new(470, 34)
    $label = New-Object Windows.Forms.Label
    $label.Text = $Text; $label.Width = 285; $label.Height = 28; $label.TextAlign = 'MiddleLeft'
    $number = New-Object Windows.Forms.NumericUpDown
    $number.Minimum = $Minimum; $number.Maximum = $Maximum
    $number.Value = [Math]::Max($Minimum, [Math]::Min($Maximum, $Value)); $number.Width = 110
    $row.Controls.Add($label); $row.Controls.Add($number); $panel.Controls.Add($row)
    return $number
}
function Refresh-JumpList {
    $launcher = Join-Path $AppRoot 'TaskbarLauncher\ChatGPTTaskbarLauncher.exe'
    if (Test-Path -LiteralPath $launcher) { Start-Process $launcher -ArgumentList '--register-only' -WindowStyle Hidden }
}
Add-Heading 'Launch and window'
$compactSidebar = Add-Check 'Keep a compact sidebar rail visible in narrow windows' ($config.layout.compactSidebar -ne $false)
$restore = Add-Check 'Restore the last conversation' ($config.restoreLastUrl -ne $false -and $privacy.saveLastSession)
$placement = Add-Check 'Remember window size and monitor position' ($config.rememberWindowPlacement -ne $false)
$startup = Add-Check 'Start the tray launcher when I sign in to Windows' ($config.runAtStartup -eq $true)
$width = Add-Number 'Default window width (pixels)' $config.window.width 320 7680
$height = Add-Number 'Default window height (pixels)' $config.window.height 300 4320
$opacity = Get-AppModeOpacitySettings $config
$fade = Add-Check 'Fade pinned windows when inactive or mouse is elsewhere' $opacity.enabled
$opacityPercent = Add-Number 'Inactive pinned opacity (%)' $opacity.percent 10 100
Add-Heading 'Privacy'
$recent = Add-Check 'Keep up to three recent conversations' $privacy.trackRecentChats
$titles = Add-Check 'Show conversation titles in taskbar history' $privacy.showChatTitles
$days = Add-Number 'Delete saved history after (days)' $privacy.retentionDays 1 3650
$clear = New-Object Windows.Forms.Button
$clear.Text = 'Clear saved history'; $clear.AutoSize = $true
$panel.Controls.Add($clear)
$notice = New-Object Windows.Forms.Label
$notice.Text = 'History is stored on this PC. Clearing it does not delete chats on ChatGPT. Open pages can save history again when you navigate.'
$notice.Size = [Drawing.Size]::new(470, 48)
$panel.Controls.Add($notice)
Add-Heading 'Control connection'
$connectionRow = New-Object Windows.Forms.FlowLayoutPanel
$connectionRow.Size = [Drawing.Size]::new(470, 38)
$restart = New-Object Windows.Forms.Button
$restart.Text = 'Restart control server'; $restart.AutoSize = $true
$connectionRow.Controls.Add($restart)
$connection = New-Object Windows.Forms.Label
$connection.Text = 'Pin shortcut: Alt+Shift+P'; $connection.AutoSize = $true
$connection.Padding = [Windows.Forms.Padding]::new(6, 7, 0, 0)
$connectionRow.Controls.Add($connection); $panel.Controls.Add($connectionRow)
$status = New-Object Windows.Forms.Label
$status.Text = 'Launch changes apply after closing and reopening App Mode.'
$status.Size = [Drawing.Size]::new(470, 40)
$panel.Controls.Add($status)
$buttons = New-Object Windows.Forms.FlowLayoutPanel
$buttons.Dock = 'Bottom'; $buttons.Height = 50; $buttons.FlowDirection = 'RightToLeft'
$buttons.Padding = [Windows.Forms.Padding]::new(12, 8, 18, 8)
$cancel = New-Object Windows.Forms.Button
$cancel.Text = 'Close'; $cancel.DialogResult = 'Cancel'
$save = New-Object Windows.Forms.Button
$save.Text = 'Save settings'; $save.Width = 130
$buttons.Controls.Add($cancel); $buttons.Controls.Add($save); $form.Controls.Add($buttons)
$form.CancelButton = $cancel
$clear.Add_Click({
    try {
        Clear-AppModeHistory $AppRoot
        Refresh-JumpList
        $status.Text = 'Saved local history cleared. Chats on ChatGPT were not changed.'
    } catch { $status.Text = 'Could not clear history. Close App Mode and try again.' }
})
$restart.Add_Click({
    try {
        Ensure-TopMostServerRunning -AppRoot $AppRoot -ForceRestart
        $status.Text = 'Control server restarted. The pin control will reconnect automatically.'
    } catch { $status.Text = 'Could not restart the server. Check the local logs folder.' }
})
$save.Add_Click({
    try {
        # Re-read to preserve unrelated edits made while this window was open.
        $current = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        if (-not $current.layout) { $current | Add-Member -NotePropertyName layout -NotePropertyValue ([pscustomobject]@{}) -Force }
        $current.layout | Add-Member -NotePropertyName compactSidebar -NotePropertyValue $compactSidebar.Checked -Force
        foreach ($entry in @{ restoreLastUrl=$restore.Checked; rememberWindowPlacement=$placement.Checked; runAtStartup=$startup.Checked }.GetEnumerator()) {
            $current | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value -Force
        }
        if (-not $current.window) { $current | Add-Member -NotePropertyName window -NotePropertyValue ([pscustomobject]@{}) -Force }
        $current.window | Add-Member -NotePropertyName width -NotePropertyValue ([int]$width.Value) -Force
        $current.window | Add-Member -NotePropertyName height -NotePropertyValue ([int]$height.Value) -Force
        if (-not $current.pinnedWindow) { $current | Add-Member -NotePropertyName pinnedWindow -NotePropertyValue ([pscustomobject]@{}) -Force }
        $current.pinnedWindow | Add-Member -NotePropertyName fadeWhenInactive -NotePropertyValue $fade.Checked -Force
        $current.pinnedWindow | Add-Member -NotePropertyName inactiveOpacityPercent -NotePropertyValue ([int]$opacityPercent.Value) -Force
        if (-not $current.privacy) { $current | Add-Member -NotePropertyName privacy -NotePropertyValue ([pscustomobject]@{}) -Force }
        foreach ($entry in @{ saveLastSession=$restore.Checked; trackRecentChats=$recent.Checked; showChatTitles=$titles.Checked; retentionDays=[int]$days.Value }.GetEnumerator()) {
            $current.privacy | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value -Force
        }
        Copy-Item -LiteralPath $configPath -Destination (Join-Path $AppRoot 'logs\config-backup.json') -Force
        Set-AppModeStartup -AppRoot $AppRoot -Enabled $startup.Checked
        Write-AppModeJson -Path $configPath -Value $current
        if (-not $placement.Checked) {
            $windowState = Join-Path $AppRoot 'logs\window-state.json'
            if (Test-Path -LiteralPath $windowState) { Remove-Item -LiteralPath $windowState -Force }
        }
        # Apply recording and title preferences to existing metadata immediately.
        $items = @(Get-AppModeRecentChats -AppRoot $AppRoot -Config $current)
        Write-AppModeJson -Path (Join-Path $AppRoot 'logs\recent-chats.json') -Value $items
        $last = Join-Path $AppRoot 'logs\last-session.json'
        if (-not $restore.Checked -and (Test-Path -LiteralPath $last)) { Remove-Item -LiteralPath $last -Force }
        Refresh-JumpList
        $status.Text = 'Settings saved. Relaunch App Mode for default-size changes.'
    } catch { $status.Text = 'Could not save all settings. Check folder permissions and try again.' }
})
try {
    if ($PreviewPath) {
        # Render the real form with an isolated config; no save/startup/server actions.
        $form.ShowInTaskbar = $false; $form.Opacity = 0
        $form.Show(); [Windows.Forms.Application]::DoEvents()
        $bitmap = [Drawing.Bitmap]::new($form.Width, $form.Height)
        try { $form.DrawToBitmap($bitmap, [Drawing.Rectangle]::new(0, 0, $form.Width, $form.Height)); $bitmap.Save($PreviewPath) }
        finally { $bitmap.Dispose() }
    } else { [void]$form.ShowDialog() }
} finally { $form.Dispose() }
