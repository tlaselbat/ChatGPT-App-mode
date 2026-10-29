# ChatGPT App Mode contributor instructions

## Architecture

- The Windows PowerShell launcher reads the local, ignored `config.json` and delegates shared launch argument, URL restore, portable Chromium INI, window identity, and local-server startup behavior to `tools/ChatGPT-AppMode.Helpers.ps1`.
- `Launch-ChatGPT-AppMode.ps1` launches Chromium with the configured `appProfileDir`, `extensionDir`, and app URL. The portable Chromium installation is runtime software under `Browser/` and is not source.
- `extension/manifest.json` loads `extension/styles/chatgpt-overrides.css` and `extension/scripts/chatgpt-overrides.js` on ChatGPT pages. Keep changes small, reversible, and scoped to the extension.
- `Start-ChatGPT-TrayLauncher.ps1`, `TaskbarLauncher/Program.cs`, and `Start-ChatGPT-TopMostServer.ps1` implement tray/taskbar integration and a loopback control endpoint. Treat server and profile deletion changes as security/data-integrity work.

## Source and private data

- Never commit `config.json`, `Browser/`, `logs/`, `*.zip`, runtime executables, generated build folders, shortcuts, session URLs, chat titles, browser profiles, or Playwright output. Use `config.example.json` for sanitized configuration documentation.
- Do not put credentials, cookies, access tokens, conversation content, or private chat titles in source, test fixtures, screenshots, reports, or logs.
- Do not run profile reset commands as part of routine development or tests. Never point a test browser at the configured production profile.
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
