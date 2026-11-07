# Visual testing workflow

## Structured synthetic visual verification

Run `npm run test:visual -- --update-snapshots=none` for the twelve Chromium goldens
and four composed Electron scenarios. The new Chromium suite always uses Playwright's
bundled browser; `APP_MODE_CHROMIUM_EXE` remains available to the original suite only.
Both suites retain the existing 50-pixel limit. The original four baselines and test
names are preserved. Shared navigation markup and native capture helpers are under
`tests/helpers/`; production injection and security policies are unchanged.

The synthetic scenarios cover desktop home/conversations, expanded/compact navigation,
project navigation, Search, 390px light/dark, 480/481px home, 680px conversation and
selected navigation with keyboard focus. Dimensions are CSS pixels for Chromium.
Electron uses 1280×900 and 390×850 DIP windows, a 680×700 loading window, and a fullscreen
window whose measured size is the current display size. Page zoom is 1. These are not
physical mixed-DPI acceptance checks.

Native capture targets the exact fixture window media-source ID and validates its
dimensions, independent view roles/bounds, a cyan trusted-chrome marker and a green
remote-content marker. Loading must obscure the green marker and magenta underlay;
fullscreen must hide the chrome marker. Markers and animation suppression are applied
by the test harness only. The trusted document's CSP is retained. Empty, incomplete
or incorrectly owned captures fail rather than establishing visual success.

Native goldens require an explicit exact environment fingerprint. For this milestone:

```powershell
$env:APP_MODE_NATIVE_GOLDENS = '10.0.26200-electron-44.10.0-scale-1'
npm run test:visual -- --update-snapshots=none
Remove-Item Env:APP_MODE_NATIVE_GOLDENS
```

Other OS/runtime/display-scale combinations report native golden comparison as
`unavailable`; composition/geometry assertions still run on Windows. Non-Windows native
tests are explicitly skipped. Hosted CI runs composition checks but never substitutes
Windows Server images for the approved Windows 11 goldens. Fullscreen comparisons also
depend on display dimensions; a different display requires separate review. A passed
test process with unavailable native comparisons is incomplete visual coverage.

Every run creates `test-results/visual-evidence/<UTC timestamp>-<pid>/manifest.json`
and `index.md`. The schema version is 1. It records commit/dirty state, environment,
configuration, planned scenarios, attempts, measured geometry, stage results and relative
image/diff/trace links. Unexecuted scenarios and missing checks remain `unavailable`.
`overall` describes the test process; `coverageResult` separately identifies incomplete
visual coverage. A synthetic actual image is retained per scenario; traces are retained
on failures, with explicit trace lifecycle management for the new persistent context.
New runs use separate directories, so later runs do not erase prior review evidence.

To locate the latest review:

```powershell
Get-ChildItem test-results/visual-evidence -Directory | Sort-Object Name -Descending | Select-Object -First 1
```

CI uploads only named synthetic image/trace attachments copied into this evidence tree
on failure, with seven-day retention. Profiles, arbitrary JSON attachments, authenticated
live evidence and the entire runs directory are excluded. The original HTML report is
still available locally. A locally validated workflow does not establish hosted upload
success; that requires a later authorized CI run.

Generate or update only a targeted new baseline with
`npm test -- tests/visual/chromium.spec.js --grep "<scenario>" --update-snapshots`.
For native baselines, set the exact environment fingerprint and target `native.spec.js`.
Inspect every changed image and relevant diff, confirm fixture state, then rerun with
`--update-snapshots=none`. CI rejects baseline-update arguments. Never increase tolerance
or regenerate unrelated snapshots to conceal a failure. Report inspected images,
changed regions, clipping/overlap findings and unavailable states.

Controlled negative probes (expected exit code 1; never use update mode):

```powershell
$env:APP_MODE_VISUAL_PROBE = 'geometry'
npm test -- tests/visual/chromium.spec.js --grep home-expanded-light --update-snapshots=none
Remove-Item Env:APP_MODE_VISUAL_PROBE
$env:APP_MODE_COMPOSITION_PROBE = 'missing-chrome'
npm test -- tests/visual/native.spec.js --grep desktop --update-snapshots=none
Remove-Item Env:APP_MODE_COMPOSITION_PROBE
node --test tests/visual-contracts.cjs
```

The first probe shifts the workspace four pixels against its approved golden. The
second removes the trusted marker from an actual composed window capture. Contract
tests additionally reject missing content, wrong ownership/dimensions, loading leakage
and unsafe evidence attachments. Restore normal environment variables before integration.

## Choose checks for the change

Choose checks by the behavior changed. Documentation changes need diff and reference inspection. Extension changes need the affected fixture checks; runtime and native Electron changes need their respective suites. Combine checks when a change crosses those areas. Use `npm run test:all` for releases or changes spanning extension, runtime, and host.

Run setup only when dependencies or browsers are missing or need updating. Run pre-edit tests when needed to reproduce an issue or establish an unknown baseline. Once relevant checks pass, repeat or broaden them only after further changes, failures, or unresolved concerns.

## Offline automated checks

Install dependencies with `npm ci` and the fixture browser with `npx playwright install chromium` when needed, or set `APP_MODE_CHROMIUM_EXE` to a local chrome.exe. Preserve the lockfile and browser version during visual comparisons unless updating them is part of the task.

Run an affected fixture test with `npm test -- --grep "<test title>"`; use `npm test` when changes span the fixture suite. Check the selected test names and results to ensure they exercise the changed behavior.

The Playwright tests launch a browser with the local extension and disposable profiles under ignored `test-results/runs/`. They fulfill ChatGPT-shaped fixtures at `https://chatgpt.com` without contacting the site. Coverage includes extension injection, header and pin behavior, desktop/narrow layouts, mocked actions, client-side navigation, and DOM re-rendering. Control-server calls are intercepted; integration checks use an isolated server. Fixtures contain synthetic text only and never reuse the configured host profile.

Run `npm run test:runtime` for server, profile, installer, startup, taskbar, privacy, or saved geometry changes. Run `npm run test:host` for native Electron window behavior and related guards. These cover different layers; fixture success alone establishes neither runtime nor native-host success.

For visual changes, inspect rendered screenshots of the affected viewport and state. For responsive layout changes, inspect desktop and narrow widths and the affected breakpoint. Exercise re-rendering, navigation, menus, or modals when relevant. An existing fixture test may capture additional sizes; review coverage should follow the affected behavior.

Fixture screenshots are compared with checked-in baselines. Inspect relevant failure screenshots, traces, and image diffs when diagnosing failures. Update baselines only for intended changes, using `npm run test:update -- --grep "<test title>"` for a focused update or `npm run test:update` for an intentional suite-wide update. Inspect the new images and Git diff, then rerun the affected tests without updating snapshots.

Reports and failure evidence:

- HTML report: `playwright-report/index.html` (`npm run test:report` opens it).
- Standard Playwright failure screenshots, traces, and videos: `test-results/runs/`.
- Disposable fixture profiles: `test-results/runs/browser-profile-*/`; some tests use their individual output directory.
- Additional explicitly captured review images may live elsewhere under ignored `test-results/`; inspect the relevant test's output path.

Limit routine Playwright cleanup to `test-results/runs/`. Preserve useful diagnostic artifacts before cleaning. Persistent live profiles and audit evidence remain outside that directory.

## Actual ChatGPT review

Actual-site review is required for claims about current ChatGPT compatibility and fixes that depend on the real frontend DOM. Offline fixtures establish behavior against synthetic pages only. Choose the live workflow that supplies the evidence needed; running both workflows or a full audit is not required for every change.

For app appearance or native behavior, prefer `node tools/live-host-review.cjs`. It launches Electron with a dedicated development root under ignored `test-results/live-review-profile/native-host`, blocking production control-server calls. Sign in there if required and inspect the affected page, viewport, and interaction. Include desktop and narrow widths for responsive changes. Because production control calls are blocked, this review alone does not establish native control integration; use the relevant offline host checks as well.

For repeatable screenshots, measurements, or broader comparisons, run `npm run live:audit`. Playwright uses a separate review profile under `test-results/live-review-profile/` and waits for a user-controlled readiness button. The user may select blank home or a standard `/c/<id>` non-sensitive test conversation without query/hash. The runner does not infer authentication: inspect visible account state before treating evidence as authenticated.

The audit masks sidebar content, home headings, and message text/media, and saves no page text, labels, URLs, cookies, or DOM snapshots. Local control-server calls are intercepted and mocked. For the stock pass, it restarts the same review profile with an empty extension in the allowlist and refuses stock screenshots if the extension marker or pin remains. Screenshots and measurements stay under ignored `test-results/live-audits/<timestamp>/`.

The audit requests light/dark preferences and attempts expanded/collapsed sidebar states through accessible controls. Unavailable states are reported as unavailable. Screenshot dimensions are CSS viewport sizes; outer window dimensions are recorded separately. See [verification evidence and coverage limits](LIVE_UI_AUDIT.md).

Keep live review isolated from `Browser/AppModeHostProfile`; never copy, reset, or automate against that configured profile. Use blank home or non-sensitive test content, mask captures, and keep private text, titles, session URLs, credentials, cookies, DOM dumps, and profile data out of source and review artifacts. Local authentication data stays in the ignored review profile.

Do not run desktop-input host tests alongside live interactions or other headed suites because focus-dependent checks can interfere.

## Completion evidence

Report the checks performed, rendered states and viewport sizes inspected, runtime/browser version when relevant to visual comparisons, and live authentication or coverage limits. Describe the tested route class without recording session URLs or private titles. If sign-in or a required live state is unavailable, report it as unverified.

Keep the report proportional to the change. Link diagnostic reports or traces only when useful and after confirming they contain fixture data only.

## CI and targeted performance checks

`.github/workflows/quality.yml` uses Windows Server 2022, Node.js 22, `npm ci`, and `npx playwright install chromium --with-deps`. It validates JavaScript and PowerShell syntax (both Windows PowerShell 5.1 and PowerShell 7), then runs the fixture, runtime and host suites. Dependency installation follows [Playwright's CI guidance](https://playwright.dev/docs/ci); Node 22 remains an LTS line in the [Node release schedule](https://github.com/nodejs/Release).

Hosted jobs set `APP_MODE_NONINTERACTIVE=1`: the tray interaction and full foreground desktop-input host sequence are explicitly skipped. URL/CSP, IPC rejection, isolated server, configuration, injection, scheduling and supported host checks still run. The environment flag never bypasses an ownership or foreground guard. Run `npm run test:all` locally with the variable unset for desktop verification. CI has no production profile or credentials and does not upload browser profiles. A workflow added locally is not evidence of a successful hosted run.

Run `powershell.exe -NoProfile -File tools/check-syntax.ps1` and its `pwsh.exe` equivalent for source syntax. Runtime tests compile the C# launcher and transport in disposable locations.

Opt-in performance harnesses (no production instrumentation):

```powershell
node tools/measure-remediation.cjs bda2ef0
node tools/measure-remediation.cjs
node tools/measure-controls.cjs bda2ef0
node tools/measure-controls.cjs
node tools/measure-server.cjs bda2ef0
node tools/measure-server.cjs
powershell.exe -NoProfile -File tools/measure-opacity.ps1 -Revision bda2ef0
powershell.exe -NoProfile -File tools/measure-opacity.ps1
```

The first harness counts observer deliveries, reconciliation helper executions/time, DOM scans, computed-style calls and title-bar sampler results across idle home/long pages, streaming, sidebar transitions, dialogs, themes, resizing and scrolling. The controls harness counts native writes with deterministic event doubles. The server harness warms up before measuring CPU, tests a normal request behind an incomplete request, and sends repeated `/topmost` status requests against an empty isolated installation. The opacity harness simulates five seconds of empty/disabled/unpinned/pinned/transition/pointer/multiple-window workloads. Native doubles quantify calls, not real OS cost. Results vary with runtime, scheduling and machine load; compare like-for-like environments and retain numeric output only. All browser content is synthetic and no live profiles are attached. See [recorded results and coverage limits](STABILITY_REMEDIATION.md).

For an optional PowerShell 7 server check, set `APP_MODE_MEASURE_SHELL=pwsh.exe` in the harness process. It resolves the actual runtime before launching, so process CPU sampling uses the service PID rather than relying on launcher-specific accounting. This does not alter production shell selection. Compare CPU only within the same shell/runtime and machine conditions.
