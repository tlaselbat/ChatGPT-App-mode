# Architecture and current behavior

## Runtime layout

The maintained source lives at the project root, in `extension/`, `tools/`, and `TaskbarLauncher/`. The installed PortableApps Chromium tree (`Browser/`) and app profile (`Browser/ChatGPTProfile`) are local runtime state. `logs/` contains operational logs and restorable session/recent-chat metadata. Local configuration is `config.json`; `config.example.json` is the sanitized template. ZIP installers, package builds, and `.lnk` shortcuts are generated or machine-specific artifacts.

## Launch flow

`Launch-ChatGPT-AppMode.ps1` starts the tray helper and topmost loopback server, loads local configuration and shared helper functions, and starts Chromium. `ConvertTo-ArgLine` adds `--user-data-dir` from `appProfileDir`, `--load-extension` from `extensionDir`, and the configured app URL. Chromium Portable itself is kept under `Browser/ChromiumPortable`. The installer creates configuration and shortcuts and may rebuild the taskbar launcher.

The profile reset script follows the launcher's effective profile path: it uses `appProfileDir` when configured, or `chromiumPortableRoot\Data` for the legacy setup-generated configuration that omits `appProfileDir`. It requires confirmation and refuses paths outside the project. No profile data was deleted during setup.

## Extension entry points

The MV3 manifest declares a content script for `https://chatgpt.com/*` and `https://chat.openai.com/*`. Its CSS entry point is `styles/chatgpt-overrides.css`; its JavaScript entry point is `scripts/chatgpt-overrides.js`. The script adds a body marker, sets the document title, creates the always-on-top button, reports eligible current URLs to the local session endpoint, and observes DOM changes to restore the button/marker.

The content script uses selectors derived from chat links and IDs (`aria-current`, `href`, `data-testid`, and `nav`). These are implementation details of ChatGPT and can change. Keep page-specific selectors in a clearly marked compatibility layer as customization grows.

## Local control server and metadata

The PowerShell server listens on `127.0.0.1:17863` and handles topmost actions and session metadata. Its current responses allow any origin and grant private-network access. That broad browser access needs a dedicated security change restricting origins, with tests for preflight and requests from allowed/disallowed origins. Verify whether Chromium requires the private-network preflight grant for supported ChatGPT origins before changing that header.

`logs/last-session.json`, `logs/recent-chats.json`, and `logs/topmost-server.log` can contain chat URLs, titles, and activity metadata in plaintext. Recent chat shortcuts can also contain titles. They are excluded from Git. A future privacy change should minimize fields, avoid logging full URLs, and consider retention/deletion controls.

## Visual customization direction

There is currently one override stylesheet, not a token/component architecture. Keep it intact for now. The next small refactor can introduce CSS custom properties in a token file, separate structural layout from component-specific styles, and put brittle ChatGPT selectors in a compatibility file. Any setting should have a reversible default and support both `prefers-color-scheme` appearances. Presets are optional future work; this setup does not redesign the UI.
