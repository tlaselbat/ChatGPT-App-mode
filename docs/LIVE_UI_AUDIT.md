# Verification evidence and live coverage limits

## Accepted baseline and evidence scope

The accepted implementation is the unified-header and Codex-inspired sidebar
baseline at `33c496d`. The preceding implementation task reported 34/34 visual,
5/5 runtime, and 7/7 native-host checks passing. These are prior working-tree
results associated with that implementation, not new test runs or a clean-checkout
certification performed during documentation reconciliation.

The isolated authenticated sidebar review reported native disclosure keyboard
activation, Library/New chat navigation, Chat/Work switching, account menu access,
rail-focus restoration, and no horizontal overflow at 390, 489, 680, 893, 1024,
and 1280 CSS pixels. Private conversation/project entries were not activated
live; fixture coverage does not fill that live-testing gap. The sidebar's 125%
and 150% matrix used effective CSS viewport equivalents, not actual native
browser zoom. This does not establish every sign-in path, media feature,
Windows display-scaling configuration, or authenticated stock comparison.

See [header and Pin ownership](ARCHITECTURE.md#native-header-host) and
[current navigation behavior](NAVIGATION_LAYOUT.md). The older runner evidence
below is preserved with its original scope and must not be treated as a current
defect list or as proof of authenticated behavior.

## Historical automated audit (2026-10-12)

**That capture completed, but it was unauthenticated.** The production host profile was not opened. The captured screenshots visibly show ChatGPT “Log in” / “Sign up” controls, so that run did not verify signed-in conversation UI, account-specific appearance, or authenticated sidebar behavior.

The repeatable runner is available as `npm run live:audit`. It opens the separate `test-results/live-review-profile`, pauses for the user to sign in and click the in-page capture control, then captures the blank home route or a user-confirmed test conversation (`/c/<id>`) with the extension enabled and disabled. Message text and media are redacted in screenshots. Extension requests to the local control server are mocked in Playwright, so the server is not contacted. It writes the timestamped report, screenshot set, and numeric measurements under ignored `test-results/live-audits/`.

Historical runner output: `test-results/live-audits/2026-10-12T23-06-37-145Z/` (44 screenshots, 2 appearances, 6 viewports). The report and measurements are local and ignored by Git. The browser showed the logged-out landing interface. The 390×844 customized screenshot confirms the injected pin button is visible near the top-right; measured geometry found no pin/composer or pin/header intersection in the captured states. No horizontal overflow or composer clipping was measured. These results describe the logged-out page only.

## Historical offline-fixture finding

At that milestone, the 390×844 synthetic fixture showed a fixed page Pin overlapping the first fixture message. This was not evidence of a live ChatGPT defect and is not a statement about the accepted host-owned Pin or current fixture layout.

The [maintained narrow fixture baseline](../tests/visual.spec.js-snapshots/fixture-narrow-win32.png) now represents the current test, not an archived failure image from that experiment.

## Coverage not established by that historical run

- Signed-in conversation/sidebar/content behavior and any personalized UI.
- Light and dark appearance as rendered by the signed-in account; the runner emulates the media preference and records computed colors, but the in-app setting may override it.
- Expanded/collapsed sidebar behavior and whether current ChatGPT markup exposes a usable toggle.
- Composer alignment, scrolling, clipping, overflow, and any pin/header/composer overlap on the hosted UI.
- Signed-in stock-versus-customized visual differences.
- Whether current extension calls expect control-server behavior beyond the mocked `/session` and `/topmost` responses. No local server security behavior has been exercised.
- Manual typography, spacing, wasted-space, keyboard/focus, contrast, and accessibility review. Automated measurements are triage evidence, not a complete accessibility audit.

No live screenshot or authenticated content is checked into the repository. Screenshots, measurements, and the isolated profile remain under ignored `test-results/`.
