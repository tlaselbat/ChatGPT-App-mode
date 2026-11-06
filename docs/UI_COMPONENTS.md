# UI components and customization entry points

## Existing components

| Component | Current implementation | Behavior |
|---|---|---|
| Shared page modules | Ordered classic scripts in `extension/manifest.json` | Runtime, sidebar, home, Share, lifecycle, and Pin/session modules; `chatgpt-overrides.js` coordinates events. See the [module inventory](CONTENT_SCRIPT_BEHAVIOR.md). |
| Override styles | `extension/styles/chatgpt-overrides.css` | Codex surface tokens, permanent activity rail, docked sidebar offset, rounded workspace panel, home hero/composer layout, scrollbar treatment, and header pin/status states |
| Page header layer | `WindowHost/header.css`, `WindowHost/header.js` | Defensive compatibility for recognized contextual controls in place; no native window dragging or caption reservation. See [header architecture](ARCHITECTURE.md#native-header-host). |
| Window controls | `WindowHost/controls.html`, `controls.css`, `controls.js` and trusted control host | Isolated full-width title bar above the page view; identity, native dragging, window actions, and state synchronization through a validated local channel. See [Pin ownership and fallback](ARCHITECTURE.md#pin-ownership-and-fallback). |
| Navigation | `extension/scripts/10-sidebar.js`, shared override styles | Permanent activity rail plus native docked/drawer navigation, section disclosures, account forwarding, and focus recovery. See [navigation behavior](NAVIGATION_LAYOUT.md). |
| Share menu entry | `extension/scripts/30-share.js`, shared override styles | Hides the recognized header Share button when conversation options are available; adds Share to that menu and invokes the original site action after dismissal. Supports keyboard navigation and re-renders; unknown header markup retains the original button. No sharing or publishing is performed automatically. |
| Extension manifest | `extension/manifest.json` | MV3 matching for Playwright/live-audit browser contexts |
| Control endpoint | `Start-ChatGPT-TopMostServer.ps1` | Loopback JSON responses for topmost and session operations |
| Settings | `Open-AppMode-Settings.ps1` | Launch preferences, window sizing, startup, privacy/retention, and recovery |

## Styling organization proposed for future work

Keep the current extension entry points and manifest contract. As styling grows, split implementation into:

1. **Tokens:** semantic CSS custom properties for color, spacing, type, radius, and elevation.
2. **Structure:** layout and responsive rules that alter page regions.
3. **Components:** narrowly scoped styles for controls such as the pin button.
4. **Compatibility:** ChatGPT-specific selectors and fallbacks, isolated so markup changes are easy to audit.
5. **Settings:** one source of truth for enabled state and optional presets; default to the current behavior and allow clean disable/reset.

These are a design proposal, not a change to current rendering. Optional compact, comfortable, and minimal presets should be added only when a real settings surface is designed.

## Targeting rules

- Prefer roles, accessible names, stable `data-testid` values, and semantic relationships where available.
- Keep selectors in small helpers and check their result before applying a customization.
- Avoid depending on generated class names, deeply nested selectors, or global rules that can affect unrelated UI.
- Include light/dark and narrow-width coverage for any new component.
