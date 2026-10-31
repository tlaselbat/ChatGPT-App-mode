# UI components and customization entry points

## Existing components

| Component | Current implementation | Behavior |
|---|---|---|
| Content script | `extension/scripts/chatgpt-overrides.js` | Body marker, title normalization, pin button, session URL reporting, mutation observation |
| Override styles | `extension/styles/chatgpt-overrides.css` | Scrollbar treatment, header pin/status states, and flow-toolbar fallback |
| Host header layer | `WindowHost/header.css`, `WindowHost/header.js` | Secondary action-row layout: tags recognized site header structures and normalizes them in place without moving nodes |
| Window controls | `WindowHost/controls.html`, `controls.css`, `controls.js` and trusted control host | Application-owned 48px title bar above the page view: drag region plus theme-aware outlined minimize, maximize/restore, and close buttons in an isolated surface; native state synchronization, responsive sizing, red close accent and blue maximize interaction |
| Share menu entry | `extension/scripts/chatgpt-overrides.js`, `extension/styles/chatgpt-overrides.css` | Hides the recognized header Share button when conversation options are available; adds Share to that menu and invokes the original site action after dismissal. Supports keyboard navigation and re-renders; unknown header markup retains the original button. No sharing or publishing is performed automatically. |
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
