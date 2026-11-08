# Phase Two — sidebar transition verification

## Baseline and result

Started from clean `7553aa64f8987ec4d09dcd0edc8e6ea531a7b878` on local branch
`codex/sidebar-transition-verification`. The accepted visual-verification and artifact-probe
branches are preserved. No remote action is authorized or performed in this phase.

No production transition defect has been confirmed in the exercised synthetic states.
The existing `fbe1c9d` transition implementation is retained unchanged. Two related test
weaknesses were confirmed: a platform API name collision in the native synthetic fixture,
and composition captures that accepted partial injection and an unsettled rail fade.

Phase One hosted acceptance remains prior evidence: normal run
[42361372639](https://github.com/tlaselbat/ChatGPT-App-mode/actions/runs/42361372639) passed;
controlled artifact run [42361843552](https://github.com/tlaselbat/ChatGPT-App-mode/actions/runs/42361843552)
failed intentionally and delivered inspected sanitized evidence. Those results do not
verify this branch's new changes on hosted CI.

## Current authority and timing

- The native toggle updates native open intent and mounted/retained sidebar DOM. The
  adapter reads rendered drawer geometry first, then docked aside width above 52.5 CSS px,
  otherwise compact state. Native open intent controls when docked width overrides apply.
- The controller derives body state, inert rail state and reversible owned markers from
  that adapter. It does not maintain independent expansion state. The compact rail is 52 px.
- At recognized flex workspace boundaries, a 220 ms Web Animations margin correction
  starts from current geometry and keeps the far edge fixed. It does not scale text or
  change the native panel's detection width. Resize/replacement/reduced motion cancel it.
- The rail fades out in 100 ms and in over 120 ms; it becomes inert immediately on expansion.
  Readiness does not imply that this visibility transition has completed.
- Electron owns the unzoomed 40 DIP title bar. Its single sidebar control delegates through
  the existing validated action and page adapter. Fullscreen retains the page fallback.
- Fixture native docked/drawer switching occurs at 700 CSS px. This is a synthetic fixture
  contract, not a renewed measurement of the current ChatGPT frontend breakpoint. App Mode
  sidebar sizing tokens change at 900/1200 CSS px; there is no alternate 480px chrome.

## Explicit classification of the 1024x728 observation

**Confirmed fixture error plus screenshot timing/readiness gap, not an established settled
application layout defect or a demonstrated hosted-only rendering defect.**

The shared fixture declared `function navigation(drawer)` in the page global scope. In
Electron this replaced `window.navigation`, causing `TypeError: window.navigation?.addEventListener
is not a function` and `INJECTION_SCRIPTS_FAILED`. The partial runtime could paint navigation,
but trusted host navigation remained unavailable. Chromium's isolated extension world hid
this collision, so the existing behavioral tests did not expose it.

At exact local window bounds `(80,40,1024,728)`, content view `(0,40,1024,688)`, CSS viewport
`1024x688`, zoom 1 and display scale 1, the first readiness sample already reported native
open intent `true`, body/adapter `docked`, sidebar width 266.234 px and workspace x 274.234 px.
The rail was 52 px wide, inert and still fading (sampled opacity 1 or 0.904). Subsequent
samples were opacity 0 / visibility hidden, with unchanged sidebar/workspace geometry.
Thus a first-ready capture can preserve duplicate presentation without a settled overlap.
The original hosted image itself does not establish its exact capture time.

After renaming the fixture function to `navigationMarkup`, injection completes and the
trusted toggle operates. Settled 1024x728 captures have no duplicate rail. The exact
hosted geometry was reproduced locally; no Windows Server configuration was recreated.
The local result explains the observation without asserting physical/environment parity.

## Targeted corrections and regression evidence

- Rename only the fixture helper and its two calls; preserve the Navigation API.
- Require valid Navigation API, installed runtime, ready host navigation, visible trusted
  toggle and settled rail before ready native composition captures. Loading remains a
  separately intentional pending-initialization scenario.
- Add eight real Electron transition cases using trusted caption IPC and original synthetic
  native handlers. Record actual window/content/view bounds, CSS geometry, zoom/scale,
  native intent, state markers, animation-enabled screenshots and per-frame measurements.
- Add only `synthetic-geometry` to the sanitized attachment allowlist, with a contract test;
  this retains per-frame JSON through the existing manifest/index system. Other profile
  JSON and database attachments remain rejected. Manifest schema and upload policy are unchanged.
- The original fixture can be selected with test-only `APP_MODE_TRANSITION_LEGACY_FIXTURE=1`.
  The new native test then fails at the Navigation API guard, proving detection of the
  original failure. Expected diagnostic failure, not a production regression.
- Only desktop and narrow native goldens changed intentionally after full fixture injection
  became available. Desktop adds the trusted toggle; narrow uses the host-owned rail layout.
  Actual/diff images were inspected before updating, and updated PNGs were inspected.
  Fullscreen/loading, twelve Chromium goldens and four original screenshots are unchanged.

The test fixture supplies its own native drawer focus trap; tests verify App Mode preserves
it and restores the trusted control after Escape. This does not establish current-site focus
trap compatibility. No production JS/CSS, IPC, host behavior, user settings or profiles changed.

## Measurement matrix and checks

| Native window width / theme / zoom | CSS viewport width | Expanded fixture state |
| --- | --- | --- |
| 390 / light / 1 | 390 | Drawer |
| 480 / dark / 1 | 480 | Drawer |
| 481 / light / 1 | 481 | Drawer |
| 680 / dark / 1 | 680 | Drawer |
| 1024 / light / 1 | 1024 | Docked |
| 1280 / dark / 1 | 1280 | Docked |
| 1024 / dark / 1.25 | 819 | Docked |
| 1280 / light / 1.25 | 1024 | Docked |

Each window is 728 DIP high; content is 688 DIP high before page zoom. All use display
scale 1. At zoom 1.25 the measured CSS height is 550 px. Closed workspace x is 60 CSS px.
Settled docked sidebar/workspace coordinates are 266.234/274.234 px at CSS width 1024,
307.188/315.188 px at CSS width 1280, and 240/248 px at CSS width 819. Settled inset is 8 px.
Drawer-open workspace x is 8 px. All sampled far edges stay fixed; horizontal overflow is zero.

Checks cover opening/closing intermediate layouts, both themes, real 100%/125% page zoom,
fixed trusted-toggle geometry, native caption height/zoom, and 52px rail geometry. Six
accepted rapid toggles with 35 ms pauses exercise mid-animation reversals at 680/1024.
The 680 case verifies native modal focus containment and Escape restoration. The 1024
case resizes open docked navigation to a 680px drawer and returns to desktop. Reduced-motion
frames must contain no compensation animation, and the rail transition duration must be zero.
Existing browser regressions additionally cover animation cancellation during responsive
replacement and transparent flex wrappers. These are real Electron views with synthetic
DOM handlers, not authenticated ChatGPT interactions or physical desktop-input acceptance.

Geometry sampling retains `pendingReconciliation` explicitly: an input task can change
native DOM between a frame callback and a timer. Those raw samples are not proof of a
painted jump. Continuity assertions operate on reconciled samples; pending samples remain
in the evidence. Docked cases additionally record actual Chromium compositor frames and
measure a fixture-only magenta marker at the workspace edge. Painted endpoints must match
DOM endpoints within raster rounding, intermediate positions must exist, and movement is
bounded against elapsed time and the existing 220ms easing. No app timing or screenshot
tolerance changed.

Do not run a separate page screenshot during compositor recording: investigation showed
that capture metrics could temporarily change at 125% zoom and yield misleading frame
coordinates. Docked intermediate PNGs now come directly from the recorded compositor
stream. Drawer screenshots keep animations enabled; their background can be obscured by
the native fixture modal, so they are not treated as unobstructed compositor evidence.

## Verification and limitations

| Executed check | Result |
| --- | --- |
| Existing boundary, reflow/reversal and responsive/reduced-motion regressions | 3 passed |
| Full fixture suite with exact native golden environment, updates disabled | 86 passed; no failures or skips |
| Final eight-case transition matrix after compositor/sampler refinement | 8 passed; no failures or skips |
| Evidence/privacy/CI contracts | 4 passed |
| Windows PowerShell 5.1 and PowerShell 7 source syntax | Both passed |
| Legacy fixture guard probe | Expected failure: Navigation API method unavailable |
| Native baseline comparisons before intentional update | Desktop/narrow differed as expected; fullscreen passed unchanged |

The full fixture run preceded the final measurement-only refinements in the new transition
spec; the final eight-case rerun verifies those refinements without repeating unrelated
checks. No production behavior changed, so `npm run test:all` was not repeated. Earlier
runtime/native-host results remain prior evidence, not new execution in this phase.

Diagnostic sampler runs exposed pending-DOM reads and screenshot/compositor metric
interference; a first marker attempt also lacked its intended containing block. Those
were test-instrumentation failures, corrected in the new test rather than attributed to
production. Final compositor runs preserve the stricter movement checks and pass. No
existing assertion or screenshot tolerance was relaxed.

Final reconciled opening steps were 2.4–9.9 CSS px per sampled interval. Docked compositor
recordings retained 22–25 opening frames, including actual intermediate positions; maximum
sample-to-sample displacement was 20–28.8 CSS px, with elapsed-time-aware bounds. Every case
recorded zero horizontal overflow; reduced-motion samples contained no compensation animation.
These sample counts and intervals are environment-specific, not a claim of a fixed frame rate.

Inspected all eight final opening images, 1024 closing/intermediate and settled composed
captures, the resized drawer, the two changed native golden PNGs and their pre-update diffs.
Intermediate native text can be occluded by the moving workspace or modal; this is documented
fixture reveal/overlay behavior, not a claim of zero occlusion at every animation instant.
Settled 1024 presentation has no duplicate rail or unintended workspace/sidebar gap. The
magenta edge marker is test-only instrumentation for compositor measurements.

[Full fixture review index](../test-results/visual-evidence/2026-11-07T10-28-34-276Z-56748/index.md)

[Final transition review index](../test-results/visual-evidence/2026-11-07T10-44-04-910Z-51072/index.md)

[Final transition manifest](../test-results/visual-evidence/2026-11-07T10-44-04-910Z-51072/manifest.json)

[Final measured matrix](../test-results/sidebar-transition/final-matrix-summary.json)

Files changed: `tests/helpers/navigation-fixture.cjs`, `tests/helpers/visual-evidence-reporter.cjs`,
`tests/visual-contracts.cjs`, `tests/visual/native.spec.js`, `tests/visual/sidebar-transition.spec.js`,
the desktop/narrow environment-specific native PNGs, this report and the remediation tracker.

The local Phase Two assessment is complete for the exercised isolated states. No production
correction is justified by the evidence. Current authenticated ChatGPT compatibility and
physical interaction quality remain outside the verified scope. The new eight transition cases do not
use animation-disabled golden comparison to claim smoothness. Their visual comparison
status is explicitly skipped; animation-enabled images are reviewed separately and geometry
assertions remain automated. The aggregate manifest therefore reports incomplete golden
coverage rather than converting those skipped comparisons into passed checks.

No confirmed product defect warrants a production correction. Authenticated current-site
animation quality, physical mixed-DPI, shell interactions, Pin/opacity endurance, U-01 and
live Share remain unverified here. Prior host results are prior evidence only. No Phase
Three work is included, and selection behavior is unchanged.
