# Design guidelines

The app-owned title bar is a 48px strip rendered by the host above the page; beneath it the site's header is normalized into a 40px secondary action row. Header buttons share rounded 8px outlines, centered icons, and restrained theme-aware interaction states. Standard icon buttons are 32px wide and 28px high, reducing to 28px wide in compact windows. Share retains enough width for its label. The close control uses a red accent and maximize uses blue during interaction; pin retains its existing state colors.

- Use consistent spacing steps and align related controls to shared edges.
- Match the reference's charcoal fills and visible neutral borders in dark mode, with lighter equivalents in light mode. The close button keeps a red outline at rest. Known sidebar buttons sort before sibling new-chat controls; unmatched site markup keeps its original order.
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
