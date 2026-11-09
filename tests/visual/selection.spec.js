const { test: base, expect, chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { visualHtml } = require('../helpers/visual-fixture.cjs');
const root = path.resolve(__dirname, '../..');
const extension = path.join(root, 'extension');

const test = base.extend({
  context: async ({}, use, info) => {
    const profile = fs.mkdtempSync(path.join(info.outputPath(), 'selection-profile-'));
    const context = await chromium.launchPersistentContext(profile, { headless: false, viewport: { width: 1280, height: 850 }, serviceWorkers: 'block',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run'] });
    await context.route('**/*', route => route.abort('blockedbyclient'));
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => { const page = await context.newPage(); await use(page); },
});

function fixture(theme) {
  return visualHtml({ theme }).replace('</body>', `<script>(()=>{
    const render=window.syntheticSidebarRender;
    function seed(){const content=document.querySelector('[data-section="projects"] [data-native-section]')?.closest('[class~="group/nav-section-title"]').nextElementSibling;
      if(content&&!content.querySelector('[data-selection-project-member]')){const link=document.createElement('a');link.href='/g/g-synthetic/c/selection-member';link.textContent='Synthetic project conversation';link.setAttribute('data-selection-project-member','');content.append(link)}}
    window.render=()=>{render();seed()};window.syntheticSidebarRender=window.render;seed();
  })();</script></body>`);
}

for (const theme of ['light', 'dark']) test(`compact selection retains native authority and contrast ${theme}`, async ({ page }, info) => {
  const evidence = { environment: 'chromium-selection-fixture', appearance: theme, behavioralResult: 'unavailable', geometryResult: 'unavailable', visualResult: 'skipped', reason: 'Selection images are inspected manually; accepted goldens are unchanged', scenarios: [] };
  const rail = page.locator('#app-mode-compact-sidebar-actions');
  const active = rail.locator('[data-app-mode-rail-active]');
  let readDestination;
  const select = async (label, scenario) => {
    const destination = ['Pinned', 'Projects', 'Recents'].includes(label) ? label.toLowerCase() : label;
    await expect.poll(readDestination).toBe(destination);
    label = ['Scheduled', 'Library', 'Plugins', 'Explore'].includes(label) ? label : null;
    await expect(active).toHaveCount(label ? 1 : 0);
    await expect(rail.locator('[aria-current="page"]')).toHaveCount(label ? 1 : 0);
    if (label) { await expect(active).toHaveAttribute('aria-label', label); await expect(active).toHaveAttribute('aria-current', 'page'); }
    evidence.scenarios.push({ scenario, destination, selected: label, result: 'passed' });
  };
  const route = async pathname => { await page.evaluate(path => history.pushState({}, '', path), pathname); };
  const capture = async name => { const file = info.outputPath(name + '.png'); await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' }); await info.attach('synthetic-actual', { path: file, contentType: 'image/png' }); };
  try {
    page.on('pageerror', error => console.error('Synthetic selection fixture error: ' + error.message));
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript(() => { window.syntheticSelectionDocument = Math.random(); });
    await page.route('https://chatgpt.com/**', request => request.fulfill({ contentType: 'text/html', body: fixture(theme) }));
    await page.route('http://127.0.0.1:17863/**', request => request.fulfill({ contentType: 'application/json', body: '{"saved":true,"enabled":false}' }));
    await page.goto('https://chatgpt.com/');
    await expect(page.locator('body')).toHaveAttribute('data-app-mode-sidebar-status', 'ready');
    await expect(page.locator('[data-selection-project-member]')).toHaveCount(1);
    const session = await page.context().newCDPSession(page);
    const contexts = new Set();
    session.on('Runtime.executionContextCreated', ({ context }) => contexts.add(context.id));
    session.on('Runtime.executionContextDestroyed', ({ executionContextId }) => contexts.delete(executionContextId));
    session.on('Runtime.executionContextsCleared', () => contexts.clear());
    await session.send('Runtime.enable');
    readDestination = async () => {
      for (const contextId of contexts) {
        const { result } = await session.send('Runtime.evaluate', { contextId, expression: 'window.__APP_MODE_CONTEXT__?.navigationAdapter?.activeDestination()', returnByValue: true });
        if (result.type !== 'undefined') return result.value;
      }
    };
    await select('New chat', 'blank home');
    const documentToken = await page.evaluate(() => window.syntheticSelectionDocument);
    for (const [pathname, label, scenario] of [
      ['/c/synthetic-recents-0', 'Recents', 'existing conversation with native membership'],
      ['/g/g-synthetic/project', 'Projects', 'recognized project landing'],
      ['/g/g-synthetic/c/selection-member', 'Projects', 'recognized project conversation'],
      ['/g/g-synthetic/c/unmounted', null, 'project-shaped URL without membership'],
      ['/library', 'Library', 'library'], ['/scheduled', 'Scheduled', 'scheduled tasks'],
      ['/unsupported-selection', null, 'unknown route'],
    ]) { await route(pathname); await select(label, scenario); }
    expect(await page.evaluate(() => window.syntheticSelectionDocument)).toBe(documentToken);
    evidence.scenarios.push({ scenario: 'SPA navigation without reload', result: 'passed' });
    await route('/g/g-synthetic/c/selection-member'); await select('Projects', 'return to project conversation');
    await capture('project-conversation-' + theme);
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.syntheticSelectionDocument)).not.toBe(documentToken);
    await select('Projects', 'reload recovers project membership');
    const oldMember = await page.locator('[data-selection-project-member]').elementHandle();
    await page.evaluate(() => window.syntheticSidebarRender());
    await select('Projects', 'native sidebar replacement');
    expect(await oldMember.evaluate(e => e.isConnected)).toBe(false);
    await page.evaluate(() => {
      const member = document.querySelector('[data-selection-project-member]');
      const duplicate = member.cloneNode(true); duplicate.removeAttribute('data-selection-project-member'); duplicate.setAttribute('data-selection-duplicate', '');
      document.querySelector('[data-section="recents"] [data-native-section]').closest('[class~="group/nav-section-title"]').nextElementSibling.append(duplicate);
    });
    await select(null, 'ambiguous section membership');
    await page.locator('[data-selection-project-member]').evaluate(e => e.setAttribute('aria-current', 'page'));
    await select('Projects', 'native current disambiguates membership');
    await expect(page.locator('[data-selection-project-member]')).toHaveAttribute('aria-current', 'page');
    await page.locator('[data-selection-duplicate]').evaluate(e => e.setAttribute('aria-current', 'page'));
    await select(null, 'conflicting native current states');
    await page.evaluate(() => window.syntheticSidebarRender());
    await select('Projects', 'stale conflict cleared after replacement');
    await route('/synthetic-plugin-page');
    const plugin = page.locator('.sidebar-navigation button').filter({ hasText: /^Plugins$/ });
    await plugin.evaluate(e => e.setAttribute('aria-selected', 'true'));
    await select('Plugins', 'native selected plugin');
    await expect(plugin).toHaveAttribute('aria-selected', 'true');
    await plugin.evaluate(e => e.removeAttribute('aria-selected'));
    const explore = page.locator('.sidebar-navigation button').filter({ hasText: /^Explore$/ });
    await explore.evaluate(e => e.setAttribute('aria-current', 'page'));
    await select('Explore', 'other native-supported destination');
    await explore.evaluate(e => e.removeAttribute('aria-current'));
    await select(null, 'stale semantic selection removed');
    await page.locator('main').evaluate(e => e.insertAdjacentHTML('beforeend', '<a href="/library" aria-current="page">Synthetic unrelated current link</a>'));
    await select(null, 'unrelated page semantics ignored');
    await route('/library'); await select('Library', 'library keyboard focus');
    await active.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    await expect(active).toBeFocused();
    const contrast = await active.evaluate(e => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d');
      const rgb = (css, base) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = base || '#fff'; ctx.fillRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const luminance = color => color.map(x => { const n = x / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
      const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const style = getComputedStyle(e), parent = getComputedStyle(e.closest('nav'));
      const probe = document.createElement('span'); probe.style.color = 'var(--app-mode-accent)'; e.append(probe); const accent = getComputedStyle(probe).color; probe.remove();
      const bg = rgb(style.backgroundColor, parent.backgroundColor);
      return { icon: ratio(rgb(style.color), bg), indicator: ratio(rgb(accent), bg), focus: ratio(rgb(style.outlineColor), bg), outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, background: bg };
    });
    for (const key of ['icon', 'indicator', 'focus']) expect(contrast[key], key).toBeGreaterThanOrEqual(3);
    expect(contrast.outlineStyle).not.toBe('none'); expect(parseFloat(contrast.outlineWidth)).toBeGreaterThanOrEqual(2);
    evidence.contrast = contrast;
    await capture('library-focus-' + theme);
    const toggle = page.locator('#app-mode-compact-sidebar');
    await toggle.click(); await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'docked');
    await select('Library', 'selection survives docked expansion');
    await toggle.click(); await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'compact');
    await select('Library', 'selection survives contraction');
    await page.setViewportSize({ width: 390, height: 850 });
    await select('Library', 'selection survives responsive native rerender');
    await toggle.click(); await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'drawer');
    await select('Library', 'selection survives drawer expansion');
    await page.keyboard.press('Escape'); await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'compact');
    await select('Library', 'selection survives native drawer dismissal');
    await expect(toggle).toBeFocused();
    await capture('narrow-library-' + theme);
    const geometry = await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth, railWidth: document.querySelector('#app-mode-compact-sidebar-actions').getBoundingClientRect().width }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport.width); expect(geometry.railWidth).toBe(52);
    evidence.geometry = geometry; evidence.behavioralResult = evidence.geometryResult = 'passed';
  } finally {
    await info.attach('visual-metadata', { body: Buffer.from(JSON.stringify(evidence)), contentType: 'application/json' });
  }
});
