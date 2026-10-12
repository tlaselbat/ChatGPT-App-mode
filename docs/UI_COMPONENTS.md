# UI components and customization entry points

## Existing components

| Component | Current implementation | Behavior |
|---|---|---|
| Content script | `extension/scripts/chatgpt-overrides.js` | Body marker, title normalization, pin button, session URL reporting, mutation observation |
| Override styles | `extension/styles/chatgpt-overrides.css` | Scrollbar treatment and fixed always-on-top button states |
| Extension manifest | `extension/manifest.json` | MV3 content script matching and load order |
| Control endpoint | `Start-ChatGPT-TopMostServer.ps1` | Loopback JSON responses for topmost and session operations |

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
