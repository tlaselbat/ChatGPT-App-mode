# Architecture and current behavior

## Runtime layout

The maintained source lives at the project root, in `extension/`, `tools/`, `WindowHost/`, and `TaskbarLauncher/`. The pinned Electron runtime (`node_modules/electron`) and the dedicated host profile (`Browser/AppModeHostProfile`) are local runtime state. `logs/` contains operational logs and restorable session/recent-chat metadata. Local configuration is `config.json`; `config.example.json` is the sanitized template. ZIP installers, package builds, `.lnk` shortcuts, and `archive/` contents are generated or machine-specific artifacts.

## Launch flow

`Launch-ChatGPT-AppMode.ps1` starts the tray helper and topmost loopback server, loads local configuration and shared helper functions, and starts the Electron host via `Start-AppModeNativeHost` with `WindowHost/main.cjs`. `windowHost` is `electron` — the only supported runtime; a missing runtime or immediate startup failure warns and aborts. The installer creates configuration and shortcuts, installs the Electron runtime, and may rebuild the taskbar launcher.

`Reset-AppMode-HostProfile.ps1` targets only `Browser/AppModeHostProfile`. It requires typed confirmation, refuses running host processes, validates the dedicated Browser boundary, and rejects runtime software (`node_modules/electron`), path aliases, and reparse points (including descendants). Tests invoke the guards without invoking deletion.

`tools/AppMode.State.ps1` owns configuration merging, atomic JSON writes, history policy, startup shortcuts, reset guards, and screen-bound clamping. `tools/AppMode.Windows.ps1` owns native window access and executable/profile/HWND/PID validation. `Open-AppMode-Settings.ps1` supplies a native settings surface; saving preserves unrelated configuration. Installers merge missing defaults instead of regenerating source.

## Shared override entry points

The host injects the shared override CSS and the ordered classic scripts from `extension/manifest.json`, followed by `WindowHost/header.css` and `WindowHost/header.js` for the page-owned part of the unified header. MV3 contexts use the same script order. See the [page behavior inventory](CONTENT_SCRIPT_BEHAVIOR.md) for responsibilities and cleanup. Site nodes retain their native handlers and containers; the remote page receives no privileged bridge.

The content script uses selectors derived from chat links and IDs (`aria-current`, `href`, `data-testid`, and `nav`). These are implementation details of ChatGPT and can change. Keep page-specific selectors in a clearly marked compatibility layer as customization grows.

## Local control server and metadata

The PowerShell server listens on `127.0.0.1:17863`. It requires an exact allowed ChatGPT origin and numeric loopback Host, bounds headers/body/read duration, and handles explicit POST/OPTIONS requests only. PNA permission is returned only for an explicit allowed-origin preflight requesting it; it is retained for compatibility. Browser integration verifies allowed/rejected loopback fetches with local-network permission granted only in the fixture profile.

Pin requests resolve one verified host window. Status reads the actual native topmost style. Mutation requires the target to be foreground, and bound HWNDs are checked with their process ID and the dedicated host profile each time. No foreground window outside that ownership boundary is ever included, and stale on-disk topmost handles are not read. Placement is sampled from the foreground owned window every three seconds and saved as geometry only; launch arguments clamp it to a connected working area.

Enabled session/recent-chat metadata remain local plaintext. Settings control recording, title visibility, and retention; clear-history removes that metadata and legacy URL-bearing logs. New operational logs omit URLs, titles, headers, and request bodies. Recent history always serializes as an array; the taskbar reader accepts legacy singleton objects and applies privacy/retention before displaying entries. Native command-line quoting preserves recent URLs through Windows PowerShell `-File`.

## Visual customization direction

The shared override stylesheet defines Codex-inspired surface, spacing, and radius tokens. The permanent activity rail, responsive native sidebar, rounded workspace, and home-only welcome/composer treatment use reversible, scoped adapters; native conversation content and editor behavior remain intact. Header normalization shares one row with the caption strip, without an unconditional workspace top inset. See [navigation behavior](NAVIGATION_LAYOUT.md) for the authoritative sizing and disclosure rules.

## Native header host

For trusted ChatGPT responses, the host extends `connect-src` to permit its numeric loopback control origin. The effective `default-src` fallback is preserved when `connect-src` is absent; policies with no connection restriction remain unrestricted. This exception applies to connection destinations, not scripts or other resource directives.

Local-network access is automatically allowed only for a trusted main-frame ChatGPT request so the local control endpoint can work. Optional media, clipboard, and notification grants require native consent. Consent is tied to the requesting document and expires on main-frame navigation.

All launch paths use `WindowHost/main.cjs` through `Start-AppModeNativeHost`. The runtime is pinned in `package-lock.json`, installed by `Install-WindowHost.ps1`, and remains untracked under `node_modules/electron/dist`.

The native host composes each window from two isolated `WebContentsView`s sharing one 40 CSS-pixel header row. The remote ChatGPT view starts at `(0, 0)` and fills the content bounds; it is not placed below a second title bar. `WindowHost/header.js` tags recognized site header structures, and `WindowHost/header.css` normalizes them in place. ChatGPT retains its native Chat/Work switch, contextual actions, handlers, menus, and containers. The trusted local caption strip (`WindowHost/controls.html`, `controls.css`, `controls.js`) overlays only the row's right side and owns Pin, minimize, maximize/restore, and close. Unknown page markup remains native; the host caption controls do not depend on successful page-header recognition.

`WindowHost/controls-host.cjs` sets `HEADER_HEIGHT = 40` and `CAPTION_STRIP_WIDTH = 184` in CSS pixels, scales the strip bounds with page zoom, and hides the strip in fullscreen. The page reserves a 188 CSS-pixel right-side band in `WindowHost/header.css`, slightly wider than the strip. Its pointer-transparent `::after` region explicitly uses `-webkit-app-region: no-drag`; interactive page controls also opt out of dragging. This cross-view hit-test fix prevents the underlying page drag surface from resolving `HTCAPTION` beneath the host's caption buttons, which must receive client input. The strip and exclusion are related but intentionally not identical dimensions; preserve the verified 40/184/188 geometry rather than adding a workspace top spacer.

The existing validated action channel accepts only minimize, maximize, restore, close, and pin. It checks the exact action, sender webContents, trusted local main frame and document URL, and association with the live owning window; requests carry no window IDs or native handles. The trusted caption renderer is sandboxed with a narrow preload, while remote ChatGPT still has no preload or privileged IPC. Native events synchronize maximize and Always-on-Top state. The host sends compact sizing based on the page viewport, not the small strip viewport. Only visual theme values are sampled from the page. The caption session denies permissions and external resources, blocks navigation, and is destroyed with its owner.

The dedicated `Browser/AppModeHostProfile` is derived from the installation root. Remote pages run sandboxed with context isolation, no Node integration, no preload, and no privileged IPC. Only exact ChatGPT pages receive the shared CSS/JS. Sign-in origins are explicitly listed in `WindowHost/policy.cjs`; other validated HTTPS links open externally. Permission checks validate both top-level and requesting origins; optional grants require native consent and expire on main-frame navigation. Downloads use a native Save dialog.

Native window ownership requires the exact Electron executable beneath this installation, exactly one matching root flag, exactly one matching dedicated profile flag, and a browser process rather than a renderer. Existing PID/HWND revalidation and the strict loopback server boundary remain in place. The host's fixture test exercises native input only against verified disposable fixture windows and refuses covered-window clicks.

## Pin ownership and fallback

In Electron App Mode, the visible Pin belongs to the trusted host caption strip. It invokes the validated `pin` action in `WindowHost/controls-host.cjs`, which toggles Always-on-Top on the owning `BrowserWindow` and publishes native state back to the strip. It does not grant the remote page access to that privileged channel.

The shared scripts still maintain the page-owned Pin for the supported standalone extension/hostless environment. Shared CSS uses `var(--app-mode-page-pin-display, grid)` so the page control defaults to visible; only the host stylesheet sets that property to `none`. Electron therefore shows one host Pin without a visible page duplicate, while a context with no caption strip retains the functional page fallback. The fallback uses the existing validated loopback control endpoint, window-binding checks, retry behavior, and page shortcut; keeping it mounted also preserves that lifecycle in the host environment. Do not hide it unconditionally in shared CSS or expose the caption preload to the remote page.

`tests/visual.spec.js` covers both presentations. Its standardized-action-row fixture loads the actual caption document with a mocked native bridge, checks mouse/keyboard activation, and verifies fallback visibility when host styling is removed; hostless fixtures cover the page control's recovery and replacement behavior. `tests/window-host.cjs` separately exercises the actual host Pin listener and native Always-on-Top state while checking that the page duplicate stays hidden. Fixture bridge checks alone are not native-window evidence.
