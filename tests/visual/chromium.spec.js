const { test: base, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { visualHtml } = require('../helpers/visual-fixture.cjs');
const root = path.resolve(__dirname, '../..');
const extension = path.join(root, 'extension');

const test = base.extend({
  context: async ({}, use, info) => {
    const profile = fs.mkdtempSync(path.join(info.outputPath(), 'synthetic-profile-'));
    const context = await chromium.launchPersistentContext(profile, {
      headless: false, viewport: { width: 1280, height: 900 }, serviceWorkers: 'block',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run'],
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    await context.route('**/*', route => route.abort('blockedbyclient'));
    try { await use(context); }
    finally {
      if (info.status !== info.expectedStatus) {
        const trace = info.outputPath('synthetic-trace.zip');
        await context.tracing.stop({ path: trace });
        await info.attach('synthetic-trace', { path: trace, contentType: 'application/zip' });
      } else await context.tracing.stop();
      await context.close();
    }
  },
  page: async ({ context }, use) => { const page = await context.newPage(); await use(page); },
});
test.use({ trace: 'off' }); // This manually owned persistent context manages its trace explicitly.

const cases = [
  ['home-expanded-light', 1280, 900, 'light', true, 'home'],
  ['home-compact-dark', 1280, 900, 'dark', false, 'home'],
  ['conversation-expanded-dark', 1280, 900, 'dark', true, 'conversation'],
  ['conversation-compact-light', 1280, 900, 'light', false, 'conversation'],
  ['project-navigation-light', 1280, 900, 'light', true, 'project'],
  ['search-modal-dark', 1280, 900, 'dark', false, 'search'],
  ['compact-390-light', 390, 844, 'light', false, 'conversation'],
  ['compact-390-dark', 390, 844, 'dark', false, 'conversation'],
  ['home-480-light', 480, 850, 'light', false, 'home'],
  ['home-481-light', 481, 850, 'light', false, 'home'],
  ['conversation-680-dark', 680, 850, 'dark', false, 'conversation'],
  ['selected-focus-light', 680, 850, 'light', false, 'selection'],
];

for (const [id, width, height, theme, expanded, kind] of cases) {
  test(`golden ${id}`, async ({ page, context }, info) => {
    const evidence = { environment: 'chromium-fixture', viewport: { width, height, unit: 'css-px' }, zoom: 1, appearance: theme, sidebar: expanded ? 'expanded' : 'compact', browser: context.browser().version(), behavioralResult: 'unavailable', geometryResult: 'unavailable', visualResult: 'unavailable' };
    try {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      const url = kind === 'home' ? '/' : kind === 'project' ? '/g/g-synthetic/project' : kind === 'selection' ? '/library' : '/c/synthetic-recents-0';
      await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: visualHtml({ theme, expanded, kind }) }));
      await page.route('http://127.0.0.1:17863/**', route => route.fulfill({ contentType: 'application/json', body: '{"saved":true,"enabled":false}' }));
      await page.goto('https://chatgpt.com' + url);
      await expect(page.locator('body')).toHaveAttribute('data-app-mode-sidebar-status', 'ready');
      await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', expanded ? 'docked' : 'compact');
      await page.evaluate(() => document.fonts.ready);
      if (kind === 'home') await expect(page.locator('[data-app-mode-home-layout]')).toHaveCount(1);
      if (kind === 'project') await expect(page.locator('[data-section="projects"] a').first()).toBeVisible();
      if (kind === 'search') {
        await page.locator('#app-mode-compact-sidebar-actions [aria-label="Search"]').click();
        await expect(page.locator('#synthetic-search')).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Search conversations' })).toBeFocused();
        evidence.sidebar = await page.locator('body').getAttribute('data-app-mode-navigation-state');
      }
      if (kind === 'selection') {
        const active = page.locator('[data-app-mode-rail-active]');
        await expect(active).toHaveAttribute('aria-label', 'Library');
        await active.focus();
        await expect(active).toBeFocused();
        expect(await active.evaluate(e => getComputedStyle(e).outlineStyle)).not.toBe('none');
      }
      evidence.behavioralResult = 'passed';
      const geometry = await page.evaluate(() => {
        const box = selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null; };
        return { viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth, main: box('main'), rail: box('#app-mode-compact-sidebar-actions'), sidebar: box('aside'), dialog: box('dialog[open]'), composer: box('form'), header: box('main header') };
      });
      evidence.geometry = geometry;
      expect(geometry.scrollWidth).toBeLessThanOrEqual(width);
      expect(geometry.main.right).toBeLessThanOrEqual(width + 1);
      expect(geometry.composer.right).toBeLessThanOrEqual(width + 1);
      expect(geometry.composer.x).toBeGreaterThanOrEqual(geometry.main.x);
      expect(geometry.composer.bottom).toBeLessThanOrEqual(height);
      if (!expanded) expect(geometry.rail.width).toBe(52);
      else expect(Math.abs(geometry.sidebar.right - geometry.main.x)).toBeLessThanOrEqual(8);
      if (geometry.dialog) { expect(geometry.dialog.x).toBeGreaterThanOrEqual(0); expect(geometry.dialog.right).toBeLessThanOrEqual(width); }
      evidence.geometryResult = 'passed';
      // Opt-in negative probe: must fail against the approved baseline, never update it.
      if (process.env.APP_MODE_VISUAL_PROBE === 'geometry') {
        if (!['none', 'default'].includes(info.config.updateSnapshots)) throw Error('Regression probe refuses baseline updates');
        await page.addStyleTag({ content: 'main{transform:translateX(4px)!important}' });
      }
      const actual = info.outputPath('actual.png');
      await page.screenshot({ path: actual, animations: 'disabled', caret: 'hide' });
      const png = fs.readFileSync(actual);
      evidence.screenshotDimensions = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
      expect(evidence.screenshotDimensions).toEqual({ width, height });
      await info.attach('synthetic-actual', { path: actual, contentType: 'image/png' });
      evidence.visualResult = 'failed';
      await expect(page).toHaveScreenshot(`${id}.png`);
      evidence.visualResult = 'passed';
    } finally {
      await info.attach('visual-metadata', { body: Buffer.from(JSON.stringify(evidence)), contentType: 'application/json' });
    }
  });
}
