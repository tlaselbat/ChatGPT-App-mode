# Phase Three — compact navigation selection verification

## Baseline and scope

Started on a clean checkout at accepted Phase Two commit
`278e459daaba67100ede978df253872f28ae1e0b`. Created local branch
`codex/compact-selection-verification` directly from it. Accepted Phase One/Two branches,
fixture corrections, transition tests, evidence contracts and all baselines are preserved.
No production code, dimensions, animation, IPC, native control or configuration behavior changed.
No GitHub operation, push, PR, merge, release or deployment occurred.

## Live Phase Two follow-up — unavailable

The existing isolated review process was verified against the dedicated
`test-results/live-review-profile/native-host` root, separately from the production process.
The standard `tools/live-host-review.cjs` launcher was used. Its diagnostic endpoint on
127.0.0.1:9223 did not respond. A close/relaunch attempt on the task-opened isolated window
also did not establish a responsive connection; no process was forcibly terminated.
Visible authentication was not safely confirmed. This means **unavailable verification**,
not a conclusion that the profile is signed out or that the site has a defect.

No live geometry or screenshot evidence was obtained for 390, 680, 1024 or 1280 DIP, either
theme, or 125% zoom. None of the requested real-site opening/closing, reversal, focus or
responsive states is newly verified here. No production profile was accessed, copied or
reset. No credential/cookie inspection, automated login or authentication workaround was
attempted. Persistent review profiles and prior evidence remain intact. The existing
launcher only updated its dedicated isolated review configuration.

[Live availability record](../test-results/live-audits/phase3-sidebar-check-ulaepx_h/status.json)

Phase Two's accepted local synthetic/native-fixture results remain historical evidence.
They do not close the current authenticated compatibility gap. No sidebar changes were
made in response to the unavailable live check.

## Selection findings

Source inspection of `activeDestination()` and its marker reconciliation found the existing
native-authority model intact: selected semantics in recognized navigation, then exact
same-origin native-link membership, then a small verified route fallback. Unknown or
conflicting membership remains unselected. Native current attributes are read rather than
rewritten. The existing Navigation API listener covers DOM-free SPA navigation.

Two added Chromium-extension fixture tests each exercise 26 named checks:

- Blank home; existing conversation with native Recents membership; project landing;
  a project conversation established by a mounted exact native link in Projects.
- A project-shaped conversation URL without membership remains unselected. Duplicating
  its exact link into Recents clears ambiguous selection; one explicit native current
  state disambiguates it; conflicting native current states clear selection again.
- Library and Scheduled tasks; native-selected Plugins and native-current Explore;
  removal of their semantic state clears stale selection. An unrelated main-content
  current link cannot select the rail.
- SPA pushState navigation keeps the same document; reload recovers selection; native
  sidebar replacement disconnects old nodes and uses the fresh membership.
- Library selection survives docked expansion/contraction, a resize to 390 CSS px,
  native drawer expansion and Escape dismissal. Focus returns to the visible toggle.
- Keyboard Tab/Shift+Tab returns to the selected Library item without changing selection.
  Native aria-current/aria-selected values remain unchanged by App Mode reconciliation.

**No production selection defect was reproduced in these conditions.** No route mapping,
project-membership inference or native behavior correction is justified by this evidence.
Actual current-site destinations and project DOM variants remain unverified because live
access was unavailable; the fixture route classes are not current-site discovery results.

## Visual and geometry evidence

Inspected all six generated PNGs: project-conversation selection, Library keyboard focus,
and narrow Library selection in both light and dark. The synthetic unrelated current link
is an intentional negative control in the page content, not a production UI observation.

| Measurement | Light | Dark |
| --- | --- | --- |
| Selected icon contrast against effective selected background | 11.77:1 | 8.01:1 |
| Selected accent indicator contrast | 11.77:1 | 8.01:1 |
| Focus outline contrast | 11.77:1 | 8.01:1 |
| Focus outline | 2px solid | 2px solid |
| Narrow rail width | 52 CSS px | 52 CSS px |
| Narrow viewport / horizontal scroll width | 390 / 390 CSS px | 390 / 390 CSS px |

Desktop screenshots are 1280x850 pixels; narrow screenshots are 390x850 pixels. These are
Chromium CSS viewport tests, not Electron DIP or Windows display-scaling measurements.
Color ratios apply only to the two controlled fixture palettes. They do not establish
contrast for current authenticated themes, arbitrary accents or physical high contrast.
Images use manual inspection, so manifest visual comparison status is explicitly `skipped`;
this must not be mistaken for unavailable checks passing golden comparison. No approved
snapshot or tolerance was changed.

[Review index](../test-results/visual-evidence/2026-11-07T11-10-07-145Z-34208/index.md)

[Manifest with all scenario checks, contrast and geometry](../test-results/visual-evidence/2026-11-07T11-10-07-145Z-34208/manifest.json)

## Executed verification

| Command / check | Result |
| --- | --- |
| Existing compact selection and keyboard focus tests | 2 passed |
| New light/dark selection tests | 2 passed, 26 named checks each |
| JavaScript/PowerShell syntax under Windows PowerShell 5.1 | Passed |
| JavaScript/PowerShell syntax under PowerShell 7 | Passed |
| Image readability and manifest artifact references | All six images readable; references resolved |

Initial new-test runs failed because escaping a CSS class selector inside embedded fixture
JavaScript prevented the synthetic project link from being seeded. The fixture now uses an
attribute selector and asserts that the link exists before testing classification. This was
not a product failure. Final targeted runs pass; existing assertions were not relaxed.

No broader suite was repeated: production and shared helpers are unchanged, and the new
file is independently exercised. No new Electron or authenticated-site success is claimed.
Accepted Phase Two native-host results and earlier full-suite/hosted CI results remain prior
evidence only. This branch has not been pushed or hosted-tested.

Files changed: `tests/visual/selection.spec.js`, this report and the remediation tracker.
The Phase Three local fixture assessment is complete without production changes. The live
sidebar/selection gap remains explicitly unavailable. Physical mixed-DPI, Pin/opacity
endurance, U-01 and authenticated live Share remain separate outstanding requirements.
Phase Four was not started.
