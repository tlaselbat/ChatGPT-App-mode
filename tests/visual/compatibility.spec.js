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

for (const width of [390, 680, 1024, 1280]) test(`persistent rail preserves native navigation and modal ownership at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 850 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page);
  const rail = page.locator('#app-mode-compact-sidebar-actions');
  const toggle = page.locator('#app-mode-compact-sidebar');
  const labels = ['Scheduled', 'Library', 'Plugins', 'Explore'];
  await expect(rail.locator('button:not([data-app-mode-rail-account])')).toHaveText(['', '', '', '']);
  expect(await rail.locator('button:not([data-app-mode-rail-account])').evaluateAll(items => items.map(item => item.getAttribute('aria-label')))).toEqual(labels);
  await expect(rail).toHaveJSProperty('inert', false);
  await expect(page.locator('main')).toHaveCSS('margin-left', '8px');
  expect((await page.locator('main').boundingBox()).x).toBe(60);
  await toggle.click();
  const state = width < 700 ? 'drawer' : 'docked';
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', state);
  const panel = page.locator(state === 'drawer' ? '#browser-sidebar-popover' : 'aside');
  await expect(rail).toHaveJSProperty('inert', state === 'drawer');
  await expect(rail).toHaveCSS('visibility', 'visible');
  const panelBox = await panel.boundingBox();
  expect(panelBox.x).toBe(52);
  if (state === 'docked') {
    await expect(rail).toHaveCSS('opacity', '1');
    expect((await page.locator('main').boundingBox()).x - panelBox.x - panelBox.width).toBeCloseTo(8, 0);
    await expect(panel.locator('[data-app-mode-rail-original]')).toHaveCount(4);
    for (const label of labels) await expect(panel.locator('[data-app-mode-rail-original]').filter({ hasText: new RegExp(`^${label}$`) })).toBeHidden();
    for (const label of ['Scheduled', 'Library']) {
      await rail.getByRole('button', { name: label, exact: true }).click();
      await expect(rail.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
    }
    for (const label of ['Plugins', 'Explore']) {
      await panel.locator('button').filter({ hasText: new RegExp(`^${label}$`) }).evaluate((target, label) => {
        target.onclick = () => {
          const rect = target.getBoundingClientRect(); window.syntheticUtilityAnchor = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', label);
          const close = document.createElement('button'); close.textContent = 'Close utility'; close.onclick = () => menu.remove();
          menu.append(close); document.body.append(menu); close.focus();
        };
      }, label);
      const trigger = rail.getByRole('button', { name: label, exact: true });
      const bounds = await trigger.boundingBox();
      await trigger.click();
      await expect(page.getByRole('menu', { name: label })).toBeVisible();
      expect(await page.evaluate(() => window.syntheticUtilityAnchor)).toEqual(bounds);
      await page.getByRole('button', { name: 'Close utility' }).click();
    }
  } else {
    // The drawer presents the same unified surface: rail utilities are
    // suppressed inside the modal the same way they are in the docked panel.
    await expect(panel.locator('[data-app-mode-rail-original]')).toHaveCount(4);
    for (const label of labels) await expect(panel.locator('[data-app-mode-rail-original]').filter({ hasText: new RegExp(`^${label}$`) })).toBeHidden();
  }
  await panel.getByRole('link', { name: 'New chat', exact: true }).click();
  await expect(rail.locator('[data-app-mode-rail-active]')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search conversations' })).toBeFocused();
  await page.locator('#close-search').click();
  for (const key of ['pinned', 'projects']) {
    await panel.locator(`[data-native-section="${key}"]`).click();
    await expect(panel.locator(`[data-native-section="${key}"]`)).toHaveAttribute('aria-expanded', 'true');
    await panel.locator(`[data-section="${key}"] a`).first().click();
  }
  await panel.locator('[data-section="recents"] a').first().click();
  await panel.locator('#native-account').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  const image = info.outputPath(`persistent-expanded-${width}.png`);
  await page.screenshot({ path: image, animations: 'disabled' });
  await info.attach('synthetic-actual', { path: image, contentType: 'image/png' });
  if (state === 'drawer') await page.keyboard.press('Escape'); else await toggle.click();
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'compact');
  await expect(rail).toHaveJSProperty('inert', false);
  expect((await page.locator('main').boundingBox()).x).toBe(60);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('persistent rail popup anchors account for native scroll containment without resetting scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page, { expanded: true });
  const scroll = page.locator('aside .nav-scroll');
  await scroll.evaluate(element => element.style.contain = 'layout paint');
  await page.locator('aside button').filter({ hasText: /^Explore$/ }).evaluate(target => {
    target.setAttribute('aria-haspopup', 'menu');
    target.onkeydown = event => { if (event.key === 'Enter') target.click(); };
    target.onclick = () => {
      const rect = target.getBoundingClientRect();
      window.syntheticUtilityAnchor = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Explore');
      menu.style.cssText = `left:${rect.right + 5}px;top:${rect.top}px;bottom:auto;width:160px;height:120px`;
      const close = document.createElement('button'); close.textContent = 'Close utility'; close.onclick = () => menu.remove();
      menu.append(close); document.body.append(menu); close.focus();
    };
  });
  const trigger = page.locator('#app-mode-compact-sidebar-actions [aria-label="Explore"]');
  for (const position of [0, 320, 700]) {
    await scroll.evaluate((element, position) => element.scrollTop = position, position);
    const before = await scroll.evaluate(element => element.scrollTop);
    expect(before).toBe(position);
    const box = await trigger.boundingBox();
    await trigger.click();
    expect(await page.evaluate(() => window.syntheticUtilityAnchor)).toEqual(box);
    const menu = page.getByRole('menu', { name: 'Explore' });
    await expect(menu).toBeVisible();
    const popup = await menu.boundingBox();
    expect(popup.x).toBe(box.x + box.width + 5);
    expect(popup.y).toBe(box.y);
    expect(popup.x + popup.width).toBeLessThanOrEqual(1280);
    expect(popup.y + popup.height).toBeLessThanOrEqual(850);
    expect(await scroll.evaluate(element => element.scrollTop)).toBe(before);
    await page.getByRole('button', { name: 'Close utility' }).click();
    await expect(trigger).toBeFocused();
  }
});

for (const width of [390, 1280]) test(`persistent rail leaves native project folders and history controls authoritative at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page, { expanded: true });
  const panel = page.locator(width < 700 ? '#browser-sidebar-popover' : 'aside');
  await panel.locator('[data-native-section="projects"]').click();
  await panel.evaluate(panel => {
    const projects = panel.querySelector('[data-section="projects"] a').parentElement;
    const folder = document.createElement('button'); folder.textContent = 'Native project folder'; folder.setAttribute('aria-expanded', 'false');
    const children = document.createElement('div'); children.hidden = true;
    children.innerHTML = '<a href="/g/g-synthetic/c/nested-native">Synthetic nested conversation</a>';
    folder.onclick = () => { children.hidden = !children.hidden; folder.setAttribute('aria-expanded', String(!children.hidden)); };
    projects.prepend(folder, children);
    const recents = panel.querySelector('[data-section="recents"] a').parentElement;
    const more = document.createElement('button'); more.textContent = 'Load native history';
    more.onclick = () => { const link = document.createElement('a'); link.href = '/c/native-paginated'; link.textContent = 'Synthetic paginated conversation'; more.before(link); };
    recents.append(more);
    recents.querySelector('a').oncontextmenu = event => {
      event.preventDefault();
      const menu = document.createElement('div'); menu.setAttribute('role', 'menu');
      const close = document.createElement('button'); close.textContent = 'Close native context'; close.onclick = () => menu.remove();
      menu.append(close); document.body.append(menu);
    };
  });
  const folder = panel.getByRole('button', { name: 'Native project folder' });
  const original = await folder.elementHandle();
  await folder.focus(); await page.keyboard.press('Enter');
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  await panel.getByRole('link', { name: 'Synthetic nested conversation' }).click();
  expect(await page.evaluate(() => window.__APP_MODE_CONTEXT__.navigationAdapter.activeDestination())).toBe('projects');
  await panel.locator('[data-section="recents"] a').first().click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('button', { name: 'Close native context' }).click();
  await panel.getByRole('button', { name: 'Load native history' }).click();
  await panel.getByRole('link', { name: 'Synthetic paginated conversation' }).click();
  expect(await page.evaluate(() => window.__APP_MODE_CONTEXT__.navigationAdapter.activeDestination())).toBe('recents');
  expect(await original.evaluate(element => element.isConnected)).toBe(true);
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
});

for (const reservation of ['none', 'flow-rail', 'fixed-rail']) test(`persistent rail reserves one column with ${reservation}`, async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page);
  await page.evaluate(reservation => {
    document.querySelector('aside').remove();
    if (reservation === 'none') return;
    const rail = document.createElement('nav'); rail.className = 'group/sidebar-rail';
    rail.style.cssText = 'width:52px;flex:none;' + (reservation === 'fixed-rail' ? 'position:fixed;left:0;top:0' : '');
    rail.innerHTML = '<button aria-label="Native utility">Native</button>';
    document.querySelector('#section-shell').prepend(rail);
  }, reservation);
  await expect.poll(async () => (await page.locator('main').boundingBox()).x).toBe(60);
  await page.locator('#app-mode-compact-sidebar').click();
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'docked');
  expect((await page.locator('aside').boundingBox()).x).toBe(52);
  const bounds = await page.locator('aside').boundingBox();
  expect((await page.locator('main').boundingBox()).x).toBeCloseTo(bounds.x + bounds.width + 8, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('persistent rail restores failed native utilities and releases all ownership on rollback', async ({ page }) => {
  await fixture(page, { expanded: true });
  const plugin = page.locator('.sidebar-navigation button').filter({ hasText: /^Plugins$/ });
  await expect(plugin).toHaveAttribute('data-app-mode-rail-original', '');
  await plugin.evaluate(target => target.onclick = () => {
    const replacement = target.cloneNode(true); replacement.removeAttribute('data-app-mode-rail-original'); target.replaceWith(replacement);
  });
  await page.locator('#app-mode-compact-sidebar-actions [aria-label="Plugins"]').click();
  await expect(plugin).toBeVisible();
  await expect(plugin).toBeFocused();
  await expect(page.locator('#app-mode-compact-sidebar-actions [aria-label="Plugins"]')).toBeHidden();
  expect(await page.evaluate(() => {
    const observer = new MutationObserver(() => {}); observer.observe(document.body, { attributes: true, subtree: true });
    for (let i = 0; i < 20; i++) window.__APP_MODE_CONTEXT__.navigationAdapter.find(/^Library$/i);
    const writes = observer.takeRecords().length; observer.disconnect(); return writes;
  })).toBe(0);
  await page.evaluate(() => window.syntheticSidebarRender());
  await expect(page.locator('#app-mode-compact-sidebar-actions [aria-label="Plugins"]')).toBeVisible();
  await expect(plugin).toBeHidden();
  await page.evaluate(() => {
    const c = window.__APP_MODE_CONTEXT__; c.navigationController.reset(); c.persistentRailEnabled = false; c.navigationController.schedule();
  });
  await expect(page.locator('body')).not.toHaveAttribute('data-app-mode-persistent-rail');
  await expect(page.locator('[data-app-mode-rail-original]')).toHaveCount(0);
  await expect(page.locator('#app-mode-compact-sidebar-actions')).toBeHidden();
  expect((await page.locator('aside').boundingBox()).x).toBe(0);
  await page.evaluate(() => { const c = window.__APP_MODE_CONTEXT__; c.compactSidebarEnabled = false; c.navigationController.schedule(); });
  await expect(page.locator('#app-mode-compact-sidebar-actions')).toHaveCount(0);
  await expect(page.locator('[data-app-mode-compact-sidebar-shell]')).toHaveCount(0);
  await expect(plugin).toBeVisible();
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
