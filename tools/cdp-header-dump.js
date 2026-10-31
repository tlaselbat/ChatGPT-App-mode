// Attach to the debug-enabled Electron App Mode and dump sanitized header
// structure: tags, roles, testids, geometry, control counts only.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const OUTPUT = path.join(__dirname, '..', 'test-results', 'live-audits');
let stage = 'connect';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  try {
    const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('https://chatgpt.com/'));
    if (!page) throw new Error('Open the blank home route in the isolated review host first.');
    stage = 'initial-home-navigation';
    await page.keyboard.press('Escape');
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
    const output = path.join(OUTPUT, `header-${Date.now()}`);
    fs.mkdirSync(output, { recursive: true });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-app-mode-header-tabs]');
    await page.waitForTimeout(1000);
    const samples = [];
    for (let index = 0; index < 12; index++) {
      stage = `sample-${index}-interaction`;
      let action = 'settle';
      let performed = true;
      if (index === 8) {
        action = 'home-navigation';
        await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-app-mode-header-tabs]');
      }
      if (index === 3) {
        action = 'sidebar-toggle';
        const sidebar = page.locator('button[data-testid="open-sidebar-button"], button[data-testid="close-sidebar-button"], button[aria-label="Open sidebar"], button[aria-label="Close sidebar"], button[aria-label="Sidebar" i], [data-app-mode-header-control-branch="leading"] button').filter({ visible: true }).first();
        performed = Boolean(await sidebar.count());
        if (performed) await sidebar.click();
      }
      if (index === 4) {
        action = 'sidebar-dismiss';
        await page.keyboard.press('Escape');
      }
      if (index === 5 || index === 6) {
        action = 'mode-toggle';
        await page.locator('[data-app-mode-header-tabs] button').nth(index % 2).click();
      }
      if (index === 2 || index === 7) {
        action = 'reconcile';
        await page.locator('[data-app-mode-header-layout]').evaluate(header => header.classList.toggle('app-mode-review-reconcile'));
      }
      await page.waitForTimeout(250);
      stage = `sample-${index}-geometry`;
      const record = await page.evaluate(() => {
        if (location.pathname !== '/' || location.search || location.hash) throw new Error('Capture requires blank home.');
        const rect = element => {
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
        };
        const describe = element => {
          const style = getComputedStyle(element);
          return { tag: element.tagName, box: rect(element), display: style.display, position: style.position,
            flex: style.flex, minWidth: style.minWidth, width: style.width, margin: style.margin, padding: style.padding,
            borderWidth: style.borderWidth, borderRadius: style.borderRadius, overflow: style.overflow,
            fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight };
        };
        const tabs = document.querySelector('[data-app-mode-header-tabs]');
        if (!tabs || tabs.querySelectorAll('button').length !== 2) throw new Error('Visible switch unavailable.');
        const header = tabs.closest('[data-app-mode-header-layout]');
        const box = rect(tabs);
        const ancestors = [];
        for (let node = tabs; node && ancestors.length < 10; node = node.parentElement) ancestors.push(describe(node));
        const controls = [...header.querySelectorAll('button,a[href],[role="button"]')].filter(element => {
          const box = rect(element);
          return !element.closest('[inert]') && box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
        }).map(element => ({ ...describe(element), mode: tabs.contains(element) }));
        const titles = [...header.children].filter(element => !element.querySelector('button') && element.getBoundingClientRect().width > 1).map(describe);
        return { viewportCss: { width: innerWidth, height: innerHeight }, devicePixelRatio, visualViewportScale: visualViewport?.scale,
          switchCss: box, centerErrorCss: box.x + box.width / 2 - innerWidth / 2,
          clearanceCss: { top: box.y - rect(header).y, bottom: rect(header).bottom - box.bottom },
          centering: header.getAttribute('data-app-mode-header-centering'), ancestors, controls, titles };
      });
      const screenshot = `header-${String(index).padStart(2, '0')}.png`;
      const image = await page.screenshot({
        path: path.join(output, screenshot), scale: 'css',
        clip: { x: 0, y: 0, width: record.viewportCss.width, height: 40 },
        style: '* { -webkit-text-fill-color: transparent !important; background-image: none !important; } [data-app-mode-header-tabs], [data-app-mode-header-tabs] * { -webkit-text-fill-color: initial !important; } img, video, canvas, svg text { visibility: hidden !important; }',
      });
      samples.push({ index, action, performed, ...record, screenshot, screenshotPixels: { width: image.readUInt32BE(16), height: image.readUInt32BE(20) }, screenshotScale: 'css' });
      fs.writeFileSync(path.join(output, 'geometry.json'), JSON.stringify(samples, null, 2));
    }
    fs.writeFileSync(path.join(output, 'geometry.json'), JSON.stringify(samples, null, 2));
    console.log(JSON.stringify({ output: path.relative(path.join(__dirname, '..'), output), samples: samples.length,
      viewportCss: samples[0].viewportCss, maxCenterErrorCss: Math.max(...samples.map(sample => Math.abs(sample.centerErrorCss))),
      screenshotPixels: samples[0].screenshotPixels, devicePixelRatio: samples[0].devicePixelRatio }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(`Header capture stopped at ${stage} (${error.name}); use the isolated review host on blank home. No page data logged.`); process.exitCode = 1; });
