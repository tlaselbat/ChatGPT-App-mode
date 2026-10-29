# ChatGPT App Mode

Windows launcher for ChatGPT with a native window host and shared page overrides. Minimize, maximize/restore, and close sit at the right of the translucent page header, with native window dragging, resizing, and Windows Snap support. PortableApps Chromium remains available as a rollback and for normal browser tools.

## Install and configure

1. Install Node.js 22.12 or newer. Keep PortableApps Chromium under `Browser/ChromiumPortable` for browser tools and rollback.
2. Run `Install-ChatGPT-AppMode.ps1` to create the local `config.json` and shortcuts. Review `config.example.json` to understand the supported settings.
3. Launch with `Launch-ChatGPT-AppMode.ps1` or the installed shortcut.

`config.json`, browser files/profile, runtime logs, shortcuts, and installer ZIPs are local data and are excluded from Git. CSS and JavaScript entry points are `extension/styles/chatgpt-overrides.css` and `extension/scripts/chatgpt-overrides.js`.

The installer installs the pinned Electron runtime. To add it to an existing checkout, run `Install-WindowHost.ps1`. The default `windowHost` is `electron`; set `"windowHost": "chromium"` in local configuration to restore the old title bar. Missing runtimes or immediate startup failures fall back to Chromium with a warning. Startup failures after the initial 1.5-second check require manual rollback.

The native host uses its own ignored `Browser/AppModeHostProfile`; sign in once there. It never copies or resets the Chromium profile. The browser-profile reset command and normal Chromium settings still apply only to Chromium. Shared page/header overrides are built into the native host; the extension toggle applies to Chromium. Native-host authentication and authenticated ChatGPT layout require separate manual live verification; offline fixtures cannot establish them.

The host keeps remote content sandboxed with Node disabled and no preload/IPC bridge. Navigation stays within exact ChatGPT and explicitly listed sign-in origins; validated HTTPS external links open in your default browser. Downloads use a Save dialog. Optional media/clipboard/notification permissions require explicit consent. Host-specific source and styling live under `WindowHost/`.

The native host supports Ctrl+mouse-wheel and Ctrl+plus/minus for page zoom, Ctrl+0 to reset zoom, F5/Ctrl+R to reload, Ctrl+F5/Ctrl+Shift+R to reload without cache, and F12/Ctrl+Shift+I to open DevTools. These shortcuts operate only in the focused app window.

Open **Settings and privacy** from the tray menu, **Settings** from the rebuilt taskbar launcher, or run `Open-AppMode-Settings.ps1`. Choose whether to restore conversations, remember window placement, load the extension, or start the tray launcher when signing into Windows. Default dimensions apply when saved placement is disabled or unavailable. Saved placement is clamped to a connected monitor's working area.

The tray menu keeps **Open ChatGPT**, **New chat**, and **Open pinned mini window** at the top. **Pinned opacity** offers an inactive-fade toggle, 20/30/50/75/100% presets, and a shortcut to custom values in Settings. Lower opacity is more transparent; presets enable fading and apply to pinned windows immediately. **Advanced** contains browser/extension tools, files/customization, and **Restart control server**. **Force close App Mode** requires confirmation and targets only the configured profile's verified browser owner. **Exit tray launcher** leaves browser windows open. Launch actions run separately so window discovery does not block the tray menu.

Privacy settings independently control last-page restore, the three-entry recent list, conversation titles, and retention (30 days by default). **Clear saved history** removes local session metadata and legacy URL-bearing logs; it does not delete ChatGPT conversations or browser profiles. Open pages may save history again after navigation. Changes to recording/title preferences apply to the local metadata immediately; extension loading and default dimensions require relaunching App Mode.

The header pin affects one verified foreground window from the configured browser profile. Use **Alt+Shift+P** in that window to toggle it. Its state refreshes from Windows when focused. If the control is offline, click it to retry or use **Restart control server** in the tray/settings window. Requests time out rather than leaving the button disabled indefinitely.

Each pin click refreshes the native window binding and completes the requested on/off action in the same click, including after connection recovery. The click handler survives cloned/replaced headers. After updating extension source, fully close and reopen App Mode so Chromium reloads it; restarting the control server alone does not reload content scripts.

Pinned windows fade to **30% opacity** when the mouse leaves. This affects the entire native window, including its title bar. Hovering reveals the window without taking focus, with a 140 ms eased transition. An 8 px edge tolerance (scaled for the window DPI) retains an existing hover just outside the border. Dragging, resizing, mouse selection, and open native menus keep the window solid until the interaction ends. Wheel/trackpad scrolling extends a short hold for 500 ms after the most recent activity pulse, including when the pointer leaves; this requires the updated extension. After leaving, a 180 ms grace period prevents dimming on brief pointer exits, followed by a 300 ms eased fade. Interrupted transitions continue from their current opacity. Unpinning or disabling fading restores full opacity immediately. Settings provides a fade toggle and an opacity percentage (10-100%); changes apply within about a second. Faded windows stay clickable. Pre-existing layered-window effects from Chromium/other tools are left alone. The implementation uses [Windows layered-window alpha](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setlayeredwindowattributes) and [native mouse capture/move state](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-guithreadinfo). Scroll pulses contain only the existing window binding and an activity flag; no page content or mouse coordinates are sent or saved.

Reinstalling preserves preferences and custom paths, adds missing settings, and backs up the previous config under ignored `logs/config-backup.json`. Legacy portable profiles stay in legacy mode. `Setup-ChatGPT-AppMode-Master.ps1` delegates to this installer and never regenerates source files.

## Offline visual development

Install Node.js 22.12+ and use the project lockfile:

```powershell
npm ci
npm test
npm run test:runtime
```

The browser tests open bundled Chromium with disposable profiles under ignored `test-results/runs/`. They route `https://chatgpt.com` to a synthetic fixture. Extension calls are mocked; a separate integration check uses an isolated server on a temporary port to verify allowed/rejected browser origins. Local-network permission is granted only in the fixture context. No production browser profile, authenticated page, private conversation, or live ChatGPT request is used.

The test captures desktop and narrow screenshots and compares them with committed fixture baselines. Update baselines intentionally after reviewing the new images:

```powershell
npm run test:update
```

Playwright writes HTML reports to `playwright-report/` and disposable output under `test-results/runs/`. It never clears the persistent live-review profile or saved live audits:

```powershell
npm run test:report
npm run test:headed
```

Run `npm run test:host` to exercise a disposable native window against an offline synthetic ChatGPT page and an isolated control server. It verifies native caption-button clicks, dragging, border resizing, narrow layout, pinning, profile separation, navigation restrictions, and renderer sandbox settings. Screenshots stay under `test-results/runs/`. It never opens the configured Chromium profile.

## Live UI audit

Run the privacy-safe live audit when you are ready to authenticate in the isolated development profile:

```powershell
npm run live:audit
```

The browser pauses until you sign in there if needed, choose the blank home page or a test conversation with no private content, and click **Begin privacy-safe capture**. The runner does not infer authentication; confirm it in the screenshots. It captures the requested desktop sizes and 390px diagnostic width, requests light/dark modes, attempts expanded/collapsed sidebar states, and compares extension-enabled with stock rendering in the same profile. Navigation content and message text/media are redacted in screenshots; reports contain geometry and computed styles, not page text or labels. Calls to the local control server are mocked. Output remains local under `test-results/live-audits/`. Close any other Chromium window using the live-review profile first. See [the current audit status](docs/LIVE_UI_AUDIT.md).

To use a separately installed Chromium instead of the bundled runtime:

```powershell
$env:APP_MODE_CHROMIUM_EXE = 'C:\Path\To\chrome.exe'
npm test
```

For actual-site review, start a separate development profile with `./Start-ChatGPT-Visual-Review.ps1` and sign in there if needed. Its profile lives under ignored `test-results/live-review-profile`; it never reads or copies the configured production profile. Automated fixture results do not validate authenticated live behavior; see [the visual testing workflow](docs/VISUAL_TESTING.md).

## Normal Chromium and profile reset

Use `Open-Chromium-Normal.ps1` for ordinary browser settings and extension management. Both reset entry points use `Reset-Portable-Chromium-Profile.ps1`, require typing `RESET`, and refuse running browsers, paths outside a dedicated profile beneath `Browser/`, runtime software, links, and junctions. Custom profiles outside that boundary must be managed manually. Tests exercise validators only, never deletion.

Build the taskbar launcher with `Build-TaskbarLauncher.ps1` using the .NET Framework 4.8 compiler/reference assemblies. `-SkipRegistration` builds without refreshing the Windows jump list. The project file targets the same framework. No runtime binaries are tracked in Git.

## Project notes

- [Architecture](docs/ARCHITECTURE.md)
- [Design guidelines](docs/DESIGN_GUIDELINES.md)
- [UI components](docs/UI_COMPONENTS.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
- [Visual testing workflow](docs/VISUAL_TESTING.md)
- [Contributor instructions](AGENTS.md)
