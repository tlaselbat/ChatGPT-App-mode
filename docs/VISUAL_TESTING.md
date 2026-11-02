# Visual testing workflow

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
