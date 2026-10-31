// Privacy-safe structural dump of the live ChatGPT header for App Mode
// development. Prints ONLY tag/role/testid/geometry/control-structure data —
// no page text, URLs, labels beyond generic control names, cookies, or
// conversation content. Uses the isolated live-review profile; the user must
// confirm a blank home or standard /c/ test-conversation route before capture.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const EXTENSION = path.join(ROOT, 'extension');
const PROFILE = path.join(ROOT, 'test-results', 'live-review-profile');
const OUTPUT = path.join(ROOT, 'test-results', 'live-audits');
const CHROME = process.env.APP_MODE_CHROMIUM_EXE || '';

async function run() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE, {
    ...(CHROME && fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check',
      `--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  await context.route('http://127.0.0.1:17863/**', route => route.fulfill({
    status: 200,
    headers: { 'Access-Control-Allow-Origin': 'https://chatgpt.com', 'Access-Control-Allow-Private-Network': 'true', 'Content-Type': 'application/json' },
    body: '{"saved":false,"enabled":false}',
  }));
  let release;
  const clicked = new Promise(resolve => { release = resolve; });
  await context.exposeBinding('__dumpReady', () => release());
  await context.addInitScript(() => {
    const install = () => {
      if (document.getElementById('chatgpt-header-dump-gate') || location.hostname !== 'chatgpt.com' || !document.body) return;
      const gate = document.createElement('div');
      gate.id = 'chatgpt-header-dump-gate';
      gate.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;background:#151515;color:#fff;padding:12px;border-radius:10px;font:13px system-ui;max-width:300px';
      gate.innerHTML = 'Use home or a blank test /c/ route, then:<br><button type="button" style="margin-top:8px;padding:8px 12px;cursor:pointer">Dump header structure</button><div role="status" style="margin-top:6px"></div>';
      gate.querySelector('button').addEventListener('click', () => {
        const safe = location.pathname === '/' || /^\/c\/[A-Za-z0-9-]+\/?$/.test(location.pathname);
        if (!safe || location.search || location.hash) {
          gate.querySelector('[role=status]').textContent = 'Unsafe route — go home or open a plain /c/ test chat.';
          return;
        }
        window.__dumpReady();
      });
      document.body.appendChild(gate);
    };
    new MutationObserver(install).observe(document, { childList: true, subtree: true });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
  console.log('Window opened. Sign in if needed, then click "Dump header structure" on a safe route.');
  await clicked;
  await page.waitForTimeout(300);
  const dump = await page.evaluate(() => {
    const round = v => Math.round(v);
    const rectOf = el => { const r = el.getBoundingClientRect(); return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) }; };
    const seen = new Set();
    const describe = (el, depth) => {
      if (!el || depth > 6) return null;
      const style = getComputedStyle(el);
      const controls = [...el.querySelectorAll('button,[role="button"],a[href]')];
      const node = {
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        role: el.getAttribute('role') || undefined,
        testid: el.getAttribute('data-testid') || undefined,
        classes: [...el.classList].filter(c => !c.startsWith('data-')).slice(0, 4),
        pos: style.position,
        display: style.display,
        rect: rectOf(el),
        controlCount: controls.length,
        controls: controls.slice(0, 8).map(c => ({
          tag: c.tagName.toLowerCase(),
          role: c.getAttribute('role') || undefined,
          testid: c.getAttribute('data-testid') || undefined,
          ariaLabel: (c.getAttribute('aria-label') || '').slice(0, 40) || undefined,
          haspopup: c.getAttribute('aria-haspopup') || undefined,
          hasSvg: Boolean(c.querySelector('svg')),
          textLen: c.textContent.trim().length,
          rect: rectOf(c),
          marked: c.getAttribute('data-app-mode-secondary-actions') !== null ? 'secondary' :
            c.getAttribute('data-app-mode-relocated-share') !== null ? 'share' : undefined,
          parentTestid: c.parentElement?.getAttribute('data-testid') || undefined,
        })),
        children: [...el.children].slice(0, 8).map(child => describe(child, depth + 1)).filter(Boolean),
      };
      return node;
    };
    const headers = [...document.querySelectorAll('header,[role="banner"],#page-header,[data-testid="page-header"]')]
      .filter(el => el.getBoundingClientRect().width > 0);
    // Also find stray fixed/absolute control clusters near the top outside the header.
    const stray = [...document.querySelectorAll('body button,body [role="button"]')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.top >= 0 && r.top < 140 && ![...headers].some(h => h.contains(el));
      })
      .slice(0, 20)
      .map(c => ({
        tag: c.tagName.toLowerCase(), testid: c.getAttribute('data-testid') || undefined,
        ariaLabel: (c.getAttribute('aria-label') || '').slice(0, 40) || undefined,
        rect: rectOf(c), path: (() => { const p = []; let n = c; while (n && n !== document.body && p.length < 5) { p.unshift(n.tagName.toLowerCase() + (n.id ? `#${n.id}` : '')); n = n.parentElement; } return p.join('>'); })(),
      }));
    return {
      bodyMarker: document.body.classList.contains('faux-chatgpt-app-mode'),
      secondaryRow: Boolean(document.getElementById('chatgpt-app-mode-secondary-row')),
      headerBottomVar: document.body.style.getPropertyValue('--app-mode-header-bottom'),
      headers: headers.map(h => describe(h, 0)),
      strayTopControls: stray,
    };
  });
  const file = path.join(OUTPUT, `header-dump-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log('Wrote', file);
  await context.close();
}

run().catch(error => { console.error(error); process.exit(1); });
