# ChatGPT App Mode contributor instructions

## Architecture

- The Windows PowerShell launcher reads the local, ignored `config.json` and delegates URL restore, window identity, native host launch, and local-server startup behavior to `tools/ChatGPT-AppMode.Helpers.ps1`.
- `Launch-ChatGPT-AppMode.ps1` launches the pinned Electron host (`node_modules/electron`) with `WindowHost/main.cjs` and the dedicated `Browser/AppModeHostProfile`. Chromium was retired; the Electron runtime is the only supported host.
- `extension/styles/chatgpt-overrides.css` and `extension/scripts/chatgpt-overrides.js` are the shared page overrides; the host injects them into ChatGPT pages (the MV3 manifest remains for Playwright/live-audit browser contexts). Keep changes small, reversible, and scoped.
- `Start-ChatGPT-TrayLauncher.ps1`, `TaskbarLauncher/Program.cs`, and `Start-ChatGPT-TopMostServer.ps1` implement tray/taskbar integration and a loopback control endpoint. Treat server and profile deletion changes as security/data-integrity work.
- `WindowHost/` is the Electron window host using `Browser/AppModeHostProfile`. Keep its sandbox, navigation, and permission guards intact.

## Source and private data

- Never commit `config.json`, `Browser/`, `logs/`, `*.zip`, runtime executables, generated build folders, shortcuts, session URLs, chat titles, browser profiles, or Playwright output. Use `config.example.json` for sanitized configuration documentation.
- `archive/` holds retired installers, snapshots, and deprecated assets. It is ignored local data, not source; old entries under it may contain browser profiles or chat titles and must never be committed or referenced by tests.
- Do not put credentials, cookies, access tokens, conversation content, or private chat titles in source, test fixtures, screenshots, reports, or logs.
- Do not run profile reset commands as part of routine development or tests. `Reset-AppMode-HostProfile.ps1` targets only `Browser/AppModeHostProfile` with typed confirmation; never point a test host at the configured production profile.
- The local control server accepts only exact ChatGPT origins and the loopback Host. Preserve allowed/disallowed-origin tests, bounded request reads, window ownership checks, and conditional private-network preflight compatibility when changing it.

## Coding and verification

- Preserve launcher behavior and the current extension's contracts unless the task explicitly changes them.
- Prefer narrow CSS selectors and small JavaScript helpers. ChatGPT's DOM is not a stable public API; document selector assumptions and provide graceful behavior when targets disappear.
- Use the offline Playwright fixture (`npm test`) for deterministic layout and extension checks. Disposable profiles live under ignored `test-results/runs/`; this is the only Playwright cleanup directory. Persistent `test-results/live-review-profile` and `test-results/live-audits` must remain outside it.
- Run `npm run test:runtime` for server, profile guard, installer, startup, taskbar, privacy, and geometry changes. Its server uses a temporary config and a separate port; profile-reset entry points must never be executed by tests.
- Run screenshot baselines only from the fixture. Update snapshots intentionally with `npm run test:update`; review the generated image diffs before accepting them.
- For live review, use `npm run live:audit` and the separate ignored `test-results/live-review-profile`. The user may confirm the blank home route or a standard `/c/<id>` test conversation without query/hash. Verify authentication from the visible screenshot; the runner does not infer account state. Never save page text, labels, URLs, cookies, or DOM snapshots. The runner masks sidebar content, home headings, and conversation message text/media, intercepts local control-server calls, and stores screenshots/measurements only under ignored `test-results/live-audits/`.
- Changes to selectors, navigation, or mutation handling should include a re-render/navigation check. Changes to launcher, server, profile, or deletion logic require focused safety checks and must not be validated against the user's active browser profile.
- Actual `https://chatgpt.com` visual verification is a separate manual step and may require sign-in. Do not claim it based on fixture results.
- Header centering targets the tightest visible two-control switch, not its ancestor layer. Center on the page viewport when each neighboring control clears the switch by at least 6 CSS pixels. At viewport widths of 480 CSS pixels or less, or when measured neighbors would collide, use the remaining-space flow fallback instead of an offset. Retain an already-normalized, still-rendered header and its Pin while a visible modal temporarily makes that header aria-hidden; do not discover new controls inside hidden regions.
- For isolated Electron header evidence, `node tools/live-host-review.cjs` opens the separate native review profile at 680px with loopback debugging on port 9223. After the user approves blank home, `node tools/cdp-header-dump.js` navigates that review page to home and writes masked header-only PNG samples plus numeric geometry under ignored `test-results/live-audits/`. The capture uses CSS-pixel screenshot scale and records PNG dimensions, devicePixelRatio, and visualViewport scale separately. Do not run desktop-input host tests concurrently with live interactions or other headed suites; native focus-dependent double-click checks can interfere.
