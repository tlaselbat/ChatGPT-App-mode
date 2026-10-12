# Visual testing workflow

## Offline automated checks

Run `npm ci` once, then `npm test`. The Playwright test launches the project's Chromium executable with only the local extension enabled and a dedicated user-data directory under `test-results/browser-profile`. The configured active `Browser/ChatGPTProfile` is never read or reused.

The test fulfills a ChatGPT-shaped fixture at `https://chatgpt.com` without contacting the site. It checks extension injection, page title, body marker, the always-on-top button, desktop/narrow layouts, a mocked button action, a client-side URL change, and recovery after a DOM re-render. The fixture contains synthetic text only. Control-server calls are intercepted and do not reach the real local server.

Desktop and narrow screenshots are compared against checked-in snapshots. To capture/update them intentionally, run `npm run test:update`, then inspect both images and the Git diff before accepting snapshot files. Ordinary `npm test` must pass against those baselines.

Reports and failure evidence:

- HTML report: `playwright-report/index.html` (`npm run test:report` opens it)
- Failure screenshots, trace ZIPs, and videos: `test-results/`
- Browser profile: `test-results/browser-profile/`

These generated files are ignored by Git. Preserve or copy failure artifacts elsewhere before cleaning `test-results` if they are needed for diagnosis.

## Actual ChatGPT review

Fixture checks do not prove compatibility with the current live ChatGPT frontend. Start a separate development profile with `./Start-ChatGPT-Visual-Review.ps1`, install/sign into that profile if required, and manually inspect the actual page at desktop and narrow widths. The script stores its profile under ignored `test-results/live-review-profile`. Do not automate against or copy the active user's profile. Do not put real conversations in fixture snapshots or reports. Record the Chromium version, tested URL class (for example a blank page or synthetic/non-sensitive chat), viewport sizes, and any required sign-in. If authenticated testing is unavailable, report that limitation explicitly.

For repeatable screenshots and measurements, run `npm run live:audit`. This launches Playwright against the same `test-results/live-review-profile` using a user-controlled in-page readiness button. The user may confirm the blank home route or a standard `/c/<id>` test-conversation route without query/hash; the runner does not infer authentication, so verify the visible account state before treating a run as authenticated. It hides sidebar contents, home headings, and conversation message text/media in screenshots, and writes no page text, labels, URLs, cookies, or DOM snapshots. Calls to the local control server are intercepted and mocked by Playwright. The runner restarts the same profile with an empty extension in the allowlist for the stock pass, and refuses stock screenshots if the local extension marker or pin remains. Measurements and screenshots stay in ignored `test-results/live-audits/<timestamp>/`.

The runner asks Chromium for light/dark media preferences and tries sidebar expanded/collapsed states using accessible button state labels. If the current frontend does not expose those controls, the report marks those states unavailable. Live screenshot dimensions are CSS viewport sizes; outer window dimensions are included separately. See [the live audit status and remaining checks](LIVE_UI_AUDIT.md).

## Visual regression discipline

1. Keep the runtime browser version and `package-lock.json` stable.
2. Run `npm test` before edits when a baseline is available.
3. Change CSS/JavaScript narrowly and keep extension selectors in reviewable helpers.
4. Run the affected test and review screenshot diffs at both sizes.
5. Update snapshots only for intended visual changes; include a short explanation in the change summary.
6. Attach the HTML report or trace when a failure needs reproducible evidence, after confirming it contains only fixture data.
