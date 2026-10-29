const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const LIVE_URL = 'https://chatgpt.com/';
const EXTENSION = path.join(ROOT, 'extension');
const PROFILE = path.join(ROOT, 'test-results', 'live-review-profile');
const OUTPUT_ROOT = path.join(ROOT, 'test-results', 'live-audits');
const CHROME = process.env.APP_MODE_CHROMIUM_EXE || '';
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 800, height: 850 },
  { width: 390, height: 844 },
];
const APPEARANCES = ['light', 'dark'];

if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({
    liveUrl: LIVE_URL,
    profile: path.relative(ROOT, PROFILE),
    output: path.relative(ROOT, OUTPUT_ROOT),
    viewports: VIEWPORTS,
    appearances: APPEARANCES,
    extensionModes: ['customized', 'stock'],
    privacy: 'No page text, dynamic labels, session URLs, cookies, or DOM snapshots are written. User confirms blank home or a test-conversation route; message text and media are redacted.',
  }, null, 2));
  process.exit(0);
}

if (CHROME && !fs.existsSync(CHROME)) {
  throw new Error(`Chromium not found at ${CHROME}. Set APP_MODE_CHROMIUM_EXE to a local chrome.exe.`);
}
if (!fs.existsSync(path.join(EXTENSION, 'manifest.json'))) {
  throw new Error(`Extension manifest not found: ${EXTENSION}`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.join(OUTPUT_ROOT, stamp);
fs.mkdirSync(outputDir, { recursive: true });
const records = [];
const toggleAvailability = [];
let readyResolve;
const userReady = new Promise((resolve) => { readyResolve = resolve; });

function displaySize(viewport) {
  return `${viewport.width}x${viewport.height}`;
}

function startContext(mode) {
  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1920,1080',
  ];
  if (mode === 'customized') {
    args.push(`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`);
  } else {
    const stockExtension = path.join(ROOT, 'test-results', 'stock-extension');
    fs.mkdirSync(stockExtension, { recursive: true });
    fs.writeFileSync(path.join(stockExtension, 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      name: 'Visual Audit Stock Control',
      version: '1.0.0',
    }, null, 2));
    args.push(`--disable-extensions-except=${stockExtension}`, `--load-extension=${stockExtension}`);
  }

  return chromium.launchPersistentContext(PROFILE, {
    ...(CHROME ? { executablePath: CHROME } : {}),
    headless: false,
    viewport: { width: 1920, height: 1080 },
    args,
  });
}

async function installReadyGate(context) {
  await context.exposeBinding('__liveAuditReady', (_source, url) => readyResolve(url));
  await context.addInitScript(() => {
    const gateId = 'chatgpt-live-audit-ready-gate';
    const ensureGate = () => {
      if (window.__liveAuditStarted || location.hostname !== 'chatgpt.com' || !document.body || document.getElementById(gateId)) return;
      const gate = document.createElement('section');
      gate.id = gateId;
      gate.setAttribute('aria-label', 'Live audit control');
      gate.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;background:#151515;color:#fff;padding:12px 14px;border-radius:10px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 2px 14px #0006;max-width:310px';
      gate.innerHTML = '<div style="margin-bottom:8px">Sign in in this development profile if needed. Use the blank home page or a test conversation with no private content. Message text and media are hidden in screenshots.</div><button type="button" style="padding:7px 10px;border:0;border-radius:6px;background:#fff;color:#111;cursor:pointer">Begin privacy-safe capture</button><div role="status" style="margin-top:6px"></div>';
      gate.querySelector('button').addEventListener('click', () => {
        const safeRoute = location.pathname === '/' || /^\/c\/[A-Za-z0-9-]+\/?$/.test(location.pathname);
        if (!safeRoute || location.search || location.hash) {
          gate.querySelector('[role=status]').textContent = 'Use the blank home page or a standard /c/ test-conversation route without query parameters.';
          return;
        }
        gate.remove();
        window.__liveAuditStarted = true;
        window.__liveAuditReady(`${location.origin}${location.pathname}`);
      });
      document.body.appendChild(gate);
    };
    new MutationObserver(ensureGate).observe(document, { childList: true, subtree: true });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureGate, { once: true });
    else ensureGate();
  });
}

async function interceptLocalControlServer(context) {
  await context.route('http://127.0.0.1:17863/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const headers = {
      'Access-Control-Allow-Origin': 'https://chatgpt.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (method !== 'POST') return route.fulfill({ status: 405, headers, body: '{}' });
    const endpoint = new URL(request.url()).pathname;
    const body = endpoint === '/session' ? { saved: false } : endpoint === '/topmost' ? { enabled: false, windows: 0 } : {};
    return route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  });
}

async function captureMeasurements(page, mode, appearance, viewport, sidebarState) {
  return page.evaluate(({ mode, appearance, viewport, sidebarState }) => {
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        x: round(value.x), y: round(value.y), width: round(value.width), height: round(value.height),
        right: round(value.right), bottom: round(value.bottom),
      };
    };
    const round = (value) => Math.round(value * 10) / 10;
    const visible = (element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const firstVisible = (selectors) => {
      for (const selector of selectors) {
        const element = Array.from(document.querySelectorAll(selector)).find(visible);
        if (element) return { selector, element };
      }
      return null;
    };
    const describe = (match) => {
      if (!match) return null;
      const element = match.element;
      const style = getComputedStyle(element);
      return {
        selector: match.selector,
        tag: element.tagName.toLowerCase(),
        box: rect(element),
        style: {
          display: style.display,
          position: style.position,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          fontWeight: style.fontWeight,
          color: style.color,
          backgroundColor: style.backgroundColor,
          padding: style.padding,
          margin: style.margin,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          zIndex: style.zIndex,
        },
      };
    };
    const overlap = (a, b) => Boolean(a && b && a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y);
    const sidebarMatch = firstVisible(['aside', '[role="navigation"]', 'nav', '[data-testid*="sidebar" i]']);
    const mainMatch = firstVisible(['main', '[role="main"]']);
    const headerMatch = firstVisible(['header', '[role="banner"]']);
    const composerMatch = firstVisible(['textarea', '[contenteditable="true"]', '[data-testid*="composer" i]']);
    const pin = document.querySelector('#chatgpt-app-mode-pin-toggle');
    const pinVisible = pin && visible(pin) ? pin : null;
    const sidebarBox = sidebarMatch ? rect(sidebarMatch.element) : null;
    const mainBox = mainMatch ? rect(mainMatch.element) : null;
    const headerBox = headerMatch ? rect(headerMatch.element) : null;
    const composerBox = composerMatch ? rect(composerMatch.element) : null;
    const pinBox = rect(pinVisible);
    const iconButtons = Array.from(document.querySelectorAll('button')).filter((button) => {
      if (!visible(button) || !button.querySelector('svg')) return false;
      return !button.hasAttribute('aria-label') && !button.hasAttribute('aria-labelledby') && !button.hasAttribute('title');
    });
    const smallTargets = Array.from(document.querySelectorAll('button,[role="button"],a[href]')).filter((element) => {
      if (!visible(element)) return false;
      const box = element.getBoundingClientRect();
      return box.width < 24 || box.height < 24;
    });
    const html = document.documentElement;
    const bodyStyle = getComputedStyle(document.body);
    return {
      mode,
      appearance,
      requestedViewport: viewport,
      sidebarState,
      viewport: { width: innerWidth, height: innerHeight, outerWidth, outerHeight, scrollX, scrollY },
      document: { clientWidth: html.clientWidth, scrollWidth: html.scrollWidth, clientHeight: html.clientHeight, scrollHeight: html.scrollHeight },
      overflow: { horizontal: html.scrollWidth > html.clientWidth + 1, vertical: html.scrollHeight > html.clientHeight + 1 },
      mediaPrefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
      bodyStyle: { color: bodyStyle.color, backgroundColor: bodyStyle.backgroundColor, fontSize: bodyStyle.fontSize, lineHeight: bodyStyle.lineHeight },
      landmarks: {
        sidebar: describe(sidebarMatch),
        main: describe(mainMatch),
        header: describe(headerMatch),
        composer: describe(composerMatch),
        extensionPin: pinVisible ? {
          box: pinBox,
          style: { position: getComputedStyle(pinVisible).position, backgroundColor: getComputedStyle(pinVisible).backgroundColor, color: getComputedStyle(pinVisible).color, zIndex: getComputedStyle(pinVisible).zIndex },
          active: pinVisible.classList.contains('is-active'),
          unavailable: pinVisible.classList.contains('is-unavailable'),
          hasAccessibleName: pinVisible.hasAttribute('aria-label') || pinVisible.hasAttribute('aria-labelledby') || pinVisible.hasAttribute('title'),
          pressedStatePresent: pinVisible.hasAttribute('aria-pressed'),
        } : null,
      },
      geometry: {
        sidebarWidth: sidebarBox ? sidebarBox.width : null,
        mainWidth: mainBox ? mainBox.width : null,
        composerCenterOffsetFromMain: composerBox && mainBox ? round(Math.abs((composerBox.x + composerBox.width / 2) - (mainBox.x + mainBox.width / 2))) : null,
        composerBottomGap: composerBox ? round(innerHeight - composerBox.bottom) : null,
        composerClipped: composerBox ? composerBox.x < 0 || composerBox.right > innerWidth || composerBox.y < 0 || composerBox.bottom > innerHeight : null,
        pinOverlapsComposer: overlap(pinBox, composerBox),
        pinOverlapsHeader: overlap(pinBox, headerBox),
      },
      accessibilitySignals: {
        visibleIconButtonsWithoutExplicitName: iconButtons.length,
        visibleInteractiveTargetsUnder24px: smallTargets.length,
      },
    };
  }, { mode, appearance, viewport, sidebarState });
}

async function selectSidebarState(page, desired) {
  const closeButton = page.locator('button[aria-label*="close sidebar" i],button[title*="close sidebar" i],button[aria-label*="collapse sidebar" i],button[title*="collapse sidebar" i],button[aria-label*="hide sidebar" i],button[title*="hide sidebar" i],[data-testid*="close-sidebar" i]').first();
  const openButton = page.locator('button[aria-label*="open sidebar" i],button[title*="open sidebar" i],button[aria-label*="expand sidebar" i],button[title*="expand sidebar" i],button[aria-label*="show sidebar" i],button[title*="show sidebar" i],[data-testid*="open-sidebar" i]').first();
  const closeVisible = await closeButton.isVisible().catch(() => false);
  const openVisible = await openButton.isVisible().catch(() => false);
  if (desired === 'collapsed' && closeVisible) {
    try {
      await closeButton.click();
      await page.waitForTimeout(300);
      return await openButton.isVisible();
    } catch {
      return false;
    }
  }
  if (desired === 'expanded' && openVisible) {
    try {
      await openButton.click();
      await page.waitForTimeout(300);
      return await closeButton.isVisible();
    } catch {
      return false;
    }
  }
  return desired === 'expanded' ? closeVisible : openVisible;
}

async function privacyStyle(page) {
  const result = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('aside,[role="navigation"],nav,[data-testid*="sidebar" i]'))
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.left <= 24 && box.width >= 100 && box.width <= 500 && box.height >= innerHeight * 0.35)
      .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height);
    const sidebar = candidates[0]?.element;
    if (sidebar) sidebar.setAttribute('data-live-audit-private-region', 'true');
    const privateContent = Array.from(document.querySelectorAll('[data-message-author-role],[data-testid*="conversation-turn" i]'));
    for (const region of privateContent) region.setAttribute('data-live-audit-private-message', 'true');
    const homeHeadings = Array.from(document.querySelectorAll('main h1,[role="main"] h1,main [role="heading"][aria-level="1"]'));
    for (const heading of homeHeadings) heading.setAttribute('data-live-audit-private-heading', 'true');
    if (sidebar) return { sidebarRedaction: 'region-content-hidden', privateContentRedacted: privateContent.length, privateHeadingRedacted: homeHeadings.length > 0 };
    const mask = document.createElement('div');
    mask.id = 'live-audit-sidebar-fallback-mask';
    const width = Math.min(500, Math.max(260, innerWidth * 0.45));
    const bodyBackground = getComputedStyle(document.body).backgroundColor;
    const rootBackground = getComputedStyle(document.documentElement).backgroundColor;
    const background = bodyBackground !== 'rgba(0, 0, 0, 0)' ? bodyBackground : rootBackground !== 'rgba(0, 0, 0, 0)' ? rootBackground : matchMedia('(prefers-color-scheme: dark)').matches ? '#202123' : '#fff';
    mask.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:100vh;z-index:2147483647;pointer-events:none;background:${background}`;
    document.body.appendChild(mask);
    return { sidebarRedaction: 'fallback-left-region-masked', privateContentRedacted: privateContent.length, privateHeadingRedacted: homeHeadings.length > 0 };
  });
  await page.addStyleTag({ content: `
    [data-live-audit-private-region="true"] * { visibility: hidden !important; }
    [data-live-audit-private-heading="true"] { visibility: hidden !important; }
    [data-live-audit-private-message="true"] { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }
    [data-live-audit-private-message="true"] img,
    [data-live-audit-private-message="true"] video,
    [data-live-audit-private-message="true"] canvas,
    [data-live-audit-private-message="true"] svg { visibility: hidden !important; }
  ` });
  return result;
}

async function captureMode(context, mode, safeUrl) {
  const page = context.pages()[0] || await context.newPage();
  await page.goto(safeUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    window.__liveAuditStarted = true;
    document.querySelector('#chatgpt-live-audit-ready-gate')?.remove();
  });

  const extensionState = await page.evaluate(() => ({
    marker: Boolean(document.body?.classList.contains('faux-chatgpt-app-mode')),
    pin: Boolean(document.querySelector('#chatgpt-app-mode-pin-toggle')),
  }));
  if (mode === 'stock' && (extensionState.marker || extensionState.pin)) {
    throw new Error('Stock comparison was skipped: extension markers remain after disabling customizations. No stock screenshots were written.');
  }
  if (mode === 'customized' && !extensionState.pin) {
    throw new Error('Customized comparison was skipped: extension pin control was not observed on the live home page.');
  }

  for (const appearance of APPEARANCES) {
    await page.emulateMedia({ colorScheme: appearance });
    await page.waitForTimeout(500);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(250);
      const canToggle = await selectSidebarState(page, 'expanded');
      const states = canToggle ? ['expanded', 'collapsed'] : ['default'];
      toggleAvailability.push({ mode, appearance, viewport: displaySize(viewport), supported: canToggle });

      for (const sidebarState of states) {
        if (canToggle) await selectSidebarState(page, sidebarState);
        const currentPathIsSafe = await page.evaluate(() => (location.pathname === '/' || /^\/c\/[A-Za-z0-9-]+\/?$/.test(location.pathname)) && !location.search && !location.hash);
        if (!currentPathIsSafe) throw new Error('Capture stopped because the page left the approved home or test-conversation route.');
        const redaction = await privacyStyle(page);
        const measurements = await captureMeasurements(page, mode, appearance, viewport, sidebarState);
        const relativeScreenshot = path.join(mode, appearance, displaySize(viewport), `sidebar-${sidebarState}.png`);
        const screenshotPath = path.join(outputDir, relativeScreenshot);
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled' });
        records.push({ ...measurements, privacyRedaction: redaction, screenshot: relativeScreenshot });
        console.log(`Captured ${mode} ${appearance} ${displaySize(viewport)} sidebar ${sidebarState}`);
        await page.evaluate(() => {
          document.querySelectorAll('[data-live-audit-private-region],[data-live-audit-private-heading],[data-live-audit-private-message]').forEach((element) => {
            element.removeAttribute('data-live-audit-private-region');
            element.removeAttribute('data-live-audit-private-heading');
            element.removeAttribute('data-live-audit-private-message');
          });
          document.querySelector('#live-audit-sidebar-fallback-mask')?.remove();
          document.querySelectorAll('style').forEach((element) => {
            if (element.textContent.includes('data-live-audit-private-region')) element.remove();
          });
        });
      }
    }
  }
  return extensionState;
}

function buildReport() {
  const findings = [];
  const recommendations = [];
  for (const item of records) {
    const label = `${item.mode}, ${item.appearance}, ${displaySize(item.requestedViewport)}, sidebar ${item.sidebarState}`;
    if (item.overflow.horizontal) findings.push(`- **Confirmed horizontal overflow:** ${label}; document ${item.document.scrollWidth}px wide for a ${item.document.clientWidth}px viewport. Screenshot: \`${item.screenshot}\`.`);
    if (item.geometry.composerClipped) findings.push(`- **Confirmed composer clipping:** ${label}; composer bounds extend outside the viewport. Screenshot: \`${item.screenshot}\`.`);
    if (item.geometry.pinOverlapsComposer) findings.push(`- **Confirmed extension/composer overlap:** ${label}; pin control intersects the composer. Screenshot: \`${item.screenshot}\`.`);
    if (item.geometry.pinOverlapsHeader) findings.push(`- **Confirmed extension/header overlap:** ${label}; pin control intersects the top header. Screenshot: \`${item.screenshot}\`.`);
  }
  const uniqueFindings = Array.from(new Set(findings));
  const liveCustomized = records.filter((item) => item.mode === 'customized');
  const stockByState = new Map(records.filter((item) => item.mode === 'stock').map((item) => [
    `${item.appearance}|${item.requestedViewport.width}|${item.requestedViewport.height}|${item.sidebarState}`,
    item,
  ]));
  const comparisonRows = liveCustomized.map((custom) => {
    const key = `${custom.appearance}|${custom.requestedViewport.width}|${custom.requestedViewport.height}|${custom.sidebarState}`;
    const stock = stockByState.get(key);
    if (!stock) return `| ${custom.appearance} ${displaySize(custom.requestedViewport)} ${custom.sidebarState} | unavailable | unavailable | unavailable | \`${custom.screenshot}\` |`;
    const delta = (a, b) => a === null || a === undefined || b === null || b === undefined ? 'n/a' : `${Math.round((a - b) * 10) / 10}px`;
    const bodyColorChanged = custom.bodyStyle.backgroundColor !== stock.bodyStyle.backgroundColor || custom.bodyStyle.color !== stock.bodyStyle.color;
    return `| ${custom.appearance} ${displaySize(custom.requestedViewport)} ${custom.sidebarState} | ${custom.landmarks.extensionPin ? 'present' : 'absent'} / ${stock.landmarks.extensionPin ? 'present' : 'absent'} | ${delta(custom.geometry.sidebarWidth, stock.geometry.sidebarWidth)} | ${bodyColorChanged ? 'yes' : 'no'} | [custom](${custom.screenshot}) / [stock](${stock.screenshot}) |`;
  });
  const horizontalOverflow = liveCustomized.some((item) => item.overflow.horizontal);
  const overlap = liveCustomized.some((item) => item.geometry.pinOverlapsComposer || item.geometry.pinOverlapsHeader);
  const clippedComposer = liveCustomized.some((item) => item.geometry.composerClipped);
  const unnamedIconButtons = Math.max(0, ...liveCustomized.map((item) => item.accessibilitySignals.visibleIconButtonsWithoutExplicitName));
  const smallTargets = Math.max(0, ...liveCustomized.map((item) => item.accessibilitySignals.visibleInteractiveTargetsUnder24px));
  if (horizontalOverflow) recommendations.push('- **P1 — Fix the confirmed horizontal overflow** at affected widths before layout changes. Inspect structural rules in `extension/styles/chatgpt-overrides.css`; retain the screenshot and measured document width as acceptance evidence.');
  if (overlap) recommendations.push('- **P1 — Resolve the confirmed extension control overlap** with the header or composer. The pin control is positioned by `extension/styles/chatgpt-overrides.css`; preserve a non-overlapping hit area at 390px and desktop sizes.');
  if (clippedComposer) recommendations.push('- **P1 — Keep the composer inside the content viewport.** Review the measured composer bounds and scrolling behavior before changing layout rules.');
  if (unnamedIconButtons > 0 || smallTargets > 0) recommendations.push(`- **P2 — Review accessibility signals:** up to ${unnamedIconButtons} visible icon buttons lacked explicit ARIA/title names and up to ${smallTargets} visible interactive targets were under 24px. Verify accessible names and target sizing manually; these counts are triage signals.`);
  recommendations.push('- **P2 — Isolate fragile ChatGPT selectors** in a compatibility layer. `extension/scripts/chatgpt-overrides.js` queries `aria-current`, link `href`, `data-testid`, and `nav`; confirm those targets against current live markup before relying on them.');
  recommendations.push('- **P3 — Review composer alignment and unused space** from the recorded bounds at each viewport. The measurements provide geometry; an agent should inspect the paired screenshots before labeling whitespace as a defect.');
  recommendations.push('- **P3 — Verify light/dark behavior manually.** The runner requests both media schemes and records computed colors; ChatGPT may honor an explicit in-app appearance setting instead.');
  const layoutRows = VIEWPORTS.map((viewport) => {
    const item = liveCustomized.find((entry) => entry.appearance === 'light' && entry.requestedViewport.width === viewport.width && entry.sidebarState === 'expanded') ||
      liveCustomized.find((entry) => entry.appearance === 'light' && entry.requestedViewport.width === viewport.width);
    if (!item) return `| ${displaySize(viewport)} | unavailable | unavailable | unavailable | unavailable | unavailable |`;
    const value = (number) => number === null || number === undefined ? 'n/a' : `${number}px`;
    return `| ${displaySize(viewport)} | ${value(item.geometry.sidebarWidth)} | ${value(item.geometry.mainWidth)} | ${value(item.landmarks.composer?.box.width)} | ${item.overflow.horizontal ? 'yes' : 'no'} | ${item.geometry.composerClipped ? 'yes' : item.geometry.composerClipped === null ? 'n/a' : 'no'} |`;
  });
  const screenshotCount = records.length;
  const sidebarNotToggleable = toggleAvailability.filter((item) => !item.supported);
  const lines = [
    '# Live ChatGPT UI audit',
    '',
    `Captured: ${new Date().toISOString()}`,
    '',
    '## Scope and privacy',
    '',
    '- Capture requires the user to confirm the blank home route or a standard `/c/<id>` test-conversation route. Query strings and hashes stop capture. The selected route is kept in memory only.',
    '- Authentication is user-controlled and is not inferred by the runner. Verify the visible account state before interpreting a run as authenticated. The runner does not read credentials, page text, accessible labels, cookies, or conversation data.',
    '- Screenshots hide left navigation content and home headings; message text and message media are redacted. Measurements contain geometry and computed styles only.',
    '- Extension requests to the local control server are intercepted and answered by Playwright. The server is not contacted; its security implementation was not changed.',
    '- Browser profile, report, measurements, and screenshots are local under ignored `test-results/`.',
    '',
    '## Capture coverage',
    '',
    `- Extension modes: customized and stock (stock marker assertion required).`,
    `- Viewports: ${VIEWPORTS.map(displaySize).join(', ')} CSS pixels.`,
    `- Requested appearances: light and dark via Playwright media emulation.`,
    `- Screenshots captured: ${screenshotCount}.`,
    `- Sidebar toggle unavailable for ${sidebarNotToggleable.length} mode/appearance/viewport combinations; those used the default state.`,
    '- Measurements: app boundaries, sidebar/main/header/composer boxes, typography and spacing styles, page scrolling/overflow, extension pin placement, and limited accessibility signals.',
    '',
    '| Viewport | Sidebar width | Main width | Composer width | Horizontal overflow | Composer clipped |',
    '|---|---:|---:|---:|---|---|',
    ...layoutRows,
    '',
    '## Stock versus customized comparison',
    '',
    'Each pair uses the same isolated profile and the user-confirmed route. The extension was excluded from the stock launch, which was accepted only after its body marker and pin control were absent.',
    '',
    '| Appearance, viewport, sidebar | Pin custom / stock | Sidebar width delta | Body colors differ | Screenshot pair |',
    '|---|---|---:|---|---|',
    ...comparisonRows,
    '',
    '## Confirmed geometry findings',
    '',
    ...(uniqueFindings.length ? uniqueFindings : ['- No horizontal overflow, composer clipping, or pin/header/composer intersection was confirmed by the recorded geometry checks. Manual review is still required for alignment, wasted space, typography, and visual hierarchy.']),
    '',
    '## Ranked recommendations',
    '',
    ...recommendations,
    '',
    '## Extension attribution',
    '',
    '- Cosmetic and structural changes originate in `extension/styles/chatgpt-overrides.css`.',
    '- The pin control, title/body mutation handling, and session reporting originate in `extension/scripts/chatgpt-overrides.js`.',
    '- The stock pass is accepted only when the body marker and injected pin are absent. Both passes reuse the same isolated profile; ChatGPT sign-in is not copied.',
    '',
    '## Offline fixture evidence (separate from live findings)',
    '',
    '- The existing 390px fixture screenshot confirms the fixed pin button overlaps fixture text slightly. This is an offline-fixture finding, not a live-site observation.',
    '- Source: `tests/visual.spec.js` and `tests/visual.spec.js-snapshots/fixture-narrow-win32.png`.',
    '',
    '## Accessibility and evidence limits',
    '',
    '- Numeric signals include visible icon buttons without explicit ARIA/title attributes and visible interactive targets under 24px. These are triage signals, not a WCAG audit.',
    '- Sidebar text and home headings are redacted, so their typography and control labels require separate user-approved/manual review.',
    '- DOM targeting fragility remains in ChatGPT link selectors used by `extension/scripts/chatgpt-overrides.js` (`aria-current`, `href`, `data-testid`, and `nav`). These are not stable public APIs.',
    '- Screenshots use the requested CSS viewport dimensions; browser outer window dimensions are recorded separately.',
    '',
    '## Evidence files',
    '',
    '- `measurements.json` contains numeric geometry, CSS metrics, and screenshot paths; it contains no page text or URLs.',
    '- Screenshots are organized by mode, emulated appearance, viewport, and sidebar state.',
  ];
  fs.writeFileSync(path.join(outputDir, 'audit-report.md'), `${lines.join('\n')}\n`, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'measurements.json'), JSON.stringify({
    capture: { viewportSizes: VIEWPORTS, appearances: APPEARANCES, modes: ['customized', 'stock'], screenshotCount },
    sidebarToggleAvailability: toggleAvailability,
    records,
  }, null, 2), 'utf8');
}

async function main() {
  fs.mkdirSync(PROFILE, { recursive: true });
  console.log(`Live audit output: ${path.relative(ROOT, outputDir)}`);
  console.log('Launching the isolated development profile. Sign in there only if needed; the production profile is never opened.');
  const context = await startContext('customized');
  try {
    for (const extraPage of context.pages().slice(1)) await extraPage.close();
    await installReadyGate(context);
    await interceptLocalControlServer(context);
    const page = context.pages()[0] || await context.newPage();
    await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded' });
    console.log('When ready, use the blank home page or a test conversation with no private content, then click “Begin privacy-safe capture” in the browser window.');
    const safeUrl = await userReady;
    const customState = await captureMode(context, 'customized', safeUrl);
    await context.close();

    console.log('Reopening the same isolated profile with the local extension excluded for the stock comparison.');
    const stockContext = await startContext('stock');
    try {
      await interceptLocalControlServer(stockContext);
      const stockState = await captureMode(stockContext, 'stock', safeUrl);
      if (stockState.marker || stockState.pin) throw new Error('Unexpected extension marker during stock capture.');
    } finally {
      await stockContext.close();
    }
    if (!customState.pin) throw new Error('No customized extension control was observed.');
    buildReport();
    console.log(`Audit complete. Review ${path.relative(ROOT, path.join(outputDir, 'audit-report.md'))}`);
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  console.error(`Live UI audit stopped: ${error.message}`);
  process.exitCode = 1;
});
