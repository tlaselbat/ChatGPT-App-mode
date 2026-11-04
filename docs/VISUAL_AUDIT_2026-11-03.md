# Codex layout audit — November 3, 2026

Compared the installed Codex layout with the isolated Electron App Mode home,
including the permanent rail, expanded sidebar, narrow drawer, shared header,
and bottom-anchored composer. The production profile was not used.

## Findings and fixes

- **Caption overlap:** the header's later `padding` shorthand overwrote its
  188px right reservation. Centering also checked only page controls, ignoring
  the separate 184px caption view. At 390px, the caption view covered Work.
  Restore the reservation, include it in centering decisions, and use the
  remaining row space when centering cannot fit. Recognized mode-switch
  wrappers no longer clip their buttons. The 40/184/188 geometry is unchanged.
- **Split frame colors:** the header used the workspace surface while the rail
  used the shell surface. Header and caption sampling now use the shell token.
- **Flat composer surface:** the home card used the workspace color, while a
  leftover conversation rule replaced the native elevated composer background.
  Home now uses an elevated surface; conversation composers retain native styles.
- **Narrow composer spacing:** reduce home-side padding from 24px to 12px at
  widths up to 480px, giving the editor and controls more usable space.
- **Duplicate sidebar toggle:** hide recognized docked-panel toggle duplicates
  once the rail replacement exists. Keep the native modal close control.

## Verification scope

Live inspection used the dedicated review profile, with visible signed-in
account state, blank home at 680×850, 1280×1000 and 390×1000, and native sidebar
collapse/open and Escape dismissal. Temporary live captures were removed after
inspection; retained test renders contain synthetic content only. Private
conversations and the production profile were not inspected.

Browser attachment affected the page's preferred color scheme. Native desktop
comparison therefore used a fresh reload and a diagnostic connection that did
not apply browser-context defaults. Explicit light/dark fixture coverage is
separate from authenticated native dark-theme evidence; forced class changes
are not evidence of the site's native theme-setting flow.

Regression coverage includes caption exclusion at multiple widths and zooms,
sidebar lifecycle and account access, draft preservation, light/dark home
renders, and native conversation typography/composer preservation.

Initial audit results: 35/35 browser tests, 5/5 runtime/release tests, and 7/7 native-host
tests passed. Native coverage includes Pin, caption actions, dragging, resizing,
focus, zoom and rejection paths. `git diff --check` passed. No visual baselines
changed. The initial native run exposed a test race: DOM click dispatch returns
before Pin's asynchronous IPC completes. The test now waits, with a bounded
timeout, for both the actual Always-on-Top state and its accessible button state;
the complete native suite then passed.

## Conversation screenshot follow-up

The supplied screenshots exposed a gray conversation panel beside a purple
native footer and composer. Current ChatGPT publishes `--color-surface*`
tokens, while App Mode consumed older token names and reached its gray
fallbacks. App Mode now prefers the current surface, text and border tokens,
retaining the legacy names as compatibility fallbacks. Native conversation
composer styling remains authoritative.

The selected chat title also had an extra minimum height and selection paint
inside its already padded native row. Current interactive row links now keep
their natural height and transparent background; the native outer row owns
selection and hover. Keyboard focus remains visible. The decorative header
label stays 64px from the window's left edge when the sidebar opens.

After restarting the isolated review, live computed styles confirmed the main
surface was `rgb(30, 30, 46)`, the shell token was `#191927`, and the header
label remained at 64px with the sidebar closed and open. A native chat link
measured 19.5px inside its 36px row, with zero minimum height and transparent
background. No private chat was opened or captured.

Synthetic conversation coverage checks current tokens overriding stale legacy
tokens, centered row text, focus visibility, draft preservation and horizontal
overflow in light/dark themes at 1280px (expanded and collapsed) and 390px.
Rendered light/dark desktop and narrow captures were visually inspected.

Follow-up results: 36/36 browser tests and 7/7 native-host tests passed after
these changes; `git diff --check` passed. The 5/5 runtime/release result above
is prior evidence, not a rerun for this styling follow-up. No snapshot
baselines changed. The isolated review window was closed and temporary
diagnostic scripts removed.

## Accepted stable checkpoint

The user accepted this layout as the current stable checkpoint. One cosmetic
issue remains: the visible conversation panel has rounded bottom corners but
square top corners below the shared header. The workspace radius alone does
not round that visible upper boundary. This is deferred; no corner or clipping
change is included in this checkpoint.
