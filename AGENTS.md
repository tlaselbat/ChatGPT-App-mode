# ChatGPT App Mode contributor instructions

## Scope and working-tree safety

- Inspect the branch, Git status, relevant files, and applicable instructions
  before editing. Preserve unrelated changes and configuration compatibility.
- Pre-existing uncommitted changes must never be considered disposable without
  user authorization, including files that appear generated or temporary.
- Make targeted changes using existing adapters, helpers, and conventions.
  Avoid broad rewrites, unnecessary dependencies, and unrelated cleanup.
- Stage explicit task-owned files or hunks; do not absorb user work into commits.
- Do not discard, stash, restore, reset, rebase, or force-push user work without
  specific approval. Obtain authorization before destructive operations,
  persistent-profile resets, merges, pushing, publishing, or deployment.
- Reuse prior findings and still-applicable verification. Prefer targeted
  searches over repeated repository scans; investigate further when necessary.

## Architecture and native behavior

See [Architecture](docs/ARCHITECTURE.md),
[Navigation](docs/NAVIGATION_LAYOUT.md), and the
[page module inventory](docs/CONTENT_SCRIPT_BEHAVIOR.md).

- When documentation conflicts with implementation, verify actual behavior
  against source and relevant tests before proposing corrections. Do not change
  working application behavior merely to match outdated documentation.
- Electron is the only supported desktop host. PowerShell and shared tools
  handle launching, configuration, tray/taskbar integration, and loopback
  services. Playwright Chromium is a separate fixture-testing environment.
- Preserve the unified 40 CSS-pixel header: Electron owns the caption controls
  and visible Pin; ChatGPT owns Chat/Work and contextual actions. The trusted
  caption strip overlays the page row, not a second stacked header.
- Preserve the caption-band no-drag exclusion and interactive-control
  exclusions. Follow the documented strip/exclusion geometry; do not add
  speculative workspace top spacers or change hit testing without verification.
- Preserve the permanent 52px activity rail and responsive native docked/drawer
  sidebar. Native disclosures and expansion preferences remain authoritative;
  supported fallback disclosures must remain accessible and reversible.
- Preserve native links, independent sidebar scrolling, account access,
  keyboard focus, drawer dismissal, composer, and conversation rendering.
- Follow the canonical Pin ownership/fallback rules in Architecture. Avoid
  duplicate visible Pins while retaining the functional hostless page fallback.
- Keep ordered script injection, scoped selectors, idempotent reconciliation,
  and cleanup intact. Do not move, clone, or replace React-managed native nodes.
  Unknown site markup must degrade gracefully to usable native behavior.

## Security and private data

- Preserve Electron sandboxing, context isolation, navigation/permission
  guards, and window-ownership checks. Remote ChatGPT content must have no
  Node integration, privileged preload, or access to the caption IPC bridge.
- Keep IPC actions allowlisted and validate the trusted sender, main frame,
  exact local document, and live owning window. Retain rejection-path tests
  for affected security boundaries.
- Preserve exact allowed origins, numeric loopback Host validation, bounded
  requests/timeouts, conditional private-network preflight handling, and
  native window binding/foreground safeguards in the control server.
- Never commit local config.json, Browser/, logs/, archive/, profiles,
  generated packages/executables/shortcuts, or disposable test output.
  Use config.example.json and synthetic fixtures for examples.
- Keep credentials, tokens, cookies, private titles/content, session URLs,
  and private DOM dumps out of source, fixtures, captures, reports, and logs.
  Ignored files are not automatically safe to share.
- Never test against or copy the production Browser/AppModeHostProfile.
  Test reset guards without invoking destructive profile-reset entry points.
  Do not weaken security or ownership guards to make verification pass.

## Verification

Follow [Visual testing](docs/VISUAL_TESTING.md) for setup and evidence handling.

| Affected area | Verification |
| --- | --- |
| Documentation only | Review diffs; verify links, paths, commands, and source claims. |
| Extension styling/page behavior | Focused `npm test -- --grep "<test title>"`; broaden to `npm test` when needed. |
| Server, profiles, installer, startup, taskbar, privacy, saved geometry | Relevant `npm run test:runtime` checks; add other affected layers. |
| Electron controls, dragging, resizing, focus, sandbox, navigation, permissions | `npm run test:host`, plus affected runtime/fixture checks. |
| Release or broad cross-layer changes | `npm run test:all`. |

- Choose coverage by changed behavior and risk, not file extension alone.
  Use focused checks during implementation; broaden for cross-component
  impact, further changes, failures, or unresolved concerns.
- Inspect affected rendered states. Responsive changes need desktop, narrow,
  and affected-breakpoint review; DOM changes need navigation/re-render checks.
- Native window controls, Pin, dragging, and keyboard interactions require real
  interaction verification where practical. DOM visibility and simulated clicks
  alone are insufficient evidence of native functionality. Explicitly report
  any native-interaction coverage that could not be performed.
- Update synthetic fixture baselines only for intentional visual changes.
  Review image diffs, then rerun affected checks without snapshot updates.
- Verify important live-DOM-dependent changes against the isolated application.
  Use `node tools/live-host-review.cjs` or `npm run live:audit` as appropriate;
  a full live audit is not required for every change.
- Offline fixtures do not establish native-host or authenticated live success.
  Verify visible authentication, keep captures masked, and report unavailable
  states or required live coverage as unverified.
- Use test-results/runs/ for disposable test profiles/output. Preserve persistent
  test-results/live-review-profile/ and test-results/live-audits/ data.
  Clean only authorized task-owned disposable artifacts.
- Do not run desktop-input host checks alongside live interactions or other
  headed suites. Diagnose focus, coverage, permission, or environment failures
  separately from product defects; do not bypass safety guards.
- Report checks actually performed, relevant states, failures, limitations,
  and commit information concisely. Label reused results as prior evidence;
  never claim unperformed verification.
