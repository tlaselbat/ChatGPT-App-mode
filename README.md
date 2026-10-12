# ChatGPT App Mode

Windows launcher for ChatGPT using PortableApps Chromium Portable, plus a local MV3 extension for small reversible UI overrides.

## Install and configure

1. Keep PortableApps Chromium under `Browser/ChromiumPortable`.
2. Run `Install-ChatGPT-AppMode.ps1` to create the local `config.json` and shortcuts. Review `config.example.json` to understand the supported settings.
3. Launch with `Launch-ChatGPT-AppMode.ps1` or the installed shortcut.

`config.json`, browser files/profile, runtime logs, shortcuts, and installer ZIPs are local data and are excluded from Git. CSS and JavaScript entry points are `extension/styles/chatgpt-overrides.css` and `extension/scripts/chatgpt-overrides.js`.

## Offline visual development

Install Node.js 20+ and use the project lockfile:

```powershell
npm ci
npm test
```

The test opens the bundled Chromium executable with the extension loaded in a separate profile under ignored `test-results/browser-profile`. It routes `https://chatgpt.com` to a synthetic fixture and intercepts the extension's loopback calls. No production browser profile, authenticated page, private conversation, or live ChatGPT request is used.

The test captures desktop and narrow screenshots and compares them with committed fixture baselines. Update baselines intentionally after reviewing the new images:

```powershell
npm run test:update
```

Playwright writes HTML reports to `playwright-report/` and failure screenshots, traces, and videos under `test-results/`:

```powershell
npm run test:report
npm run test:headed
```

## Live UI audit

Run the privacy-safe live audit when you are ready to authenticate in the isolated development profile:

```powershell
npm run live:audit
```

The browser pauses until you sign in there if needed, choose the blank home page or a test conversation with no private content, and click **Begin privacy-safe capture**. The runner does not infer authentication; confirm it in the screenshots. It captures the requested desktop sizes and 390px diagnostic width, requests light/dark modes, attempts expanded/collapsed sidebar states, and compares extension-enabled with stock rendering in the same profile. Navigation content and message text/media are redacted in screenshots; reports contain geometry and computed styles, not page text or labels. Calls to the local control server are mocked. Output remains local under `test-results/live-audits/`. Close any other Chromium window using the live-review profile first. See [the current audit status](docs/LIVE_UI_AUDIT.md).

To use a separately installed Chromium instead of the bundled runtime:

```powershell
$env:APP_MODE_CHROMIUM_EXE = 'C:\Path\To\chrome.exe'
npm test
```

For actual-site review, start a separate development profile with `./Start-ChatGPT-Visual-Review.ps1` and sign in there if needed. Its profile lives under ignored `test-results/live-review-profile`; it never reads or copies the configured production profile. Automated fixture results do not validate authenticated live behavior; see [the visual testing workflow](docs/VISUAL_TESTING.md).

## Normal Chromium and profile reset

Use `Open-Chromium-Normal.ps1` for ordinary browser settings and extension management. `Reset-Portable-Chromium-Profile.ps1` requires typing `RESET` and targets the configured active profile (`appProfileDir`). It was not run during setup.

## Project notes

- [Architecture](docs/ARCHITECTURE.md)
- [Design guidelines](docs/DESIGN_GUIDELINES.md)
- [UI components](docs/UI_COMPONENTS.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
- [Visual testing workflow](docs/VISUAL_TESTING.md)
- [Contributor instructions](AGENTS.md)
