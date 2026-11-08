const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { visualHtml } = require('../helpers/visual-fixture.cjs');
const root = path.resolve(__dirname, '../..');
const scripts = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8')).content_scripts[0].js
  .map(file => fs.readFileSync(path.join(root, 'extension', file), 'utf8'));
test.afterEach(async ({}, info) => {
  await info.attach('visual-metadata', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
    environment: 'chromium-dom-compatibility-fixture',
    behavioralResult: info.status === 'passed' ? 'passed' : info.status === 'skipped' ? 'skipped' : 'failed',
    geometryResult: 'skipped', visualResult: 'skipped',
    reason: 'Behavioral compatibility checks; captures are manually reviewed, with no golden comparison or geometry measurement',
  })) });
});
async function inject(page) { for (const source of scripts) await page.evaluate(source => (0, eval)(source), source); }
async function fixture(page, options = {}) {
  await page.context().route('**/*', route => route.abort('blockedbyclient'));
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: visualHtml(options) }));
  await page.route('http://127.0.0.1:17863/**', route => route.fulfill({ contentType: 'application/json', body: '{"saved":true,"enabled":false}' }));
  await page.goto('https://chatgpt.com/');
  await page.addStyleTag({ path: path.join(root, 'extension/styles/chatgpt-overrides.css') });
  await inject(page);
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-sidebar-status', 'ready');
}

for (const width of [390, 1280]) test(`native discovery rejects duplicate actions in unrelated content at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 850 });
  await fixture(page, { expanded: true });
  await page.evaluate(() => {
    const main = document.querySelector('main');
    const unrelated = document.createElement('section');
    unrelated.innerHTML = '<button aria-label="Search" id="content-decoy">Search this article</button><div role="dialog"><button aria-label="Search" id="dialog-decoy">Search this dialog</button></div>';
    main.prepend(unrelated);
    document.querySelector('#section-shell').prepend(main);
    const native = document.querySelector('.sidebar-navigation [aria-label="Search"]'); native.id = 'correct-search';
    window.nativeSearchClicks = 0; window.decoyClicks = 0;
    native.addEventListener('click', () => window.nativeSearchClicks++);
    unrelated.addEventListener('click', () => window.decoyClicks++);
  });
  expect(await page.evaluate(() => window.__APP_MODE_CONTEXT__.nativeSidebarControl(/^Search$/i)?.id)).toBe('correct-search');
  await page.locator('#content-decoy').evaluate(e => e.remove());
  expect(await page.evaluate(() => window.__APP_MODE_CONTEXT__.nativeSidebarControl(/^Search$/i)?.id)).toBe('correct-search');
  await page.evaluate(() => window.__APP_MODE_CONTEXT__.runSidebarAction(/^Search$/i));
  expect(await page.evaluate(() => ({ native: window.nativeSearchClicks, decoy: window.decoyClicks }))).toEqual({ native: 1, decoy: 0 });
  await page.evaluate(() => {
    const native = document.querySelector('#correct-search');
    for (const [id, attrs] of [['disabled-copy', { disabled: '' }], ['aria-copy', { 'aria-disabled': 'true' }], ['hidden-copy', { hidden: '' }], ['inert-copy', { inert: '' }]]) {
      const copy = native.cloneNode(true); copy.id = id; for (const [key, value] of Object.entries(attrs)) copy.setAttribute(key, value); native.before(copy);
    }
    window.oldNativeSearch = native; native.replaceWith(native.cloneNode(true));
  });
  expect(await page.evaluate(() => { const found = window.__APP_MODE_CONTEXT__.nativeSidebarControl(/^Search$/i); return { id: found?.id, detached: found === window.oldNativeSearch }; })).toEqual({ id: 'correct-search', detached: false });
  await page.evaluate(() => {
    document.querySelector('#synthetic-search').close();
    document.querySelector('#dialog-decoy').closest('section').remove();
    for (const id of ['disabled-copy', 'aria-copy', 'hidden-copy', 'inert-copy']) document.getElementById(id).remove();
    document.querySelector('#section-shell').append(document.querySelector('main'));
  });
  const image = info.outputPath(`compatibility-${width}.png`);
  await page.screenshot({ path: image, animations: 'disabled' });
  await info.attach('synthetic-actual', { path: image, contentType: 'image/png' });
});

test('home adapter releases replaced nodes and unsupported markup through SPA and reinjection', async ({ page }) => {
  await fixture(page, { kind: 'home' });
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-home-layout-status', 'ready');
  await page.evaluate(() => {
    window.previousHome = document.querySelector('.welcome');
    const replacement = previousHome.cloneNode(true);
    // Native React replacement does not copy extension-owned attributes.
    for (const node of [replacement, ...replacement.querySelectorAll('*')]) for (const attr of [...node.attributes]) if (attr.name.startsWith('data-app-mode-')) node.removeAttribute(attr.name);
    previousHome.replaceWith(replacement);
  });
  await expect(page.locator('[data-app-mode-home-layout]')).toHaveCount(1);
  await page.evaluate(() => history.pushState({}, '', '/unsupported-compatibility'));
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-home-layout-status', 'disabled');
  expect(await page.evaluate(() => [...window.previousHome.querySelectorAll('*'), window.previousHome].some(e => [...e.attributes].some(a => a.name.startsWith('data-app-mode-home-'))))).toBe(false);
  await expect(page.locator('[data-app-mode-home-layout]')).toHaveCount(0);
  await page.evaluate(() => { history.pushState({}, '', '/'); document.querySelector('.welcome').innerHTML = '<form><h1>Unknown layout</h1><textarea aria-label="Native editor"></textarea></form>'; });
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-home-layout-status', 'unsupported');
  for (let i = 0; i < 3; i++) await inject(page);
  await expect(page.getByRole('textbox', { name: 'Native editor' })).toBeEditable();
  await expect(page.locator('#app-mode-compact-sidebar-actions')).toHaveCount(1);
  await expect(page.locator('[data-app-mode-home-layout]')).toHaveCount(0);
});

test('Share completion after navigation and header replacement leaves fresh controls authoritative', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const share = document.createElement('button'); share.id = 'synthetic-share'; share.setAttribute('aria-label', 'Share'); share.textContent = 'Share';
    share.onclick = () => { window.shareStarted = true; };
    document.querySelector('header').append(share);
  });
  await expect(page.locator('[data-app-mode-overflow]')).toHaveCount(1);
  await page.locator('[data-app-mode-overflow]').click();
  await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  expect(await page.evaluate(() => window.shareStarted)).toBe(true);
  await page.evaluate(() => {
    window.oldShareState = window.__APP_MODE_CONTEXT__.shareOverflow;
    history.pushState({}, '', '/c/synthetic-replacement');
    const header = document.querySelector('header');
    const replacement = header.cloneNode(true);
    replacement.querySelectorAll('[data-app-mode-overflow]').forEach(e => e.remove());
    for (const e of [replacement, ...replacement.querySelectorAll('*')]) for (const attr of [...e.attributes]) if (attr.name.startsWith('data-app-mode-')) e.removeAttribute(attr.name);
    header.replaceWith(replacement);
    document.querySelector('textarea').focus();
    const late = document.createElement('div'); late.id = 'synthetic-late-dialog'; late.setAttribute('role', 'dialog'); late.textContent = 'Synthetic delayed completion'; document.body.append(late);
  });
  await expect.poll(() => page.evaluate(() => window.oldShareState.cancelFocus === null)).toBe(true);
  await expect(page.locator('[data-app-mode-overflow]')).toHaveCount(1);
  await page.locator('#synthetic-late-dialog').evaluate(e => e.remove());
  await expect(page.locator('textarea')).toBeFocused();
  expect(await page.evaluate(() => ({ oldConnected: window.oldShareState.button.isConnected, newSource: window.__APP_MODE_CONTEXT__.shareOverflow.share === document.querySelector('#synthetic-share'), staleMenu: !!document.querySelector('[data-app-mode-overflow-menu]') }))).toEqual({ oldConnected: false, newSource: true, staleMenu: false });
});
