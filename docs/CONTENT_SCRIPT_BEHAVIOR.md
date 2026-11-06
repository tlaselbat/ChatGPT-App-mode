# Injected page behavior inventory

The Electron host concatenates the ordered classic scripts from `extension/manifest.json` and executes them after each trusted ChatGPT document load. Playwright and live-audit Chromium load the same ordered list through MV3. `chatgpt-overrides.js` is the final lifecycle/event coordinator; the host separately injects `WindowHost/header.js`. Preserve these distinct paths and their current ordering.

| Feature | Trigger and assumptions | Fallback and cleanup |
|---|---|---|
| Header and Pin | `50-pin.js`, lifecycle, and event coordination maintain the page adapter; the host separately normalizes recognized page headers and owns the separate title bar. | See canonical [Pin ownership and fallback](ARCHITECTURE.md#pin-ownership-and-fallback) for visibility, channels, and environment-specific tests. Header retention during a modal stays inside the page view. |
| Sidebar | `10-sidebar.js` reconciles rendered native navigation and recognized section disclosures after initialization, resize, and DOM changes. | Owns reversible markers and supported fallback disclosures, not native links. Preserves native preferences, scroll containers, and modal focus semantics; see [navigation behavior](NAVIGATION_LAYOUT.md#section-based-navigation-refinement) for sizing, account focus, and cleanup. |
| Home layout | Initialization and DOM mutations on `/`; visible native editor, form, heading, and validated layout branches. | Removes owned layout attributes on conversations or unknown home markup. |
| Share | Initialization and DOM mutations; recognized Share plus a related conversation-options control. | Restores the native Share control when recognition fails; the original site handler remains the action source. |
| Navigation/session | History, hash, focus, timer, and mutation events; eligible ChatGPT route and current document state. | Session reports are retried with backoff; no chat content is sent. Delegated event handling survives replaced page nodes. |

The shared runtime context is initialized once per document; reinjection of the complete script list is ignored. Module files are ordered classic scripts, not ES modules, and use no build step or privileged bridge.
