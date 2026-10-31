// Attach to the debug-enabled Electron App Mode and dump sanitized header
// structure: tags, roles, testids, geometry, control counts only.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const OUTPUT = path.join(__dirname, '..', 'test-results', 'live-audits');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const pages = browser.contexts().flatMap(c => c.pages());
  console.log('targets:', pages.map(p => p.url().slice(0, 60)));
  const page = pages.find(p => p.url().startsWith('https://chatgpt.com')) || pages[0];
  const dump = await page.evaluate(() => {
    const round = v => Math.round(v);
    const rectOf = el => { const r = el.getBoundingClientRect(); return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) }; };
    const describe = (el, depth) => {
      if (!el || depth > 6) return null;
      const style = getComputedStyle(el);
      const controls = [...el.querySelectorAll('button,[role="button"],a[href]')];
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        role: el.getAttribute('role') || undefined,
        testid: el.getAttribute('data-testid') || undefined,
        pos: style.position,
        display: style.display,
        rect: rectOf(el),
        controlCount: controls.length,
        controls: controls.slice(0, 10).map(c => ({
          tag: c.tagName.toLowerCase(),
          role: c.getAttribute('role') || undefined,
          testid: c.getAttribute('data-testid') || undefined,
          ariaLabel: (c.getAttribute('aria-label') || '').slice(0, 40) || undefined,
          haspopup: c.getAttribute('aria-haspopup') || undefined,
          hasSvg: Boolean(c.querySelector('svg')),
          textLen: c.textContent.trim().length,
          rect: rectOf(c),
          marked: c.hasAttribute('data-app-mode-secondary-actions') ? 'secondary'
            : c.hasAttribute('data-app-mode-relocated-share') ? 'share' : undefined,
          parentTestid: c.parentElement?.getAttribute('data-testid') || undefined,
          parentClassCount: c.parentElement?.classList?.length,
        })),
        children: [...el.children].slice(0, 8).map(child => describe(child, depth + 1)).filter(Boolean),
      };
    };
    const headers = [...document.querySelectorAll('header,[role="banner"],#page-header,[data-testid="page-header"]')]
      .filter(el => el.getBoundingClientRect().width > 0);
    const stray = [...document.querySelectorAll('button,[role="button"]')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.top >= 0 && r.top < 160 && !headers.some(h => h.contains(el));
      })
      .slice(0, 20)
      .map(c => ({
        tag: c.tagName.toLowerCase(),
        testid: c.getAttribute('data-testid') || undefined,
        ariaLabel: (c.getAttribute('aria-label') || '').slice(0, 40) || undefined,
        rect: rectOf(c),
        path: (() => { const p = []; let n = c; while (n && n !== document.body && p.length < 6) { p.unshift(n.tagName.toLowerCase() + (n.id ? `#${n.id}` : '') + (n.getAttribute?.('data-testid') ? `[${n.getAttribute('data-testid')}]` : '')); n = n.parentElement; } return p.join('>'); })(),
      }));
    return {
      url: location.pathname === '/' ? '/' : '/c/…',
      bodyMarker: document.body.classList.contains('faux-chatgpt-app-mode'),
      secondaryRow: Boolean(document.getElementById('chatgpt-app-mode-secondary-row')),
      headerBottomVar: document.body.style.getPropertyValue('--app-mode-header-bottom'),
      toolbar: Boolean(document.querySelector('.chatgpt-app-mode-toolbar')),
      headers: headers.map(h => describe(h, 0)),
      strayTopControls: stray,
    };
  });
  fs.mkdirSync(OUTPUT, { recursive: true });
  const file = path.join(OUTPUT, `header-dump-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log('Wrote', file);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
