# Architecture and current behavior

## Runtime layout

The maintained source lives at the project root, in `extension/`, `tools/`, `WindowHost/`, and `TaskbarLauncher/`. The pinned Electron runtime (`node_modules/electron`) and the dedicated host profile (`Browser/AppModeHostProfile`) are local runtime state. `logs/` contains operational logs and restorable session/recent-chat metadata. Local configuration is `config.json`; `config.example.json` is the sanitized template. ZIP installers, package builds, `.lnk` shortcuts, and `archive/` contents are generated or machine-specific artifacts.

## Launch flow

`Launch-ChatGPT-AppMode.ps1` starts the tray helper and topmost loopback server, loads local configuration and shared helper functions, and starts the Electron host via `Start-AppModeNativeHost` with `WindowHost/main.cjs`. `windowHost` is `electron` — the only supported runtime; a missing runtime or immediate startup failure warns and aborts. The installer creates configuration and shortcuts, installs the Electron runtime, and may rebuild the taskbar launcher.

`Reset-AppMode-HostProfile.ps1` targets only `Browser/AppModeHostProfile`. It requires typed confirmation, refuses running host processes, validates the dedicated Browser boundary, and rejects runtime software (`node_modules/electron`), path aliases, and reparse points (including descendants). Tests invoke the guards without invoking deletion.

`tools/AppMode.State.ps1` owns configuration merging, atomic JSON writes, history policy, startup shortcuts, reset guards, and screen-bound clamping. `tools/AppMode.Windows.ps1` owns native window access and executable/profile/HWND/PID validation. `Open-AppMode-Settings.ps1` supplies a native settings surface; saving preserves unrelated configuration. Installers merge missing defaults instead of regenerating source.

## Shared override entry points

The host injects `extension/styles/chatgpt-overrides.css` and `extension/scripts/chatgpt-overrides.js` into ChatGPT pages, then `WindowHost/header.css`/`header.js` for the native caption integration. The MV3 manifest remains for Playwright fixture and live-audit browser contexts. The script adds a body marker, sets the document title, creates the always-on-top button, reports eligible current URLs to the local session endpoint, and observes DOM changes to restore the button/marker.

The content script uses selectors derived from chat links and IDs (`aria-current`, `href`, `data-testid`, and `nav`). These are implementation details of ChatGPT and can change. Keep page-specific selectors in a clearly marked compatibility layer as customization grows.

## Local control server and metadata

The PowerShell server listens on `127.0.0.1:17863`. It requires an exact allowed ChatGPT origin and numeric loopback Host, bounds headers/body/read duration, and handles explicit POST/OPTIONS requests only. PNA permission is returned only for an explicit allowed-origin preflight requesting it; it is retained for compatibility. Browser integration verifies allowed/rejected loopback fetches with local-network permission granted only in the fixture profile.

Pin requests resolve one verified host window. Status reads the actual native topmost style. Mutation requires the target to be foreground, and bound HWNDs are checked with their process ID and the dedicated host profile each time. No foreground window outside that ownership boundary is ever included, and stale on-disk topmost handles are not read. Placement is sampled from the foreground owned window every three seconds and saved as geometry only; launch arguments clamp it to a connected working area.

Enabled session/recent-chat metadata remain local plaintext. Settings control recording, title visibility, and retention; clear-history removes that metadata and legacy URL-bearing logs. New operational logs omit URLs, titles, headers, and request bodies. Recent history always serializes as an array; the taskbar reader accepts legacy singleton objects and applies privacy/retention before displaying entries. Native command-line quoting preserves recent URLs through Windows PowerShell `-File`.

## Visual customization direction

There is currently one override stylesheet, not a token/component architecture. Keep it intact for now. The next small refactor can introduce CSS custom properties in a token file, separate structural layout from component-specific styles, and put brittle ChatGPT selectors in a compatibility file. Any setting should have a reversible default and support both `prefers-color-scheme` appearances. Presets are optional future work; this setup does not redesign the UI.

## Native header host

For trusted ChatGPT responses, the host extends `connect-src` to permit its numeric loopback control origin. The effective `default-src` fallback is preserved when `connect-src` is absent; policies with no connection restriction remain unrestricted. This exception applies to connection destinations, not scripts or other resource directives.

Local-network access is automatically allowed only for a trusted main-frame ChatGPT request so the local control endpoint can work. Optional media, clipboard, and notification grants require native consent. Consent is tied to the requesting document and expires on main-frame navigation.

All launch paths use `WindowHost/main.cjs` through `Start-AppModeNativeHost`. The runtime is pinned in `package-lock.json`, installed by `Install-WindowHost.ps1`, and remains untracked under `node_modules/electron/dist`.

The native host uses `titleBarStyle: hidden` with a transparent 48px native Windows controls overlay. Shared site overrides provide the translucent header; `WindowHost/header.css` reserves caption-button space and makes header background areas draggable. `WindowHost/header.js` normalizes visible mode switches into flex layout while retaining their nodes and event handlers. The switch and buttons become compact at narrow widths, preserving one header row. Windows retains caption-button handling, resizing, maximize/restore, and Snap.

The dedicated `Browser/AppModeHostProfile` is derived from the installation root. Remote pages run sandboxed with context isolation, no Node integration, no preload, and no privileged IPC. Only exact ChatGPT pages receive the shared CSS/JS. Sign-in origins are explicitly listed in `WindowHost/policy.cjs`; other validated HTTPS links open externally. Permission checks validate both top-level and requesting origins; optional grants require native consent and expire on main-frame navigation. Downloads use a native Save dialog.

Native window ownership requires the exact Electron executable beneath this installation, exactly one matching root flag, exactly one matching dedicated profile flag, and a browser process rather than a renderer. Existing PID/HWND revalidation and the strict loopback server boundary remain in place. The host's fixture test exercises native input only against verified disposable fixture windows and refuses covered-window clicks.
