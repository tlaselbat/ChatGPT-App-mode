// Synthetic-only counters. Never attach to a live profile.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const revision = process.argv[2];
const read = file => revision ? execFileSync('git', ['show', `${revision}:${file}`], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(path.join(root, file), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<html><head><title>ChatGPT</title><style>body{margin:0}header{height:40px}aside{width:260px;height:800px}main{height:3000px}</style></head><body><div data-app-shell-responsive-sidebar="true" data-app-shell-sidebar-open="false"><header><button aria-label="Open sidebar">Sidebar</button><button aria-label="Search">Search</button></header><aside class="app-shell-left-panel" hidden><nav><button aria-label="New chat">New</button></nav></aside><main><header>ChatGPT</header><div id="messages"></div><form><textarea></textarea></form></main></div></body></html>' }));
    await page.goto('https://chatgpt.com/');
    await page.evaluate(() => {
      window.fetch = async () => ({ ok: true, json: async () => ({ enabled: false, saved: true }) });
      window.metrics = { observers: 0, reconciliations: 0, reconcileMs: 0, scans: 0, styles: 0, titleSamples: 0 };
      const Observer = window.MutationObserver;
      window.MutationObserver = class extends Observer { constructor(callback) { super((...args) => { metrics.observers++; callback(...args); }); } };
      for (const proto of [Document.prototype, Element.prototype]) {
        const query = proto.querySelectorAll;
        proto.querySelectorAll = function(...args) { metrics.scans++; return query.apply(this, args); };
      }
      const style = window.getComputedStyle;
      window.getComputedStyle = (...args) => { metrics.styles++; return style(...args); };
    });
    for (const file of JSON.parse(read('extension/manifest.json')).content_scripts[0].js) await page.evaluate(source => (0, eval)(source), read(`extension/${file}`));
    await page.evaluate(source => (0, eval)(source), read('WindowHost/header.js'));
    const controls = read('WindowHost/controls-host.cjs');
    const sampler = controls.slice(controls.indexOf('function observeVisualTheme('), controls.indexOf('function installWindowControls('));
    await page.evaluate(source => {
      (0, eval)(source + ';window.syntheticThemeSampler = observeVisualTheme;');
      let last = '';
      (async () => { while (true) { const value = await syntheticThemeSampler(last); if (!value) break; metrics.titleSamples++; last = JSON.stringify(value); } })();
      const c = window.__APP_MODE_CONTEXT__;
      for (const name of ['ensureCompactSidebar', 'ensureHomeLayout', 'ensureShareMenu', 'ensurePinButton']) {
        const fn = c[name]; if (!fn) continue;
        c[name] = function(...args) { const start = performance.now(); metrics.reconciliations++; try { return fn.apply(this, args); } finally { metrics.reconcileMs += performance.now() - start; } };
      }
    }, sampler);
    await page.waitForTimeout(600);
    const results = [];
    for (const scenario of ['idle-home', 'idle-long', 'streaming', 'sidebar', 'compact-expanded', 'dialogs', 'theme', 'resize', 'scroll']) {
      if (scenario === 'idle-long') await page.evaluate(() => { document.querySelector('#messages').innerHTML = '<p>Synthetic</p>'.repeat(500); });
      await page.evaluate(() => { for (const key of Object.keys(metrics)) metrics[key] = 0; });
      const start = Date.now();
      if (scenario.startsWith('idle')) await page.waitForTimeout(2000);
      else for (let i = 0; i < 40; i++) {
        if (scenario === 'resize') await page.setViewportSize({ width: i % 2 ? 680 : 1280, height: 900 });
        else await page.evaluate(({ scenario, i }) => {
          const shell = document.querySelector('[data-app-shell-responsive-sidebar]');
          if (scenario === 'streaming') { for (let j = 0; j < 8; j++) { const p = document.createElement('span'); p.textContent = 'Synthetic'; document.querySelector('#messages').append(p); } }
          if (scenario === 'sidebar' || scenario === 'compact-expanded') { shell.setAttribute('data-app-shell-sidebar-open', String(!!(i % 2))); document.querySelector('aside').hidden = !(i % 2); }
          if (scenario === 'dialogs') { document.querySelector('[role="dialog"]')?.remove(); if (i % 2) { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.textContent = 'Synthetic'; document.body.append(d); } }
          if (scenario === 'theme') document.documentElement.style.color = i % 2 ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
          if (scenario === 'scroll') scrollTo(0, i % 2 ? 500 : 0);
        }, { scenario, i });
        await page.waitForTimeout(25);
      }
      await page.waitForTimeout(100);
      results.push({ scenario, seconds: (Date.now() - start) / 1000, ...await page.evaluate(() => metrics) });
    }
    console.log(JSON.stringify({ revision: revision || 'working-tree', results }, null, 2));
  } finally { await browser.close(); }
})();
