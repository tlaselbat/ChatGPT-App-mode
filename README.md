# ChatGPT App Mode

Windows launcher for ChatGPT built on a pinned Electron window host. Minimize, maximize/restore, and close sit at the right of the translucent page header, with native window dragging, resizing, and Windows Snap support.

## Install and configure

1. Install Node.js 22.12 or newer.
2. Run `Install-ChatGPT-AppMode.ps1` to create the local `config.json` and shortcuts and install the Electron runtime. Review `config.example.json` to understand the supported settings.
3. Launch with `Launch-ChatGPT-AppMode.ps1` or the installed shortcut.

`config.json`, browser profile, runtime logs, shortcuts, and installer ZIPs are local data and are excluded from Git. The shared page overrides are `extension/styles/chatgpt-overrides.css` and `extension/scripts/chatgpt-overrides.js`; the host injects them into ChatGPT pages directly.

The installer installs the pinned Electron runtime into `node_modules/electron`. To add it to an existing checkout, run `Install-WindowHost.ps1`. `windowHost` is `electron` — the only supported runtime; missing runtimes or immediate startup failures warn and abort the launch.

The host uses its own ignored `Browser/AppModeHostProfile`; sign in once there. Host authentication and authenticated ChatGPT layout require separate manual live verification; offline fixtures cannot establish them.

The host keeps remote content sandboxed with Node disabled and no preload/IPC bridge. Navigation stays within exact ChatGPT and explicitly listed sign-in origins; validated HTTPS external links open in your default browser. Downloads use a Save dialog. Optional media/clipboard/notification permissions require explicit consent. Host-specific source and styling live under `WindowHost/`.

The host supports Ctrl+mouse-wheel and Ctrl+plus/minus for page zoom, Ctrl+0 to reset zoom, F5/Ctrl+R to reload, Ctrl+F5/Ctrl+Shift+R to reload without cache, and F12/Ctrl+Shift+I to open DevTools. These shortcuts operate only in the focused app window.

Open **Settings and privacy** from the tray menu, **Settings** from the rebuilt taskbar launcher, or run `Open-AppMode-Settings.ps1`. Choose whether to restore conversations, remember window placement, or start the tray launcher when signing into Windows. Default dimensions apply when saved placement is disabled or unavailable. Saved placement is clamped to a connected monitor's working area.

The tray menu keeps **Open ChatGPT**, **New chat**, and **Open pinned mini window** at the top. **Pinned opacity** offers an inactive-fade toggle, 20/30/50/75/100% presets, and a shortcut to custom values in Settings. Lower opacity is more transparent; presets enable fading and apply to pinned windows immediately. **Advanced** contains files/customization tools and **Restart control server**. **Force close App Mode** requires confirmation and targets only verified host windows. **Exit tray launcher** leaves app windows open. Launch actions run separately so window discovery does not block the tray menu.

Privacy settings independently control last-page restore, the three-entry recent list, conversation titles, and retention (30 days by default). **Clear saved history** removes local session metadata and legacy URL-bearing logs; it does not delete ChatGPT conversations or the host profile. Open pages may save history again after navigation. Changes to recording/title preferences apply to the local metadata immediately; default dimensions require relaunching App Mode.

The header pin affects one verified foreground host window. Use **Alt+Shift+P** in that window to toggle it. Its state refreshes from Windows when focused. If the control is offline, click it to retry or use **Restart control server** in the tray/settings window. Requests time out rather than leaving the button disabled indefinitely.

Each pin click refreshes the native window binding and completes the requested on/off action in the same click, including after connection recovery. The click handler survives cloned/replaced headers. After updating override source, fully close and reopen App Mode so the host re-injects it; restarting the control server alone does not reload injected content.

Pinned windows fade to **30% opacity** when the mouse leaves. This affects the entire native window, including its title bar. Hovering reveals the window without taking focus, with a 140 ms eased transition. An 8 px edge tolerance (scaled for the window DPI) retains an existing hover just outside the border. Dragging, resizing, mouse selection, and open native menus keep the window solid until the interaction ends. Wheel/trackpad scrolling extends a short hold for 500 ms after the most recent activity pulse, including when the pointer leaves. After leaving, a 180 ms grace period prevents dimming on brief pointer exits, followed by a 300 ms eased fade. Interrupted transitions continue from their current opacity. Unpinning or disabling fading restores full opacity immediately. Settings provides a fade toggle and an opacity percentage (10-100%); changes apply within about a second. Faded windows stay clickable. Windows already given layered-window effects by other tools are left alone. The implementation uses [Windows layered-window alpha](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setlayeredwindowattributes) and [native mouse capture/move state](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-guithreadinfo). Scroll pulses contain only the existing window binding and an activity flag; no page content or mouse coordinates are sent or saved.

Reinstalling preserves preferences, adds missing settings, and backs up the previous config under ignored `logs/config-backup.json`. `Setup-ChatGPT-AppMode-Master.ps1` delegates to this installer and never regenerates source files.

## Offline visual development

Install Node.js 22.12+ and use the project lockfile:

```powershell
npm ci
npx playwright install chromium
npm test
npm run test:runtime
npm run test:host
```

The browser tests open Playwright's Chromium with disposable profiles under ignored `test-results/runs/` (set `APP_MODE_CHROMIUM_EXE` to pin a different browser). They route `https://chatgpt.com` to a synthetic fixture. Control-server calls are mocked; a separate integration check uses an isolated server on a temporary port to verify allowed/rejected origins. No production host profile, authenticated page, private conversation, or live ChatGPT request is used.

The test captures desktop and narrow screenshots and compares them with committed fixture baselines. Update baselines intentionally after reviewing the new images:

```powershell
npm run test:update
```

Playwright writes HTML reports to `playwright-report/` and disposable output under `test-results/runs/`:

```powershell
npm run test:report
npm run test:headed
```

Run `npm run test:host` to exercise a disposable native window against an offline synthetic ChatGPT page and an isolated control server. It verifies custom window-control clicks, dragging, border resizing, narrow layout, pinning, profile separation, navigation restrictions, and renderer sandbox settings. Screenshots stay under `test-results/runs/`. It never opens the configured host profile.

## Live UI audit

Run the privacy-safe live audit when you are ready to authenticate in the isolated development profile:

```powershell
npm run live:audit
```

The browser pauses until you sign in there if needed, choose the blank home page or a test conversation with no private content, and click **Begin privacy-safe capture**. The runner does not infer authentication; confirm it in the screenshots. It captures the requested desktop sizes and 390px diagnostic width, requests light/dark modes, attempts expanded/collapsed sidebar states, and compares override-enabled with stock rendering in the same profile. Navigation content and message text/media are redacted in screenshots; reports contain geometry and computed styles, not page text or labels. Calls to the local control server are mocked. Output remains local under `test-results/live-audits/`. See [the current audit status](docs/LIVE_UI_AUDIT.md).

For native-host review against the real site, run `node tools/live-host-review.cjs` and sign in inside its dedicated development root under `test-results/live-review-profile/native-host`; production control-server calls are blocked there. Automated fixture results do not validate authenticated live behavior; see [the visual testing workflow](docs/VISUAL_TESTING.md).

## Host profile reset

`Reset-AppMode-HostProfile.ps1` deletes `Browser/AppModeHostProfile` (the Electron sign-in). It requires typing `RESET`, refuses running host processes, paths outside `Browser/`, runtime software, links, and junctions. Tests exercise validators only, never deletion.

Build the taskbar launcher with `Build-TaskbarLauncher.ps1` using the .NET Framework 4.8 compiler/reference assemblies. `-SkipRegistration` builds without refreshing the Windows jump list. The project file targets the same framework. No runtime binaries are tracked in Git.

## Project notes

Use `npm run test:all` as the aggregate offline verification gate. `npm test` alone covers Chromium fixtures only. See [source release packaging](docs/RELEASING.md) for the committed-source ZIP workflow.

- [Fresh install instructions](docs/FRESH-INSTALL-INSTRUCTIONS.txt)
- [Architecture](docs/ARCHITECTURE.md)
- [Design guidelines](docs/DESIGN_GUIDELINES.md)
- [UI components](docs/UI_COMPONENTS.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
- [Visual testing workflow](docs/VISUAL_TESTING.md)
- [Contributor instructions](AGENTS.md)
