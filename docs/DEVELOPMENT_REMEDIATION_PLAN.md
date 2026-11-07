# Development remediation tracker — Phases Zero and One

## Baseline and boundaries

The audited baseline was `08b89a0`. At implementation entry on 2026-11-07,
local `main`, HEAD and the locally recorded `origin/main` were all
`fbe1c9d8ab5fbd094f6cfaffeab9b2c1f7f50e8a`. The working tree was clean.
No network fetch or pull was performed, so origin/main is a local remote-tracking observation.
The startup, responsive layout, navigation-selection, transition and Share work
previously observed as dirty is already committed in this baseline; none is reimplemented.
Created `codex/visual-verification` from the current checkout without moving existing work.

This milestone changes tests, fixture helpers, evidence/reporting, CI artifact retention
and documentation only. Production files and the original four screenshots are preserved.
One primary implementation owner; no delegated agents or independent architecture review
were needed. No push, PR, merge, release, publication or deployment is authorized here.

## Issue registry

Statuses: UNVERIFIED, CONFIRMED, IN_PROGRESS, IMPLEMENTED, VERIFIED, BLOCKED,
DEFERRED, REJECTED. A historical report is not a current reproduction.

| ID | Priority / component | Evidence | Phase / owner | Status | Acceptance |
| --- | --- | --- | --- | --- | --- |
| V-00 | P1 / baseline | Clean fbe1c9d entry; prior dirty changes incorporated | 0 / primary | VERIFIED | Preserve baseline and identify milestone-owned changes |
| V-01 | P1 / Chromium goldens | Four original goldens; many geometry/capture-only tests | 1 / primary | VERIFIED | Twelve additional scenarios, inspect each, pass comparison without updates |
| V-02 | P1 / Electron composition | Existing startup desktopCapturer helper | 1 / primary | VERIFIED | Four native captures; owning-window, dimensions, regions, loading/fullscreen assertions; environment-controlled comparisons |
| V-03 | P1 / evidence | Existing output requires manual discovery | 1 / primary | VERIFIED | Versioned manifest, partial results, linked review index, explicit unavailable states |
| V-04 | P1 / CI evidence | No artifact upload at entry | 1 / primary | IMPLEMENTED | Allowlisted synthetic attachments only, seven-day failure retention; hosted execution explicitly unverified |
| V-05 | P1 / regression detection | New fixture and capture contracts | 1 / primary | VERIFIED | Actual four-pixel and missing-chrome negative probes fail; valid states pass |
| P-02 | P2 / transitions | Existing baseline implementation and tests | 2 / future owner | DEFERRED | Reproduce remaining issue before changes; do not reimplement accepted behavior |
| P-03 | P2 / selection | Existing conservative selection and SPA tests | 3 / future owner | DEFERRED | Assess current evidence before any change |
| P-04 | P2 / DOM compatibility | Site-dependent adapters, unsupported-markup fallback | 4 / future owner | UNVERIFIED | Confirm specific current defects before hardening |
| P-05 | P2 / startup | fbe1c9d startup readiness and recovery tests | 5 / future owner | DEFERRED | Reuse completed implementation; measure any remaining defect |
| P-06 | P2 / keyboard and window behavior | Roadmap proposal | 6 / future owner | DEFERRED | Owning-window actions, no duplicate shortcuts, preserved security |
| P-07 | P2 / performance | Existing measurement harnesses | 7 / future owner | DEFERRED | Demonstrated bottleneck and before/after measurements |
| P-08 | P2 / diagnostics | Roadmap proposal | 8 / future owner | DEFERRED | Accurate safe status reporting and isolated live checks |
| P-09 | P3 / structure | Incremental refactoring proposal | 9 / future owner | DEFERRED | Stable behavior and focused equivalent coverage |
| P-10 | P3 / optional features | Roadmap proposals | 10 / future owner | DEFERRED | Separate product decision after preceding accepted phases |
| R-01 | P2 / physical acceptance | RELEASE_VALIDATION.md; historical evidence only | 12 / future owner | UNVERIFIED | Physical mixed-DPI, shell interactions, 30-minute Pin/opacity session and U-01 follow-through |
| R-02 | P2 / native Share | STARTUP_RESPONSIVE_STABILIZATION.md; historical native no-op | Later / future owner | UNVERIFIED | Renewed isolated live reproduction and Share-dialog success |

## Work packages and rollback

Phase Zero records source and prior evidence without a baseline-wide rerun.
Phase One preserves existing test names and assertions, extracts only navigation markup
and the native capture helper, and adds twelve Chromium and four native scenarios.
Rollback consists of reverting only milestone-owned commits or explicit hunks; never
reset source, profiles, configuration, prior snapshots, or unrelated changes.
The integration gate is test:all plus both PowerShell syntax passes, screenshot inspection,
negative probes, and diff review. Phase Two does not start automatically.

Milestone-owned files:

- Test commands/configuration: `package.json`, `playwright.config.js`, `.github/workflows/quality.yml`.
- Existing-test helper extraction: `tests/visual.spec.js`, `tests/startup.cjs`.
- Helpers: `tests/helpers/navigation-fixture.cjs`, `visual-fixture.cjs`, `window-capture.cjs`,
  `composition-check.cjs`, `visual-evidence-reporter.cjs`.
- New suites/contracts: `tests/visual/chromium.spec.js`, `tests/visual/native.spec.js`,
  `tests/visual-contracts.cjs`.
- New approved images: twelve PNGs in `tests/visual/chromium.spec.js-snapshots/` and four
  environment-specific PNGs in `tests/visual/native.spec.js-snapshots/`.
- Documentation: this tracker and `docs/VISUAL_TESTING.md`.

## Current verification

Current focused results: all sixteen new visual scenarios passed with snapshot updates
disabled and the exact native environment enabled. Node contract tests passed. JavaScript
and PowerShell syntax passed under Windows PowerShell 5.1 and PowerShell 7. A title-declaration
comparison preserved all 55 existing test-title declarations; the existing four PNGs are unchanged.
The full integration checkpoint below is complete.

Inspected every new Chromium golden: home-expanded-light, home-compact-dark,
conversation-expanded-dark, conversation-compact-light, project-navigation-light,
search-modal-dark, compact-390-light, compact-390-dark, home-480-light, home-481-light,
conversation-680-dark and selected-focus-light. Inspected all four final native goldens:
desktop, narrow, loading and fullscreen, including regenerated ready-state images.

The initial native conversation fixture incorrectly loaded home, and the initial loading
fixture was already eligible for recovery. These were test-fixture defects, corrected
without production changes. The project fixture was expanded to show actual project rows.
An initial trace-start error was resolved by explicitly disabling automatic tracing only
for the new manually traced Chromium context. No tolerance was increased.

Image findings: workspace and sidebar boundaries align; long navigation labels truncate
intentionally; 390px content wraps within bounds; 480/481px home layouts remain continuous;
the selected Library rail item retains a visible focus outline. Search delegation expands
the native sidebar before the modal opens, and its actual docked state is recorded. Trusted
caption controls remain visible in ready/loading windows and are absent in fullscreen.
Cyan/green squares are intentional test instrumentation; the green marker overlays a small
part of synthetic message text in the narrow native image. No unrelated production defect
was confirmed, and none was silently fixed.

The live four-pixel workspace probe failed comparison with 3,795 differing pixels.
Its expected/actual/diff images were inspected; the retained trace is linked from the
sanitized review index. The live missing-chrome probe failed with `Trusted chrome marker
missing`; the retained image was inspected and still contained the remote green marker.
Both probes used comparison-only mode, returned exit code 1 as expected, and were disabled
for normal verification. Contract tests additionally reject missing content, blank/wrong-size
captures, incorrect ownership, loading leakage, arbitrary profile JSON/database attachments,
and CI regeneration. Interrupted/unexecuted evidence remains explicitly unavailable.

Native environment: Windows 10.0.26200, Electron 44.10.0, scale factor 1; external Node
22.23.2 and Playwright 1.64.0. Actual ready captures are 1280×900 and 390×850 pixels;
loading is 680×700; fullscreen is 1920×1080. View bounds separately verify the 40 DIP title
bar, full loading cover, fullscreen zero-height chrome, and controls zoom factor 1.

No production profile or authenticated live data was used. All evidence is synthetic.
Hosted CI upload execution remains unverified because nothing was pushed or dispatched.
The upload path, attachment allowlist and seven-day retention are verified locally.
Different Windows/runtime/scale combinations require their own native baseline approval;
physical mixed-DPI, U-01, extended opacity and live Share acceptance remain historical,
unverified follow-up conditions. This milestone does not establish release acceptance.

## Final integration and delivery

| Executed check | Current result |
| --- | --- |
| `npm run test:visual -- --update-snapshots=none`, exact native environment enabled | 16 passed; no baseline updates |
| `npm run test:all`: fixture/visual stage | 78 passed (62 existing, 12 new Chromium, 4 new native) |
| `npm run test:all`: runtime stage | 17 passed, including four new visual infrastructure contracts |
| `npm run test:all`: native-host stage | 13 passed, including actual desktop window actions/resizing, sandbox, startup and recovery |
| Integration command exit | 0; no failures, cancellations or skips in any stage |
| Windows PowerShell 5.1 / PowerShell 7 syntax | Both passed |
| Four-pixel workspace negative probe | Expected exit 1; 3,795-pixel screenshot difference detected |
| Actual native missing-chrome negative probe | Expected exit 1; missing trusted pixels rejected |
| Diff/source boundaries | `git diff --check` passed; no production or original baseline changes |

The integration manifest records the tested baseline commit plus dirty milestone state,
with snapshot update mode `none`. It reports `overall: passed`, `coverageResult: passed`,
and sixteen passed visual results. Testing was completed before the task-owned commit;
the commit records the implementation and this report. No remote action was taken.

- [Integration review index](../test-results/visual-evidence/2026-11-07T09-23-26-841Z-54360/index.md)
- [Integration manifest](../test-results/visual-evidence/2026-11-07T09-23-26-841Z-54360/manifest.json)
- [Workspace regression probe evidence](../test-results/visual-evidence/2026-11-07T09-20-07-540Z-47112/index.md)
- [Native missing-chrome probe evidence](../test-results/visual-evidence/2026-11-07T09-20-45-018Z-31780/index.md)

Phase Zero is verified. Phase One meets its local acceptance checks. Hosted artifact
upload/retention execution remains unverified and requires a later authorized hosted
run; full hosted-CI acceptance is therefore pending. Phase Two was not started.
