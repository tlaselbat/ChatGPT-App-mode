# Design guidelines

Use two distinct header levels: Electron owns a full-width 40 DIP application title bar, and ChatGPT owns the contextual row beneath it. The [header architecture](ARCHITECTURE.md#native-header-host) defines view bounds, fullscreen behavior, and the trusted native-control boundary. Keep restrained, theme-aware control states and visible keyboard focus. Follow the canonical [Pin ownership and fallback](ARCHITECTURE.md#pin-ownership-and-fallback) rule.

- Use consistent spacing steps and align related controls to shared edges.
- Match the reference's charcoal fills and visible neutral borders in dark mode, with lighter equivalents in light mode. Known sidebar buttons sort before sibling new-chat controls; unmatched site markup keeps its original order.
- Keep the contextual header associated with the conversation workspace. Recognized fixed mode switches use the available content region and fall back to flow when actions would collide. Native title-bar controls remain accessible independently of page zoom; identity may truncate at narrow widths.
- Application-owned surfaces use solid theme-aware fills, subtle borders, and consistent radii. Do not add directional glow or globally remove native gradients, shadows, or pseudo-elements.
- Keep typography readable at normal zoom. Establish a clear hierarchy through size and weight rather than excessive decoration.
- Prefer compact layouts that retain comfortable hit targets, visible focus, and enough room for long conversation content.
- Let the app resize down to narrow windows without clipping essential controls or causing horizontal scrolling.
- Keep visual clutter low. Add emphasis only where it helps scanning or action recognition.
- Make customization reversible and provide sensible defaults. Avoid hiding core ChatGPT controls.
- Support light and dark appearances using semantic tokens and `color-scheme` aware values.
- Scope selectors to the smallest stable region. Avoid broad element-wide overrides and brittle generated class names.
- Check keyboard navigation, focus visibility, reduced motion, contrast, and text zoom along with screenshots.
- Use short color/border transitions and disable them for reduced motion. Keep hover, pressed, and focus feedback free of size changes. Preserve custom theme colors through the existing shared control tokens.
- When ChatGPT markup changes, disable or soften an override that no longer matches instead of applying it globally.
- The Codex surface model uses semantic shell/activity, sidebar, workspace, and elevated composer layers. Centralize neutral dark surfaces in the shared body tokens: shell `#0d0d0e`, sidebar `#131315`, workspace `#0f0f11`, composer `#2a2a2c`. Light appearance resolves current ChatGPT surface tokens with legacy fallbacks. Rebind only recognized workspace surface tokens; retain native accents, text, message geometry, and composer behavior. The activity rail remains permanent; [navigation behavior](NAVIGATION_LAYOUT.md#section-based-navigation-refinement) defines responsive sizing, native disclosures, and the flag-keyed width release. The main owns one rounded boundary: its contextual header carries the top corners and an adjoining clipped content surface carries only the bottom corners. Keep their backgrounds continuous and do not add overflow clipping that cuts native menus and dialogs. Retain the 52px rail and native message widths; contextual padding must not reserve the rail twice.
