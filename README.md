# ChatGPT App Mode

Windows launcher for ChatGPT built on a pinned Electron window host. A unified 40px header combines ChatGPT's native Chat/Work and contextual controls with the host-owned Pin and caption strip, preserving native window dragging and resizing. See [header ownership and hit testing](docs/ARCHITECTURE.md#native-header-host) for the isolated-view layout and [known limitations](docs/KNOWN_LIMITATIONS.md) for Windows Snap coverage.

## Install and configure

1. Install Node.js 22.12 or newer.
2. Run `Install-ChatGPT-AppMode.ps1` to create the local `config.json` and shortcuts and install the Electron runtime. Review `config.example.json` to understand the supported settings.
3. Launch with `Launch-ChatGPT-AppMode.ps1` or the installed shortcut.

`config.json`, browser profile, runtime logs, shortcuts, and installer ZIPs are local data and are excluded from Git. The host injects `extension/styles/chatgpt-overrides.css` and the ordered scripts in `extension/manifest.json` into trusted ChatGPT pages. See the [page behavior inventory](docs/CONTENT_SCRIPT_BEHAVIOR.md) for module responsibilities.

The installer installs the pinned Electron runtime into `node_modules/electron`. To add it to an existing checkout, run `Install-WindowHost.ps1`. `windowHost` is `electron` — the only supported runtime; missing runtimes or immediate startup failures warn and abort the launch.

The host uses its own ignored `Browser/AppModeHostProfile`; sign in once there. Host authentication and authenticated ChatGPT layout require separate manual live verification; offline fixtures cannot establish them.

The host keeps remote content sandboxed with Node disabled and no preload/IPC bridge. Navigation stays within exact ChatGPT and explicitly listed sign-in origins; validated HTTPS external links open in your default browser. Downloads use a Save dialog. Optional media/clipboard/notification permissions require explicit consent. Host-specific source and styling live under `WindowHost/`.

The host supports Ctrl+mouse-wheel and Ctrl+plus/minus for page zoom, Ctrl+0 to reset zoom, F5/Ctrl+R to reload, Ctrl+F5/Ctrl+Shift+R to reload without cache, and F12/Ctrl+Shift+I to open DevTools. These shortcuts operate only in the focused app window.

Open **Settings and privacy** from the tray menu, **Settings** from the rebuilt taskbar launcher, or run `Open-AppMode-Settings.ps1`. Choose whether to restore conversations, remember window placement, or start the tray launcher when signing into Windows. Default dimensions apply when saved placement is disabled or unavailable. Saved placement is clamped to a connected monitor's working area.

The tray menu keeps **Open ChatGPT**, **New chat**, and **Open pinned mini window** at the top. **Pinned opacity** offers an inactive-fade toggle, 20/30/50/75/100% presets, and a shortcut to custom values in Settings. Lower opacity is more transparent; presets enable fading and apply to pinned windows immediately. **Advanced** contains files/customization tools and **Restart control server**. **Force close App Mode** requires confirmation and targets only verified host windows. **Exit tray launcher** leaves app windows open. Launch actions run separately so window discovery does not block the tray menu.

Privacy settings independently control last-page restore, the three-entry recent list, conversation titles, and retention (30 days by default). **Clear saved history** removes local session metadata and legacy URL-bearing logs; it does not delete ChatGPT conversations or the host profile. Open pages may save history again after navigation. Changes to recording/title preferences apply to the local metadata immediately; default dimensions require relaunching App Mode.

See [Pin ownership and fallback](docs/ARCHITECTURE.md#pin-ownership-and-fallback) for the host and standalone presentations and their verification. **Alt+Shift+P** remains the page shortcut in the focused App Mode window. If the page fallback or shortcut cannot reach the loopback control service, use **Restart control server** in the tray/settings window; that recovery path is distinct from the caption strip's validated host action channel.

After updating override source, fully close and reopen App Mode so the host re-injects it; restarting the control server alone does not reload injected content.

Pinned windows fade to **30% opacity** when the mouse leaves. This affects the entire native window, including its title bar. Hovering reveals the window without taking focus, with a 140 ms eased transition. An 8 px edge tolerance (scaled for the window DPI) retains an existing hover just outside the border. Dragging, resizing, mouse selection, and open native menus keep the window solid until the interaction ends. Wheel/trackpad scrolling extends a short hold for 500 ms after the most recent activity pulse, including when the pointer leaves. After leaving, a 180 ms grace period prevents dimming on brief pointer exits, followed by a 300 ms eased fade. Interrupted transitions continue from their current opacity. Unpinning or disabling fading restores full opacity immediately. Settings provides a fade toggle and an opacity percentage (10-100%); changes apply within about a second. Faded windows stay clickable. Windows already given layered-window effects by other tools are left alone. The implementation uses [Windows layered-window alpha](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setlayeredwindowattributes) and [native mouse capture/move state](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-guithreadinfo). Scroll pulses contain only the existing window binding and an activity flag; no page content or mouse coordinates are sent or saved.

Reinstalling preserves preferences, adds missing settings, and backs up the previous config under ignored `logs/config-backup.json`. `Setup-ChatGPT-AppMode-Master.ps1` delegates to this installer and never regenerates source files.

## Offline visual development

Install Node.js 22.12+ and use the project lockfile. Run setup when dependencies or the fixture browser are missing or need updating:

```powershell
npm ci
npx playwright install chromium
```

Choose checks for the change: `npm test -- --grep "<test title>"` for affected extension fixtures (or `npm test` for the suite), `npm run test:runtime` for runtime behavior, and `npm run test:host` for native Electron behavior. Combine them when multiple areas are affected. Documentation changes need diff and reference inspection. See [the visual testing workflow](docs/VISUAL_TESTING.md) for check selection and evidence requirements.

The browser tests open Playwright's Chromium with disposable profiles under ignored `test-results/runs/` (set `APP_MODE_CHROMIUM_EXE` to pin a different browser). They route `https://chatgpt.com` to a synthetic fixture. Control-server calls are mocked; a separate integration check uses an isolated server on a temporary port to verify allowed/rejected origins. No production host profile, authenticated page, private conversation, or live ChatGPT request is used.

The tests compare desktop and narrow screenshots with committed fixture baselines. Inspect rendered images for the affected visual behavior; responsive changes need desktop and narrow review, including the affected breakpoint. Update baselines only for intended changes, inspect the new images and Git diff, then rerun affected tests without snapshot updates. A focused update uses:

```powershell
npm run test:update -- --grep "<test title>"
```

Playwright writes HTML reports to `playwright-report/` and disposable output under `test-results/runs/`:

```powershell
npm run test:report
npm run test:headed
```

Run `npm run test:host` to exercise a disposable native window against an offline synthetic ChatGPT page and an isolated control server. It verifies custom window-control clicks, dragging, border resizing, narrow layout, pinning, profile separation, navigation restrictions, and renderer sandbox settings. Screenshots stay under `test-results/runs/`. It never opens the configured host profile.

## Live UI audit

Use actual-site review for claims about current ChatGPT compatibility and fixes depending on its real DOM. Prefer the isolated Electron workflow below for app appearance and native behavior. Use the privacy-safe live audit when repeatable measurements or broader viewport, theme, sidebar, or stock/override comparisons are needed:

```powershell
npm run live:audit
```

The browser pauses until you sign in there if needed, choose the blank home page or a test conversation with no private content, and click **Begin privacy-safe capture**. The runner does not infer authentication; confirm it in the screenshots. It captures the requested desktop sizes and 390px diagnostic width, requests light/dark modes, attempts expanded/collapsed sidebar states, and compares override-enabled with stock rendering in the same profile. Navigation content and message text/media are redacted in screenshots; reports contain geometry and computed styles, not page text or labels. Calls to the local control server are mocked. Output remains local under `test-results/live-audits/`. See [historical audit evidence and current coverage limits](docs/LIVE_UI_AUDIT.md).

For native-host review against the real site, run `node tools/live-host-review.cjs` and sign in inside its dedicated development root under `test-results/live-review-profile/native-host`; production control-server calls are blocked there. Automated fixture results do not validate authenticated live behavior; see [the visual testing workflow](docs/VISUAL_TESTING.md).

## Host profile reset

`Reset-AppMode-HostProfile.ps1` deletes `Browser/AppModeHostProfile` (the Electron sign-in). It requires typing `RESET`, refuses running host processes, paths outside `Browser/`, runtime software, links, and junctions. Tests exercise validators only, never deletion.

Build the taskbar launcher with `Build-TaskbarLauncher.ps1` using the .NET Framework 4.8 compiler/reference assemblies. `-SkipRegistration` builds without refreshing the Windows jump list. The project file targets the same framework. No runtime binaries are tracked in Git.

## Project notes

Use `npm run test:all` as the aggregate offline gate for releases or changes spanning extension, runtime, and host. For focused changes, run the relevant checks; repeat or broaden passing checks only for further changes, failures, or unresolved risks. `npm test` alone covers Chromium fixtures only. See [source release packaging](docs/RELEASING.md) for the committed-source ZIP workflow.

- [Fresh install instructions](docs/FRESH-INSTALL-INSTRUCTIONS.txt)
- [Architecture](docs/ARCHITECTURE.md)
- [Design guidelines](docs/DESIGN_GUIDELINES.md)
- [UI components](docs/UI_COMPONENTS.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
- [Visual testing workflow](docs/VISUAL_TESTING.md)
- [Contributor instructions](AGENTS.md)
