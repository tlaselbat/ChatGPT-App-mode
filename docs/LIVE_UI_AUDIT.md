# Live UI audit status

## Current status

**Live capture completed, but it was unauthenticated.** The production host profile was not opened. The captured screenshots visibly show ChatGPT “Log in” / “Sign up” controls, so signed-in conversation UI, account-specific appearance, and authenticated sidebar behavior remain unverified.

The repeatable runner is available as `npm run live:audit`. It opens the separate `test-results/live-review-profile`, pauses for the user to sign in and click the in-page capture control, then captures the blank home route or a user-confirmed test conversation (`/c/<id>`) with the extension enabled and disabled. Message text and media are redacted in screenshots. Extension requests to the local control server are mocked in Playwright, so the server is not contacted. It writes the timestamped report, screenshot set, and numeric measurements under ignored `test-results/live-audits/`.

Latest run: `test-results/live-audits/2026-10-12T23-06-37-145Z/` (44 screenshots, 2 appearances, 6 viewports). The report and measurements are local and ignored by Git. The browser showed the logged-out landing interface. The 390×844 customized screenshot confirms the injected pin button is visible near the top-right; measured geometry found no pin/composer or pin/header intersection in the captured states. No horizontal overflow or composer clipping was measured. These results describe the logged-out page only.

## Confirmed offline-fixture finding

At the 390×844 fixture viewport, the fixed extension pin control overlaps a few pixels of the first fixture message. This is confirmed only in the synthetic offline fixture; it is not evidence of a live ChatGPT defect. The source behavior is in `extension/styles/chatgpt-overrides.css` and is initialized by `extension/scripts/chatgpt-overrides.js`.

Evidence: [narrow offline fixture snapshot](../tests/visual.spec.js-snapshots/fixture-narrow-win32.png).

## Live checks still required

- Signed-in conversation/sidebar/content behavior and any personalized UI.
- Light and dark appearance as rendered by the signed-in account; the runner emulates the media preference and records computed colors, but the in-app setting may override it.
- Expanded/collapsed sidebar behavior and whether current ChatGPT markup exposes a usable toggle.
- Composer alignment, scrolling, clipping, overflow, and any pin/header/composer overlap on the hosted UI.
- Signed-in stock-versus-customized visual differences.
- Whether current extension calls expect control-server behavior beyond the mocked `/session` and `/topmost` responses. No local server security behavior has been exercised.
- Manual typography, spacing, wasted-space, keyboard/focus, contrast, and accessibility review. Automated measurements are triage evidence, not a complete accessibility audit.

No live screenshot or authenticated content is checked into the repository. Screenshots, measurements, and the isolated profile remain under ignored `test-results/`.
