# Targeted stability remediation — 2026-11-06

Baseline and working base: `main` at `bda2ef0be63a2db53f382fa49605fa0d417d2da2`. The checkout was clean before this task. One primary agent worked sequentially. No runtime dependency, appearance, native navigation design, production profile, or private user data was changed. The implementation is recorded in the locally committed change groups below; no merge, push, publication or deployment occurred.

## Findings disposition

| Item | Disposition / root cause | Correction and affected source | Evidence |
| --- | --- | --- | --- |
| A1 | Confirmed: incidental command-line substring authorized a stale-process kill; the exception path also killed without verification. | `tools/ChatGPT-AppMode.Helpers.ps1`: exact supported executable and explicit File grammar, normalized full server path, duplicate/ambiguous rejection, fresh creation-time/identity checks and held process object; stale-check errors fail closed. Transport source participates in freshness checks. | `ServerOwnership.Tests.ps1`: PS5.1/7 forms, quoted/unquoted paths, incidental references, lookalikes, duplicate flags, ambiguous matches, changed/exited/reused processes; every stop in those checks is mocked. `ServerOwnership.Smoke.ps1` additionally verifies actual shell images, CIM timestamps and held-handle termination against task-created sleeping scripts only. |
| A2 | Confirmed: `Number()` could supply NaN to Electron and malformed JSON prevented launch. | `WindowHost/config.cjs`, `main.cjs`: in-memory compatible defaults, finite integer bounds, size limits, exact zero positions, matching-display clamping, fixed diagnostics. No configuration rewrite. | `remediation.cjs`: malformed JSON, invalid/missing values, extremes, negatives, offscreen and negative-origin work areas. Physical multi-monitor/DPI acceptance remains separate. |
| A3 | Confirmed: accessible labels were interpolated into a regex. | `extension/scripts/chatgpt-overrides.js`: escape literal labels before matching; native delegation/account access retained. | New browser regression covers parentheses, brackets, plus, period, backslash, Unicode and profile labels; existing account tests. |
| A4 | Confirmed with delayed-response reproduction: initialization could overwrite pushed state; action completion could undo newer modal blocking. | `controls-preload.cjs`: drop initialization after a push, deactivate unsubscribed callbacks. `controls.js`: completion derives disabled state from latest navigation and pending actions. No new channel/privilege. | Deferred preload unit test, caption modal-completion browser test, existing host Pin/maximize/sidebar/navigation/reload/window lifecycle tests. |
| B1 | Partially confirmed: duplicate Pin/Share/header discovery and timer work measured; document observers also cover necessary rerenders. | Coordinator coalesces mutation work per frame and shares Pin/Share header lookup; Pin timer scans only for missing control. `30-share.js`, `50-pin.js`, `header.js`, `controls-host.cjs` ignore the invisible theme probe's own work where appropriate. Sidebar adapter remains read-only and its lifecycle observers remain. | Nine synthetic scenarios below; bounded burst test, repeated injection and existing navigation regressions. No claim of production application CPU reduction. |
| B2 | Confirmed: unchanged native events repeatedly assigned bounds/zoom and sent identical state; theme/navigation updates called layout. | `controls-host.cjs`: separate changed-state publication from cached geometry; set zoom only if different. Conservative theme sampling remains for upstream compatibility. | Deterministic native-call counters below; real host geometry/theme/fullscreen/zoom checks. |
| B3 | Confirmed: idle 16 ms maintenance queried pointers and reapplied identical alpha. | `Start-ChatGPT-TopMostServer.ps1`, `tools/AppMode.Windows.ps1`: task-completion waits, adaptive 16/50/250 ms maintenance, lazy pointer queries, unchanged-alpha suppression. Acceptance review also corrected a rapid off/on invalidation race: the request handler now restores and clears both maps through the existing ownership-checked cleanup helper. Fresh HWND/PID checks retained. Config/window refresh stays 1 s, retention/placement 3 s; per-request policy/ownership reads intentionally retained. | Isolated process CPU/network measurements and deterministic opacity scenarios below; runtime multi-window/pointer/reversal/shutdown/restart tests. |
| C1 | Confirmed: broad silent catch hid failed injection stages; asynchronous stages were not each document-bound. | `WindowHost/injection.cjs`, `main.cjs`, `controls-host.cjs`: fixed stage codes, stop remaining stages, generation/origin checks before each stage. Independent trusted controls remain mounted; ordinary reload gets a fresh document. Timing remains did-finish-load; no speculative earlier injection. | Stage fault/stale-document/reload helper tests; content reinjection test and native host reload checks. No claim that startup layout shift was measured or eliminated. |
| C2 | Confirmed: incomplete requests monopolized the maintenance loop for about 2 s. | `tools/AppMode.RequestBuffer.cs`, server: max 16 bounded asynchronous buffers, 2 s connection deadline, socket-completion wakeup, original strict parser on the main thread. | Incomplete headers and bodies no longer block a normal request; original Host/Origin/PNA/framing/body/timeout/security suite retained. |
| C3 | Confirmed: optional Jump List exception aborted command dispatch. | `TaskbarLauncher/Program.cs`: registration-only failure boundary and sanitized diagnostic; normal commands continue; register-only returns nonzero on failure. Launch exceptions remain outside the catch. | Actual C# build; reflected registration helper; compiled dispatcher probes for success/unavailable/throwing registration and app/new-session/shortcut/register-only commands with side effects replaced. |
| D1 | Confirmed: no workflow existed at the baseline. | `.github/workflows/quality.yml`: Windows 2022/Node22, npm ci, Chromium install, JS/PS syntax, visual/runtime/supported host suites. No credentials/profile artifacts. | Local supported checks; actual hosted run remains unverified until authorized push. Two foreground desktop checks explicitly excluded only in CI mode. |
| D2 | Confirmed coverage gaps. | Focused `remediation.cjs`, PowerShell tests and additions to runtime/visual suites. IPC rejection tests run without desktop input even when full host interaction is skipped. | Validation results below. No unrelated snapshots updated. |
| D3 | Unconfirmed: no additional compact-navigation lifecycle defect reproduced. | Accepted compact flyout/native-drawer implementation intentionally retained. | Existing rapid activation, resize, route/replacement, modal/focus, disclosure, theme and unknown-markup regressions; isolated live status below. |
| D4 | Confirmed: limitations claimed a 200 ms poll despite the 16 ms implementation. | Architecture, Known Limitations, Visual Testing and this report now describe adaptive scheduling, CI boundaries, diagnostics and measurements. | Source cross-check, documentation links and whitespace review. |

## Performance comparison

Node 22.23.2; installed lockfile runtimes. Browser counters use headless synthetic ChatGPT-shaped pages. Each active workload applies 40 updates at roughly 25 ms intervals; streaming inserts eight synthetic nodes per update. Idle samples are about 2.1 seconds. Helper executions include Pin/Share/sidebar/home helpers, not just top-level reconciliation passes. Times are summed helper wall time, not renderer CPU. Counters add overhead; counts are stronger evidence than small timing differences. The idle-long sample includes settlement after inserting 500 synthetic paragraphs. No page text, titles, private URLs or account data is reported.

| Scenario | Observer callbacks/s, before → after | Helper calls/s, before → after | Helper time ms | DOM scans | Computed styles | Sampler results |
| --- | --- | --- | --- | --- | --- | --- |
| idle-home | 0.0 → 0.0 | 2.8 → 0.0 | 0.5 → 0.0 | 36 → 0 | 12 → 0 | 0 → 0 |
| idle-long | 0.0 → 0.0 | 3.8 → 0.9 | 1.0 → 0.3 | 62 → 17 | 24 → 5 | 0 → 0 |
| streaming | 179.5 → 179.3 | 231.9 → 118.1 | 51.7 → 18.3 | 2357 → 1200 | 1304 → 760 | 0 → 0 |
| sidebar | 235.6 → 197.6 | 322.2 → 120.5 | 50.8 → 18.9 | 2394 → 1242 | 1481 → 934 | 29 → 27 |
| compact-expanded | 240.7 → 214.7 | 331.9 → 124.4 | 49.5 → 16.0 | 2471 → 1259 | 1526 → 960 | 30 → 30 |
| dialogs | 174.9 → 177.6 | 225.1 → 118.4 | 34.0 → 13.9 | 2367 → 1240 | 1561 → 920 | 0 → 0 |
| theme | 236.5 → 236.3 | 290.5 → 118.2 | 74.8 → 17.2 | 2653 → 1240 | 1937 → 1160 | 40 → 40 |
| resize | 229.9 → 218.6 | 232.9 → 54.7 | 26.4 → 15.6 | 1658 → 1053 | 1571 → 1326 | 39 → 39 |
| scroll | 0.0 → 0.0 | 2.2 → 0.0 | 0.4 → 0.0 | 370 → 351 | 283 → 273 | 0 → 0 |

Streaming helper calls fell from 314 to 160 and DOM scans from 2357 to 1200. Idle-home periodic scan work fell from 36 scans to zero in the measured interval. Observer callbacks need not fall proportionally: lifecycle notifications remain covered. Changes to native themes still reach the sampler; unchanged geometry is no longer reapplied.

The deterministic title-bar event harness delivered 100 unchanged movement events: view-bound writes **200 → 0**, zoom assignments **100 → 0**, IPC publications **100 → 0**. A Pin change plus real width change still caused one changed-state publication and two view-bound writes. This harness measures eliminated native calls, not OS execution time.

The isolated server was warmed up for 2.5 seconds before sampling. It used an explicit synthetic installation root so normal CIM ownership discovery still ran, with no matching owned windows. Samples are single local observations, not a statistical benchmark; concurrent machine load and CIM timing can change CPU results.

| Service workload | Before | After |
| --- | --- | --- |
| Fade disabled, idle process CPU | 156.250 ms / 4.294 s | 109.375 ms / 4.277 s |
| Fade enabled, no owned windows, process CPU | 343.750 ms / 4.364 s | 140.625 ms / 4.244 s |
| Normal request behind an incomplete header | 2145 ms | 2 ms |
| Twenty sequential unbound topmost status requests | 7599 ms | 6718 ms |


| Five simulated seconds | Maintenance ticks before → after | Pointer queries | Opacity writes |
| --- | --- | --- | --- |
| empty | 313 → 20 | 313 → 0 | 0 → 0 |
| disabled | 313 → 20 | 313 → 0 | 0 → 0 |
| unpinned | 313 → 20 | 313 → 0 | 0 → 0 |
| pinned | 313 → 121 | 313 → 121 | 313 → 20 |
| transition | 313 → 122 | 313 → 122 | 313 → 20 |
| pointer | 313 → 226 | 313 → 226 | 313 → 129 |
| multiple | 313 → 121 | 313 → 121 | 626 → 40 |

Opacity counters use deterministic native doubles. Pointer changes still start eased transitions, active transitions retain 16 ms scheduling, and runtime tests assert independent windows, interaction holds, unpin/disable restoration and graceful shutdown. They do not establish subjective smoothness, real pinned-window CPU or all Windows focus policies. The service CPU runs use no matching owned windows; frequent topmost requests therefore exercise rejection/discovery, not mutation of real windows.

Reproduce using the opt-in commands in [Visual testing](VISUAL_TESTING.md#ci-and-targeted-performance-checks). Numeric raw results remain local under ignored `test-results/`; no production instrumentation is installed.

## Validation

| Command | Result / scope |
| --- | --- |
| `npm test -- --grep "content script reinjection\|compact\|sidebar\|account\|navigation"` | 35 focused visual tests passed. |
| `npm test -- --grep "sidebar labels are literal"` | 1 passed after fixing the isolated-world test harness. |
| `npm test -- --grep "native title buttons stay left aligned"` | 1 passed after waiting for the new spacer's reconciliation marker; geometry assertions unchanged. |
| `npm run test:all` | Final aggregate run passed: 56 visual, 12 runtime/release, 7 host tests; no skipped tests. |
| `npm run test:runtime` (final affected-layer rerun) | 13 passed, including the added real-shell ownership smoke test; no skipped tests. Visual/host results above are reused from the aggregate run, before this final ownership test addition and the early executable-name rejection. No page/native-control behavior changed in that follow-up. |
| `powershell.exe -NoProfile -File tools/check-syntax.ps1` | Passed JavaScript and Windows PowerShell 5.1 syntax checks. |
| `pwsh.exe -NoProfile -File tools/check-syntax.ps1` | Passed JavaScript and PowerShell 7 syntax checks. |
| `pwsh.exe -NoProfile -File tests/ServerOwnership.Tests.ps1` | Passed synthetic ownership checks under PowerShell 7 as well as the Windows PowerShell invocation in the runtime suite. |
| `git diff --check` | Passed. |
| C# build validation | Runtime tests invoke `Build-TaskbarLauncher.ps1 -SkipRegistration -OutputPath <disposable path>`, compile the command-dispatch probe, and compile/use the asynchronous request buffer. Passed. |
| Performance commands | All before/after harness commands documented in Visual Testing executed successfully. Supplemental PowerShell 7 direct-runtime server run served normal traffic behind a slow client in 4 ms and completed 20 status requests. No cross-shell CPU comparison is claimed. |

Earlier aggregate attempts exposed two test-harness failures: accessing extension state from the wrong JavaScript world, and measuring a newly inserted spacer while waiting on a retained marker from the previous iteration. Both were corrected before the successful aggregate run; no application geometry assertions or snapshot baselines were relaxed. The final shell investigation verified that this machine's `pwsh.exe` launcher image is itself valid. Production shell selection was preserved; optional benchmark normalization uses the runtime directly because launcher-based CPU samples were unreliable. No zero-CPU launcher sample is used as performance evidence.

The native host suite exercised real isolated caption actions, Pin, dragging, resizing, focus, navigation, reload/window lifecycle, zoom/fullscreen and security rejection paths. Synthetic title-bar images at 390 and 1280 pixels and masked live captures at all three widths were inspected. This does not substitute for the manual coverage limits below.

## Remaining risks and repository state

Authenticated isolated Electron blank-home review passed at 1280, 680 and 390 DIP window widths. Four alternating open/close transitions at each width used the page's native adapter; drawers were dismissed with their own native close controls, preserving the documented focus-trap boundary. Every transition was accepted. Account forwarding opened the native menu and the masked screenshot visibly showed **Log out**. Reload restored one rail and one page-Pin instance; all three widths reported ready navigation and no injection diagnostic codes appeared. The host stylesheet continued to hide the page Pin duplicate. Captures and numeric-only records remain local under `test-results/remediation-live*`. No private page labels, conversation URLs or DOM dumps were saved. Existing review configuration/command/measurement files were preserved, and the task-created review window was closed. This was a blank-home/sidebar/account check, not a complete live theme/flyout/conversation matrix; real injection-stage failure recovery was tested with doubles rather than deliberate failures in this authenticated window.

The workflow has not executed on GitHub; hosted visual/font behavior and supported native checks need its first run. The environment flag excludes only the full foreground native interaction sequence and the tray desktop test. It never overrides security/foreground checks. Real multi-monitor work areas/DPI, Windows snapping, prolonged multiple-window opacity interaction and abrupt-process recovery acceptance remain manual. No authenticated production-profile test was performed or permitted. Cold-start layout-shift performance was not quantified. Config/CIM and history policy are deliberately not cached across requests, so frequent request cost remains appreciable.

The remediation is committed locally on `main`, based on the audited commit. No user changes existed before the implementation task. No branches were merged, nothing was pushed, and no artifacts were deployed. Code groups correspond to safety/correctness, measured performance, and reliability/CI/documentation. The changed source/test paths are named in the disposition table; inspect the local diff before committing.

## Changed files

34 task-owned source, test, workflow and documentation files; no generated or private data files are included.

```text
.github/workflows/quality.yml
Start-ChatGPT-TopMostServer.ps1
TaskbarLauncher/Program.cs
WindowHost/config.cjs
WindowHost/controls-host.cjs
WindowHost/controls-preload.cjs
WindowHost/controls.js
WindowHost/header.js
WindowHost/injection.cjs
WindowHost/main.cjs
docs/ARCHITECTURE.md
docs/KNOWN_LIMITATIONS.md
docs/STABILITY_REMEDIATION.md
docs/VISUAL_TESTING.md
extension/scripts/30-share.js
extension/scripts/50-pin.js
extension/scripts/chatgpt-overrides.js
package.json
tests/Runtime.Tests.ps1
tests/ServerOwnership.Smoke.ps1
tests/ServerOwnership.Tests.ps1
tests/Taskbar.Optional.Tests.ps1
tests/remediation.cjs
tests/runtime.cjs
tests/visual.spec.js
tests/window-host.cjs
tools/AppMode.RequestBuffer.cs
tools/AppMode.Windows.ps1
tools/ChatGPT-AppMode.Helpers.ps1
tools/check-syntax.ps1
tools/measure-controls.cjs
tools/measure-opacity.ps1
tools/measure-remediation.cjs
tools/measure-server.cjs
```

## Final targeted acceptance review

GPT-6.1 Sol, High reasoning, independently reviewed only the uncommitted remediation against `bda2ef0` and directly necessary context. The review covered finding disposition, security/ownership/IPC/origin/profile boundaries, resource cleanup, failure handling, behavior preservation, meaningful regression coverage and Windows CI. No general repository audit was performed.

One blocking regression was reproduced and corrected before acceptance: restoring a faded window on `/topmost off` did not clear `appliedAlpha`, so a following `/topmost on` before maintenance could incorrectly skip fading. The handler now uses the existing ownership-revalidating `Update-AppModePinnedOpacity -Restore` path. The regression drives real request-handler off/on calls between synthetic ticks, checks target cache/hold invalidation, preserves another binding's hold, and verifies restored 100% followed by the expected 30% fade.

Review verdict: **passes; no remaining blocking findings**. `npm run test:runtime` passed **13/13, no skips** after the correction. Local CI-mode checks (`APP_MODE_NONINTERACTIVE=1`) passed runtime **12 with one documented skip** and host **6 with one documented skip**; native foreground/IPC guards were not bypassed. The earlier 56 visual / 7 full native-host and authenticated isolated live results remain prior evidence; no page or caption behavior changed during acceptance. Hosted execution and physical multi-monitor/DPI/prolonged multi-window checks remain separate validation requirements.

The corrective opacity change affects the request-handler restore path only; the recorded steady-state and synthetic workload measurements remain prior evidence and were not rerun during acceptance.

Commit groups are organized by subsystem so each implementation commit has its required source dependencies; the final CI/docs group registers the combined focused regression harness. Commit identifiers are listed below after creation.

| Commit | Group |
| --- | --- |
| `6dfa226` | Control-server ownership, adaptive scheduling, bounded asynchronous request buffering and opacity invalidation regression. |
| `7f69167` | Native configuration/state synchronization, page injection recovery and coalesced page integration. |
| `b71a5f7` | Optional taskbar registration failure boundary and command-dispatch protection. |
| CI/docs commit containing this report | Windows quality gate, combined focused regression runner and final validation documentation. |

The reviewer and primary inspected the staged subsystem groups; only the implementation's task-owned files/hunks were committed. Hosted CI status will be verified separately after the authorized push; no deployment or release is part of this acceptance.
