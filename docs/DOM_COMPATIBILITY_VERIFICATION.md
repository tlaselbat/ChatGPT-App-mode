# Phase Four: DOM compatibility verification

## Baseline and boundaries

Started from clean accepted Phase Three commit
`a2f015e65a8ffc331918c59215612363e9c24b1b` on the new local branch
`codex/dom-compatibility-verification`. Accepted branches, snapshots, evidence and
persistent review profiles were preserved. No remote operation, profile reset,
dependency/production-configuration change, IPC addition or UI redesign was performed.
One primary agent owned investigation, the bounded correction and verification.

## Isolated live-review investigation

No running isolated review process was found at the start. The unchanged
`node tools/live-host-review.cjs` launched the existing dedicated review profile;
the loopback diagnostic endpoint on port 9223 responded after approximately six
seconds. The listener's PID and command line matched the launched Electron process,
`--live-review`, and `test-results/live-review-profile/native-host`. No production
profile was accessed, copied or reset, and no unrelated process was terminated.

Current isolated authenticated access was restored. Opening the native account menu
on blank home exposed visible Settings and Log out. The masked 680x810 content-view
capture was inspected and contains those fixed public labels without account or
conversation text. After dismissing the menu/drawer, the page reported sidebar
`ready`, navigation `compact`, one compact action rail and one marked page header.
This establishes that limited current authenticated state, not full ChatGPT compatibility.

Safe local evidence, excluded from synthetic CI uploads:

- [Masked authentication capture](../test-results/live-audits/phase4-compatibility-E5n5oW/authenticated-account-masked.png)
- [Sanitized diagnostic summary](../test-results/live-audits/phase4-compatibility-E5n5oW/diagnostics.json)

Browser-level window-bounds discovery returned an unsupported CDP method. No protocol,
configuration or privilege change was made to expand this investigation. No live width,
theme, zoom, transition, reversal or focus matrix was completed. The earlier endpoint
failure cannot be assigned a proven historical root cause: the former process was no
longer running, and a fresh launch now works. No infrastructure defect or correction
was established. The review process/profile were preserved; the diagnostic client
disconnected and ephemeral masking was removed.

## Findings and correction

| Classification | Finding | Result |
| --- | --- | --- |
| Confirmed production discovery weakness, reproduced synthetically | `nativeSidebarControl` considered same-named buttons in ordinary `main` content before the actual navigation control. Both 390px and 1280px fixtures returned `content-decoy` instead of `correct-search`. | Added five predicate/comment lines in `10-sidebar.js`: exclude menus, unrelated dialogs, and ordinary main content; retain contextual headers and native navigation containers. Correct native Search delegation now occurs, with zero decoy clicks. Not reproduced against private live content. |
| Existing protection sufficient | Disabled, aria-disabled, hidden and inert copies; detached native control replacement | New regression checks select the connected usable native source. Existing responsive tests cover retained desktop controls after narrowing. |
| Existing protection sufficient | Native disclosure/account authority, unrelated modal isolation, header replacement, bounded reconciliation, reinjection | Focused existing checks passed; no production correction to these mechanisms. |
| Existing protection sufficient | Home replacement, SPA departure, unsupported structure, repeated injection | Owned markers on previously tracked detached nodes are released; unsupported native editor remains editable and one rail remains. No home code change. |
| Existing protection sufficient | Share completion after SPA navigation and header replacement | Old focus observer is cancelled, old button disconnected, replacement source authoritative, no stale menu or focus theft. No Share/coordinator code change. |
| Synthetic fixture mistakes, corrected | Initial home replacement copied extension markers; initial supposed unsupported layout actually had valid separate hero/form branches. | Replacement now models native rendering without extension attributes; unsupported form puts title and editor in the same branch. Neither initial failure is claimed as a product defect. |
| Unverified risk | Arbitrary future site markup, duplicate controls inside otherwise recognized header/navigation containers, full live responsive compatibility | Finite fixture coverage does not prove all possible markup. Unknown cases are not represented as passing coverage. |

The correction changes discovery eligibility only. Native controls, listeners, state,
disclosures, routes, history, Share and Pin delegation remain native-owned. No nodes
are moved or cloned by the production correction. The test deliberately reorders
synthetic content to expose document-order ambiguity, then restores normal composition
before the final captures. No golden screenshot or comparison tolerance changed.

## Verification and evidence

Four new tests in `tests/visual/compatibility.spec.js` use canonical Playwright Chromium,
disposable contexts and synthetic routes. Unexpected network requests are blocked;
the only fulfilled requests are the fixture document and a fixed synthetic loopback
response. Ordered script injection mirrors host execution, with the existing stylesheet.

- Existing focused compatibility selection: **8 passed**.
- Initial duplicate-label reproductions: **failed as expected** at 390 and 1280;
  the selected ID was `content-decoy` in both cases. Preserved under
  `test-results/runs/phase4-reproduction/`.
- Corrected focused suite: **4 passed**, including the original failure assertions,
  native action/dead-copy checks, home lifecycle and delayed Share completion.
  Final styled output: `test-results/runs/phase4-evidence-final/`. A final metadata-only
  addition records behavior as `passed` and geometry/visual comparison as `skipped`;
  the four-test rerun passed and all attached artifact references resolve.
- Windows PowerShell 5.1 and PowerShell 7 syntax checks: **passed**.
- Full fixture stage: **92 passed**, including all existing assertions and four
  new tests. Twelve Chromium golden comparisons passed; four native composition
  behavioral/geometry checks passed. Native golden comparisons are **unavailable**
  without the explicit approved environment fingerprint. The evidence manifest's
  `overall` is `passed`; `coverageResult` remains `unavailable` by design.
- Runtime stage: **17 passed**, including rejection-path IPC/origin/profile checks
  and all four visual evidence/composition/failure-upload contracts.
- Host stage: **13 passed, zero skipped**, including the real native interaction
  sequence for sandbox, caption controls, window actions, navigation and resizing.
  Host output is under `test-results/runs/native-host-a2zKKK/`; geometry relaunch
  measurements are under `test-results/runs/geometry-host-zWxFj7/`.

[Full integration visual index](../test-results/visual-evidence/2026-11-07T21-20-52-067Z-35484/index.md)
and [manifest](../test-results/visual-evidence/2026-11-07T21-20-52-067Z-35484/manifest.json).
[Final focused compatibility index](../test-results/visual-evidence/2026-11-07T21-30-47-016Z-55524/index.md)
and [manifest](../test-results/visual-evidence/2026-11-07T21-30-47-016Z-55524/manifest.json).

The full checkpoint executes the three `test:all` constituent commands sequentially,
with `npm test -- --output=test-results/runs/phase4-integration` for the fixture stage.
This preserves prior `test-results/runs/` evidence that Playwright's default output
cleanup would otherwise remove. Runtime and host commands are unchanged. Live
interactions finished before headed tests; native desktop-input checks run separately.

Screenshots inspected: masked authenticated account menu; initial 390px and 1280px
duplicate-label failure images; initial home fixture failure; intermediate unstyled
390px/1280px captures; final styled 390x850 and 1280x850 compatibility captures.
The final desktop fixture has aligned navigation and composer boundaries with expected
ellipsis clipping. The narrow synthetic drawer shows its Close control touching the
identity label; this pre-existing fixture/layout finding is separate from the discovery
correction and was not silently repaired. The artificially reordered and unstyled
early diagnostic captures are not visual baselines. Masked live capture excludes icons
and private text, so it supports authentication/structure only, not complete appearance.
No difference images were generated by the focused checks.

All four integration native compositions were also inspected: desktop 1280x900,
narrow 390x850, loading 680x700 and fullscreen 1920x1080. Ready windowed captures
contain the trusted caption and remote-content regions with both ownership markers;
loading shows the trusted cover without leaked content; fullscreen exposes remote
content at y=0 with no caption. Markers intentionally cover small areas. Caption
controls, workspace boundaries and narrow rail are visible as expected. These are
synthetic composition checks, not physical DPI or authenticated-site evidence.
The host suite's `native-header-desktop.png` and `native-header-narrow.png` were
also inspected: trusted caption controls remain visible, synthetic content stays
within its viewport, and the narrow keyboard-focus outline is visible.

## Acceptance and integration recommendation

Phase Four's local compatibility scope is verified. The original duplicate-label
failure is resolved, all full-checkpoint constituents passed (92 fixture, 17 runtime,
13 host), focused evidence metadata was rerun successfully, syntax and whitespace
checks passed, and accepted snapshots remain unchanged. This checkpoint executed
the full `test:all` contents with the output-path preservation described above,
not the literal aggregate npm command. Evidence records the pre-commit accepted
HEAD plus `dirty: true`, accurately identifying verification of the working changes.

Recommend the Phase One–Four implementation chain for integration through a reviewed
PR, subject to separate authorization and normal hosted checks of the final commit.
This is a code-integration recommendation, not release acceptance. The current
environment has verified native composition but no approved native pixel fingerprint.
Authenticated blank-home access is available;
authenticated sidebar transition/selection matrices and live Share remain unverified.
Physical mixed-DPI acceptance, prolonged Pin/opacity endurance and U-01 remain open.
Earlier hosted artifact upload/retention acceptance remains prior evidence, not a new
hosted result for this branch. No release-ready conclusion follows from synthetic tests.

Stop after Phase Four. A reviewed integration PR is the next possible delivery step
only after separate authorization; no push, PR, merge, publication or deployment is
authorized or performed here. Phase Five has not started.
The accepted implementation chain is `7553aa6` → `278e459` → `a2f015e` → Phase Four.
The separate `f6d558d` controlled hosted artifact-probe branch is outside this chain
and must remain excluded from integration.

Task-owned files: `extension/scripts/10-sidebar.js`,
`tests/visual/compatibility.spec.js`, this report, and
`docs/DEVELOPMENT_REMEDIATION_PLAN.md`. They are cleanly separable from prior work
because the starting tree was clean. The final delivery records these in one local
commit on `codex/dom-compatibility-verification`; no generated evidence is committed.
