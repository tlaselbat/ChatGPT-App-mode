# Design guidelines

These guidelines apply to future visual customization. This setup task does not change the current page design.

- Use consistent spacing steps and align related controls to shared edges.
- Keep typography readable at normal zoom. Establish a clear hierarchy through size and weight rather than excessive decoration.
- Prefer compact layouts that retain comfortable hit targets, visible focus, and enough room for long conversation content.
- Let the app resize down to narrow windows without clipping essential controls or causing horizontal scrolling.
- Keep visual clutter low. Add emphasis only where it helps scanning or action recognition.
- Make customization reversible and provide sensible defaults. Avoid hiding core ChatGPT controls.
- Support light and dark appearances using semantic tokens and `color-scheme` aware values.
- Scope selectors to the smallest stable region. Avoid broad element-wide overrides and brittle generated class names.
- Check keyboard navigation, focus visibility, reduced motion, contrast, and text zoom along with screenshots.
- When ChatGPT markup changes, disable or soften an override that no longer matches instead of applying it globally.
