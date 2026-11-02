# Design guidelines

Use the accepted unified header, not stacked host and site rows. The [header architecture](ARCHITECTURE.md#native-header-host) defines the verified row, caption strip, and non-draggable exclusion geometry; preserve those dimensions. Native Chat/Work and contextual actions remain page-owned. Keep restrained, theme-aware control states and visible keyboard focus. Follow the canonical [Pin ownership and fallback](ARCHITECTURE.md#pin-ownership-and-fallback) rule rather than independently hiding or recreating controls.

- Use consistent spacing steps and align related controls to shared edges.
- Match the reference's charcoal fills and visible neutral borders in dark mode, with lighter equivalents in light mode. Known sidebar buttons sort before sibling new-chat controls; unmatched site markup keeps its original order.
- With compact navigation enabled, center the mode switch on the viewport across sidebar states. With native navigation, use the live content rectangle for a docked sidebar. At 480 CSS pixels or less, or when neighboring controls would collide, use remaining-space flow.
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
- The Codex surface model is four layers: shell/activity `#1c2325`, sidebar `#2d3745`, workspace `#374357`, composer `#4e5a6c` (dark; light uses proportionate equivalents via `light-dark()`). The activity rail remains permanent; [navigation behavior](NAVIGATION_LAYOUT.md#section-based-navigation-refinement) defines responsive sizing, native disclosures, and the flag-keyed width release. Use rounded workspace surfaces without an unconditional top inset or overflow clipping that cuts native menus and dialogs.
