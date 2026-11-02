const { test: base, expect, chromium } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const extensionPath = path.join(root, 'extension');
const headerLayoutScript = fs.readFileSync(path.join(root, 'WindowHost', 'header.js'), 'utf8');
const headerLayoutCss = fs.readFileSync(path.join(root, 'WindowHost', 'header.css'), 'utf8');
const overrideScripts = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'))
  .content_scripts[0].js.map(file => fs.readFileSync(path.join(extensionPath, file), 'utf8'));
async function injectOverrides(page) {
  for (const script of overrideScripts) await page.evaluate(source => (0, eval)(source), script);
}
const profilePath = path.join(root, 'test-results', 'runs', 'browser-profile');
const fixtureProfile = testId => `${profilePath}-${testId.replace(/[^a-z0-9]/gi, '').slice(-24)}`;
const configuredChrome = process.env.APP_MODE_CHROMIUM_EXE;
// Playwright's bundled Chromium is the default; set APP_MODE_CHROMIUM_EXE to
// pin a specific local browser instead.
const executablePath = configuredChrome && fs.existsSync(configuredChrome) ? configuredChrome : undefined;

const test = base.extend({
  context: async ({}, use, testInfo) => {
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    const isolatedProfile = fs.mkdtempSync(`${fixtureProfile(testInfo.testId)}-`);
    const context = await chromium.launchPersistentContext(isolatedProfile, {
      executablePath,
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
    await page.close();
  },
});

async function sidebarOverlayFixture(page, scheme = 'light') {
  await page.goto('about:blank');
  await page.setViewportSize({ width: 550, height: 700 });
  await page.emulateMedia({ colorScheme: scheme });
  await page.setContent(`<style>
    *{box-sizing:border-box}body{margin:0;background:#89a}html.dark .codex-dialog-overlay{background-color:rgba(0,0,0,.6)}
    header{position:fixed;inset:0 0 auto;height:40px;z-index:50;background:#678!important}
    #background-action{position:fixed;left:350px;top:5px;width:70px;height:28px}
    .codex-dialog-overlay{position:fixed;inset:0;z-index:50;background-color:rgba(220,230,240,.6)}
    #browser-sidebar-popover{position:fixed;top:40px;left:0;bottom:0;width:260px;z-index:50;background:#abc}
    </style><div data-app-shell-responsive-sidebar="true"><header data-app-mode-header-layout>
    <button aria-label="Show sidebar">Sidebar</button><button id="background-action">Action</button></header></div>
    <div id="portal"><div id="scrim" class="codex-dialog-overlay" aria-hidden="true" data-state="open"></div>
    <div id="browser-sidebar-popover" role="dialog" aria-modal="true" data-state="open"><button aria-label="Close sidebar">Close</button></div></div>`);
  await page.evaluate(scheme => {
    document.documentElement.classList.toggle('dark', scheme === 'dark');
    document.body.classList.add('faux-chatgpt-app-mode');
    window.headerClicks = 0;
    document.querySelector('#background-action').onclick = () => window.headerClicks++;
    const close = () => { document.querySelector('#portal')?.remove(); document.querySelector('#app-mode-compact-sidebar')?.focus(); };
    document.querySelector('[aria-label="Close sidebar"]').onclick = close;
    document.querySelector('#scrim').onclick = event => { if (event.clientY >= 40) close(); };
    document.querySelector('[role="dialog"]').addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  }, scheme);
  await page.addStyleTag({ content: fs.readFileSync(path.join(extensionPath, 'styles/chatgpt-overrides.css'), 'utf8') });
}

async function overlayPixels(page, clip) {
  const buffer = await page.screenshot({ clip });
  return page.evaluate(async data => {
    const image = new Image(); image.src = data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(0, 0, image.width, image.height).data);
  }, `data:image/png;base64,${buffer.toString('base64')}`);
}

test('sidebar overlay preserves native color and alpha with a clear header and blocked input', async ({ page }, testInfo) => {
  for (const scheme of ['light', 'dark']) {
    await sidebarOverlayFixture(page, scheme);
    const nativeColor = await page.locator('#scrim').evaluate(e => getComputedStyle(e).backgroundColor);
    const nativeBelow = await overlayPixels(page, { x: 450, y: 70, width: 20, height: 20 });
    await page.locator('#scrim').evaluate(e => e.style.visibility = 'hidden');
    const clearHeader = await overlayPixels(page, { x: 450, y: 10, width: 20, height: 20 });
    await page.locator('#scrim').evaluate(e => e.style.removeProperty('visibility'));
    await injectOverrides(page);
    await expect(page.locator('#scrim')).toHaveAttribute('data-app-mode-sidebar-overlay', '');
    expect(await page.locator('#scrim').evaluate(e => e.style.getPropertyValue('--app-mode-sidebar-scrim-color'))).toBe(nativeColor);
    const renderedBelow = await overlayPixels(page, { x: 450, y: 70, width: 20, height: 20 });
    // Chromium dithers gradients by one channel level even in a flat stop.
    expect(Math.max(...renderedBelow.map((value, index) => Math.abs(value - nativeBelow[index])))).toBeLessThanOrEqual(1);
    expect(await overlayPixels(page, { x: 450, y: 10, width: 20, height: 20 })).toEqual(clearHeader);
    await page.screenshot({ path: testInfo.outputPath(`sidebar-overlay-${scheme}.png`), clip: { x: 280, y: 0, width: 270, height: 120 } });
    expect(await page.evaluate(() => document.elementFromPoint(380, 20).id)).toBe('scrim');
    await page.mouse.click(380, 20);
    expect(await page.evaluate(() => window.headerClicks)).toBe(0);
    await page.getByRole('button', { name: 'Close sidebar', exact: true }).click();
    await expect(page.locator('#portal')).toHaveCount(0);
    await expect(page.locator('#app-mode-compact-sidebar')).toBeFocused();
  }
});

test('sidebar overlay refreshes themes and owns rendered closing and replacement lifecycles', async ({ page }) => {
  await sidebarOverlayFixture(page);
  await injectOverrides(page);
  const scrim = page.locator('#scrim');
  await expect(scrim).toHaveAttribute('data-app-mode-sidebar-overlay', '');
  await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__APP_MODE_CONTEXT__.ensureCompactSidebar(); });
  expect(await scrim.evaluate(e => e.style.getPropertyValue('--app-mode-sidebar-scrim-color'))).toBe('rgba(220, 230, 240, 0.6)');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect.poll(() => scrim.evaluate(e => e.style.getPropertyValue('--app-mode-sidebar-scrim-color'))).toBe('rgba(0, 0, 0, 0.6)');
  await page.evaluate(() => { document.querySelector('#scrim').dataset.state = 'closed'; document.querySelector('#browser-sidebar-popover').dataset.state = 'closed'; });
  await expect(scrim).toHaveAttribute('data-app-mode-sidebar-overlay', '');
  await page.evaluate(() => {
    window.oldScrim = document.querySelector('#scrim');
    const replacement = window.oldScrim.cloneNode(); replacement.style.cssText = 'background-color:rgba(40,50,60,.25)';
    replacement.removeAttribute('data-app-mode-sidebar-overlay'); window.oldScrim.replaceWith(replacement);
  });
  await expect.poll(() => scrim.evaluate(e => e.style.getPropertyValue('--app-mode-sidebar-scrim-color'))).toBe('rgba(40, 50, 60, 0.25)');
  expect(await page.evaluate(() => !window.oldScrim.hasAttribute('data-app-mode-sidebar-overlay') && !window.oldScrim.style.getPropertyValue('--app-mode-sidebar-scrim-color'))).toBe(true);
  await injectOverrides(page);
  await expect(page.locator('[data-app-mode-sidebar-overlay]')).toHaveCount(1);
  await page.evaluate(() => { history.replaceState({}, '', '#overlay-navigation'); window.dispatchEvent(new Event('popstate')); });
  await expect(scrim).toHaveAttribute('data-app-mode-sidebar-overlay', '');
  await page.evaluate(() => { window.__APP_MODE_CONTEXT__.compactSidebarEnabled = false; window.__APP_MODE_CONTEXT__.ensureCompactSidebar(); });
  await expect(scrim).not.toHaveAttribute('data-app-mode-sidebar-overlay');
  expect(await scrim.evaluate(e => e.style.getPropertyValue('--app-mode-sidebar-scrim-color'))).toBe('');
  await page.evaluate(() => { window.__APP_MODE_CONTEXT__.compactSidebarEnabled = true; window.__APP_MODE_CONTEXT__.ensureCompactSidebar(); });
  await expect(scrim).toHaveAttribute('data-app-mode-sidebar-overlay', '');
  await page.evaluate(() => { document.querySelector('#scrim').style.display = 'none'; window.__APP_MODE_CONTEXT__.ensureCompactSidebar(); });
  await expect(scrim).not.toHaveAttribute('data-app-mode-sidebar-overlay');
  expect(await scrim.evaluate(e => {
    e.style.display = ''; window.__APP_MODE_CONTEXT__.ensureCompactSidebar(); window.__APP_MODE_CONTEXT__.navigationController.reset();
    return !e.hasAttribute('data-app-mode-sidebar-overlay') && !e.style.getPropertyValue('--app-mode-sidebar-scrim-color');
  })).toBe(true);
});

test('sidebar overlay rejects unsupported native styles and isolates unrelated modals', async ({ page }) => {
  await sidebarOverlayFixture(page);
  await injectOverrides(page);
  const scrim = page.locator('#scrim');
  await expect(scrim).toHaveAttribute('data-app-mode-sidebar-overlay', '');
  for (const css of ['background-color:transparent', 'background-color:var(--missing-native-color)', 'background-image:linear-gradient(red,blue)', 'backdrop-filter:blur(2px)', 'left:3px', 'position:absolute', 'transform:translateY(3px)']) {
    await scrim.evaluate((e, css) => { e.style.cssText = css; window.__APP_MODE_CONTEXT__.ensureCompactSidebar(); }, css);
    await expect(scrim).not.toHaveAttribute('data-app-mode-sidebar-overlay');
    expect(await scrim.evaluate(e => e.style.getPropertyValue('--app-mode-sidebar-scrim-color'))).toBe('');
    await scrim.evaluate(e => { e.style.cssText = ''; window.__APP_MODE_CONTEXT__.ensureCompactSidebar(); });
    await expect(scrim).toHaveAttribute('data-app-mode-sidebar-overlay', '');
  }
  await page.evaluate(() => {
    const second = document.querySelector('#scrim').cloneNode(); second.id = 'ambiguous'; second.removeAttribute('data-app-mode-sidebar-overlay'); second.style.cssText = ''; document.querySelector('#portal').append(second);
    window.__APP_MODE_CONTEXT__.ensureCompactSidebar();
  });
  await expect(page.locator('[data-app-mode-sidebar-overlay]')).toHaveCount(0);
  await page.evaluate(() => {
    document.querySelector('#ambiguous').remove();
    const other = document.createElement('div'); other.id = 'other-portal';
    other.innerHTML = '<div id="other-scrim" class="codex-dialog-overlay" aria-hidden="true" style="z-index:80;background:rgba(80,20,30,.4)"></div><div role="dialog" aria-modal="true" style="position:fixed;left:350px;top:100px;width:150px;height:80px;z-index:90"><button id="other-close">Close other</button></div>';
    document.body.append(other); window.otherDismissed = false;
    document.querySelector('#other-close').onclick = () => { window.otherDismissed = true; other.remove(); };
  });
  await expect(scrim).toHaveAttribute('data-app-mode-sidebar-overlay', '');
  await expect(page.locator('#other-scrim')).not.toHaveAttribute('data-app-mode-sidebar-overlay');
  await expect(page.locator('#other-scrim')).toHaveCSS('background-color', 'rgba(80, 20, 30, 0.4)');
  expect(await page.evaluate(() => document.elementFromPoint(380, 20).id)).toBe('other-scrim');
  await page.locator('#other-close').click();
  expect(await page.evaluate(() => window.otherDismissed)).toBe(true);
  for (const width of [800, 550]) {
    await page.setViewportSize({ width, height: 700 });
    await page.evaluate(width => {
      document.querySelector('#portal').style.display = width === 800 ? 'none' : '';
      if (width === 800) {
        const panel = document.createElement('aside'); panel.className = 'app-shell-left-panel';
        panel.style.cssText = 'position:fixed;left:0;top:0;width:340px';
        document.querySelector('[data-app-shell-responsive-sidebar]').append(panel);
      } else document.querySelector('aside.app-shell-left-panel').remove();
    }, width);
    await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', width === 800 ? 'docked' : 'drawer');
    if (width === 800) {
      await expect(scrim).not.toHaveAttribute('data-app-mode-sidebar-overlay');
      expect(await scrim.evaluate(e => e.style.getPropertyValue('--app-mode-sidebar-scrim-color'))).toBe('');
    } else {
      await expect(scrim).toHaveAttribute('data-app-mode-sidebar-overlay', '');
      expect(await scrim.evaluate(e => Math.round(e.getBoundingClientRect().width))).toBe(width);
      expect(await page.locator('#browser-sidebar-popover').evaluate(e => e.getBoundingClientRect().top)).toBe(40);
    }
  }
});

const fixture = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fixture conversation - ChatGPT</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; font-family: Arial, sans-serif; color: var(--text-primary, #202123); background: var(--main-surface-primary, #fff); }
  .shell { min-height: 100vh; display: grid; grid-template-columns: 250px minmax(0, 1fr); }
  aside { background: #f7f7f8; padding: 22px 16px; border-right: 1px solid #ececf1; }
  .brand { font-size: 17px; font-weight: 700; margin-bottom: 30px; }
  .nav { padding: 10px 12px; border-radius: 8px; background: #ececf1; font-size: 14px; }
  main { min-width: 0; display: flex; flex-direction: column; }
  header { height: 58px; border-bottom: 1px solid #ececf1; display:flex; align-items:center; padding: 0 26px; font-size: 14px; font-weight: 600; }
  .header-title { margin-right: auto; }
  .header-actions { display: flex; align-items: center; gap: 6px; }
  html.dark { color-scheme: dark; }
  html.dark, html.dark body { color: #d5d8e0; background: #212121; }
  .conversation { width: min(720px, calc(100% - 48px)); margin: 42px auto; }
  .message { padding: 18px 20px; margin-bottom: 16px; border: 1px solid #ececf1; border-radius: 14px; line-height: 1.55; font-size: 15px; }
  .message.user { background: #f7f7f8; }
  .composer { margin-top: 35px; padding: 16px; border: 1px solid #d9d9e3; border-radius: 16px; color: #777; }
  @media (max-width: 600px) { .shell { grid-template-columns: 1fr; } aside { display:none; } header { padding: 0 16px; } .conversation { width: calc(100% - 28px); margin-top: 24px; } }
</style></head><body><div class="shell" id="app">
<aside><div class="brand">ChatGPT</div><div class="nav">Current conversation</div></aside>
<main><header><span class="header-title">Fixture conversation</span><div class="header-actions"><button aria-label="Conversation options">···</button><button aria-label="Share conversation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 16V3m-4 4 4-4 4 4M5 13v7h14v-7"/></svg>Share</button></div></header><section class="conversation">
<div class="message user">Can you help me organize a visual review?</div>
<div class="message">Here is a clean offline fixture for checking layout, narrow-window behavior, and extension controls. No private conversation data is included.</div>
<div class="composer">Message ChatGPT</div></section></main></div></body></html>`;

test('visible fixed-layer switch centers in docked content and keeps viewport centering for modal drawers', async ({ page }, testInfo) => {
  const structure = fs.readFileSync(path.join(root, 'tests/fixtures/fixed-layer-header.html'), 'utf8');
  await page.setViewportSize({ width: 680, height: 800 });
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.route('http://127.0.0.1:17863/**', route => route.fulfill({ contentType: 'application/json', body: '{"saved":false,"enabled":false}' }));
  await page.goto('https://chatgpt.com/');
  await page.addStyleTag({ content: headerLayoutCss });
  await page.evaluate(html => {
    document.querySelector('.shell').style.gridTemplateColumns = '1fr';
    document.querySelector('aside').style.display = 'none';
    document.querySelector('header').innerHTML = html;
    const compactToggle = document.createElement('button');
    compactToggle.id = 'app-mode-compact-sidebar';
    document.body.append(compactToggle);
    document.querySelector('.fixed-mode-layer').setAttribute('data-app-mode-header-tabs', '');
    const action = document.querySelector('button[aria-label="Refresh"]');
    action.after(action.cloneNode(true));
  }, structure);
  await page.evaluate(script => (0, eval)(script), headerLayoutScript);
  await expect(page.locator('.real-mode-grid')).toHaveAttribute('data-app-mode-header-tabs', '');
  const samples = [];
  for (let sample = 0; sample < 20; sample++) {
    await page.setViewportSize({ width: sample < 12 ? 680 : [560, 390, 448, 680][sample % 4], height: 800 });
    await page.evaluate(sample => {
      const sidebar = document.querySelector('aside');
      sidebar.style.display = sample % 2 === 0 && innerWidth > 480 ? 'block' : 'none';
      sidebar.style.width = 'clamp(180px, 28vw, 280px)';
      document.querySelector('.shell').style.gridTemplateColumns = sidebar.style.display === 'none' ? '1fr' : `${sidebar.style.width} minmax(0, 1fr)`;
      const header = document.querySelector('header');
      if (sample === 12) {
        const action = header.querySelector('button[aria-label="Refresh"]');
        for (let index = 0; index < 3; index++) {
          const extra = action.cloneNode(true);
          extra.dataset.denseFixture = '';
          action.after(extra);
        }
      } else if (sample === 13) header.querySelectorAll('[data-dense-fixture]').forEach(element => element.remove());
      header.classList.toggle('sidebar-expanded', sample % 2 === 0);
      document.querySelector('#synthetic-sidebar-modal')?.remove();
      if (sample < 12 && sample % 4 === 1) {
        header.setAttribute('aria-hidden', 'true');
        const modal = document.createElement('div');
        modal.id = 'synthetic-sidebar-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.style.cssText = 'position:fixed;left:0;top:0;width:120px;height:100vh';
        document.body.append(modal);
      } else header.removeAttribute('aria-hidden');
      if (sample % 3 === 0) {
        const layer = header.querySelector('.fixed-mode-layer');
        layer.replaceWith(layer.cloneNode(true));
      }
      const buttons = header.querySelectorAll('.real-mode-grid button');
      buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === sample % 2)));
      history.pushState({}, '', sample % 2 ? '/c/synthetic-header' : '/');
    }, sample);
    await page.waitForTimeout(80);
    samples.push(await page.evaluate(() => {
      const rect = element => {
        const r = element.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      const tabs = document.querySelector('.real-mode-grid');
      const box = rect(tabs);
      const aside = document.querySelector('aside');
      const asideBox = aside.getBoundingClientRect();
      const docked = getComputedStyle(aside).display !== 'none' && asideBox.width >= 160 && asideBox.left <= 2 && !document.querySelector('#synthetic-sidebar-modal');
      return { viewport: innerWidth, dpr: devicePixelRatio, switch: box,
        centering: tabs.closest('header').getAttribute('data-app-mode-header-centering'),
        outline: getComputedStyle(tabs).borderWidth,
        error: box.x + box.width / 2 - (docked ? (asideBox.right + innerWidth) / 2 : innerWidth / 2),
        docked,
        controls: [...document.querySelectorAll('header button')].filter(el => !el.closest('[aria-hidden="true"]')).map(rect),
        ancestry: [...document.querySelector('header').children].map(el => {
          const style = getComputedStyle(el);
          return { box: rect(el), flex: style.flex, width: style.width, minWidth: style.minWidth, display: style.display };
        }) };
    }));
  }
  await testInfo.attach('header-css-pixel-samples', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
  for (const [index, sample] of samples.entries()) {
    if (index === 12) expect(sample.centering).toBe('remaining');
    if (sample.centering === 'region') expect(Math.abs(sample.error), JSON.stringify(sample)).toBeLessThanOrEqual(2);
    if (sample.centering === 'viewport') expect(Math.abs(sample.error), JSON.stringify(sample)).toBeLessThanOrEqual(2);
    expect(sample.outline).toBe('1px');
    expect(Math.abs(sample.switch.y - (40 - sample.switch.bottom))).toBeLessThanOrEqual(2);
    for (let index = 0; index < sample.controls.length; index++) {
      const a = sample.controls[index];
      for (const b of sample.controls.slice(index + 1)) expect(a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y, JSON.stringify(sample)).toBe(false);
    }
    for (const control of sample.controls) {
      expect(control.y).toBeGreaterThanOrEqual(0);
      expect(control.bottom).toBeLessThanOrEqual(40);
    }
  }
  await page.goto('https://chatgpt.com/c/compact-title-fixture');
  await page.addStyleTag({ content: headerLayoutCss });
  await page.evaluate(script => (0, eval)(script), headerLayoutScript);
  await expect(page.locator('.header-title')).toHaveCSS('font-size', '14px');
  await expect(page.locator('.header-title')).toHaveCSS('font-weight', '500');
  await expect(page.locator('.header-title')).toHaveCSS('line-height', '19.6px');
  await page.goto('https://chatgpt.com/');
  await page.addStyleTag({ content: headerLayoutCss });
  await page.evaluate(html => {
    document.querySelector('.shell').style.gridTemplateColumns = '1fr';
    document.querySelector('aside').style.display = 'none';
    document.querySelector('header').innerHTML = html;
  }, structure);
  await page.evaluate(script => (0, eval)(script), headerLayoutScript);
  await expect.poll(() => page.locator('.real-mode-grid').evaluate(element => {
    const box = element.getBoundingClientRect();
    return Math.abs(box.x + box.width / 2 - innerWidth / 2);
  })).toBeLessThanOrEqual(2);
});

test('docked sidebar centers the mode switch in content while compact toggle remains mounted', async ({ page }) => {
  await page.setViewportSize({ width: 786, height: 800 });
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}.shell{height:800px}aside{position:fixed;left:0;top:40px;width:340px;height:760px}main{margin-left:340px;min-width:0}header{height:40px}</style>
    <div class="shell"><aside></aside><main><header><div class="real-mode-grid" role="tablist" style="position:absolute;left:50%;top:6px;width:192px;height:28px;display:flex">
      <button role="tab" aria-selected="true">Chat</button><button role="tab" aria-selected="false">Work</button>
    </div></header></main></div>
    <button id="app-mode-compact-sidebar" aria-label="Open sidebar"></button>`);
  await page.evaluate(() => document.body.classList.add('faux-chatgpt-app-mode'));
  await page.addStyleTag({ content: headerLayoutCss });
  await page.evaluate(script => (0, eval)(script), headerLayoutScript);
  await expect.poll(() => page.locator('header').getAttribute('data-app-mode-header-centering')).toBe('region');
  const geometry = await page.evaluate(() => {
    const rect = element => { const { x, y, width, height, right } = element.getBoundingClientRect(); return { x, y, width, height, right }; };
    const sidebar = rect(document.querySelector('aside'));
    const tabs = rect(document.querySelector('.real-mode-grid'));
    return { viewport: innerWidth, sidebar, tabs, centerOffset: document.querySelector('header').style.getPropertyValue('--app-mode-switch-offset'), toggleMounted: !!document.getElementById('app-mode-compact-sidebar') };
  });
  expect(geometry.toggleMounted).toBe(true);
  expect(Math.abs(geometry.tabs.x + geometry.tabs.width / 2 - (geometry.sidebar.right + geometry.viewport) / 2), JSON.stringify(geometry)).toBeLessThanOrEqual(2);
  expect(geometry.tabs.x, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.sidebar.right);
});

test('mode switch positioning stays continuous across 480px and 481px', async ({ page }) => {
  await page.setContent(`<style>body{margin:0}header{height:40px}aside{position:fixed;left:0;top:40px;width:340px;height:600px}</style>
    <header><div><button aria-label="Sidebar">S</button></div>
      <div class="switch" role="tablist" style="position:absolute;left:50%;top:6px;width:192px;height:28px;display:flex;pointer-events:auto">
        <button role="tab" aria-selected="true">Chat</button><button role="tab" aria-selected="false">Work</button>
      </div><div class="actions"><button aria-label="Refresh">R</button><button aria-label="Share">S</button><button aria-label="More">M</button></div><div class="chatgpt-app-mode-toolbar"></div></header><aside></aside>`);
  await page.evaluate(() => document.body.classList.add('faux-chatgpt-app-mode'));
  await page.addStyleTag({ content: headerLayoutCss });
  await page.evaluate(script => (0, eval)(script), headerLayoutScript);
  const centers = [];
  for (const width of [390, 419, 420, 421, 479, 480, 481, 550, 680, 767, 768, 769, 800, 1024, 1280]) {
    await page.setViewportSize({ width, height: 700 });
    await page.locator('aside').evaluate((element, width) => { element.style.display = width >= 768 ? 'block' : 'none'; }, width);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const geometry = await page.locator('.switch').evaluate(element => {
      const { x, width } = element.getBoundingClientRect();
      const header = element.closest('header');
      const rect = button => { const r = button.getBoundingClientRect(); return { x: r.x, right: r.right, top: r.top, bottom: r.bottom }; };
      return { center: x + width / 2, width, right: x + width, state: header.getAttribute('data-app-mode-header-centering'), controls: [...header.querySelectorAll('button')].filter(button => !element.contains(button)).map(rect) };
    });
    centers.push({ viewport: width, ...geometry });
    expect(geometry.center - geometry.width / 2).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(width);
    for (let index = 0; index < geometry.controls.length; index++) {
      for (const other of geometry.controls.slice(index + 1)) expect(geometry.controls[index].right <= other.x || geometry.controls[index].x >= other.right || geometry.controls[index].bottom <= other.top || geometry.controls[index].top >= other.bottom, JSON.stringify({ width, geometry })).toBe(true);
      expect(geometry.controls[index].top).toBeGreaterThanOrEqual(0);
      expect(geometry.controls[index].bottom).toBeLessThanOrEqual(40);
    }
  }
  const at480 = centers.find(entry => entry.viewport === 480);
  const at481 = centers.find(entry => entry.viewport === 481);
  expect(Math.abs(at480.center - at481.center), JSON.stringify(centers)).toBeLessThanOrEqual(2);
  for (const width of [768, 769, 800, 1024, 1280]) {
    const sample = centers.find(entry => entry.viewport === width);
    expect(sample.state).toBe('region');
    expect(Math.abs(sample.center - (340 + width) / 2), JSON.stringify(sample)).toBeLessThanOrEqual(2);
  }
});

test('keyboard focus remains visible and native tooltips stay available in both themes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 550, height: 500 });
  await page.setContent(`<style>html{color-scheme:light;--sidebar-surface-primary:#f7f8fa}html.dark{color-scheme:dark;--sidebar-surface-primary:#262733}body{margin:0;color:#17191d;background:#fff}html.dark body{color:#eee;background:#20232a}header{height:40px}</style>
    <header><button id="app-mode-compact-sidebar" aria-label="Show sidebar">S</button><button aria-label="Temporary chat" title="Temporary chat">T</button><div class="chatgpt-app-mode-toolbar"></div>
      <div data-app-mode-header-tabs><button role="tab" aria-selected="true">Chat</button><button role="tab" aria-selected="false">Work</button></div></header>
    <div id="app-mode-compact-sidebar-actions"></div><div role="tooltip" id="native-tip">Temporary chat</div><div data-app-mode-share-menu-item tabindex="0">Share</div>`);
  await page.evaluate(() => document.body.classList.add('faux-chatgpt-app-mode'));
  await page.addStyleTag({ content: fs.readFileSync(path.join(extensionPath, 'styles/chatgpt-overrides.css'), 'utf8') });
  await page.addStyleTag({ content: headerLayoutCss });
  await page.evaluate(script => (0, eval)(script), headerLayoutScript);
  async function tabTo(selector) {
    for (let index = 0; index < 12; index++) {
      await page.keyboard.press('Tab');
      if (await page.locator(selector).evaluate(element => element === document.activeElement)) return;
    }
    throw new Error(`Tab traversal did not reach ${selector}`);
  }
  for (const scheme of ['light', 'dark']) {
    await page.evaluate(scheme => document.documentElement.classList.toggle('dark', scheme === 'dark'), scheme);
    await page.evaluate(() => document.activeElement?.blur());
    await page.emulateMedia({ colorScheme: scheme });
    const sidebar = page.locator('#app-mode-compact-sidebar');
    await tabTo('#app-mode-compact-sidebar');
    await expect(sidebar).toBeFocused();
    const outline = await sidebar.evaluate(element => ({ style: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth, color: getComputedStyle(element).outlineColor }));
    expect(outline.style).toBe('solid');
    expect(outline.width).toBe('2px');
    await expect(page.locator('#native-tip')).toBeVisible();
    expect(await page.locator('header').evaluate(element => getComputedStyle(element).backgroundColor)).toBe(await page.locator('#app-mode-compact-sidebar-actions').evaluate(element => getComputedStyle(element).backgroundColor));
    const selected = page.locator('[data-app-mode-header-tabs] [aria-selected="true"]');
    await expect(selected).toHaveCSS('height', '24px');
    await expect(selected).toHaveCSS('border-top-width', '1px');
    expect(await selected.evaluate(element => getComputedStyle(element).borderTopColor)).not.toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: testInfo.outputPath(`focus-${scheme}.png`) });
    const share = page.locator('[data-app-mode-share-menu-item]');
    await tabTo('[data-app-mode-share-menu-item]');
    await expect(share).toBeFocused();
    await expect(share).toHaveCSS('outline-style', 'solid');
    await expect(share).toHaveCSS('outline-width', '2px');
  }
  await page.emulateMedia({ forcedColors: 'active' });
  await page.evaluate(() => document.activeElement?.blur());
  await tabTo('#app-mode-compact-sidebar');
  await expect(page.locator('#app-mode-compact-sidebar')).toHaveCSS('outline-style', 'solid');
  await expect(page.locator('#app-mode-compact-sidebar')).toHaveCSS('outline-width', '2px');
  expect(await page.locator('#app-mode-compact-sidebar').evaluate(element => getComputedStyle(element).outlineColor)).not.toBe('rgba(0, 0, 0, 0)');
});

test('expanded-sidebar offsets collapse so the conversation title stays between the control groups', async ({ page }) => {
  const structure = fs.readFileSync(path.join(root, 'tests/fixtures/full-header.html'), 'utf8');
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.route('http://127.0.0.1:17863/**', route => route.fulfill({ contentType: 'application/json', body: '{"saved":false,"enabled":false}' }));
  await page.goto('https://chatgpt.com/c/spacer-title-fixture');
  await page.addStyleTag({ content: headerLayoutCss });
  await page.evaluate(html => { document.querySelector('header').innerHTML = html; }, structure);
  await page.evaluate(script => (0, eval)(script), headerLayoutScript);
  const measure = () => page.evaluate(() => {
    const header = document.querySelector('header');
    const box = element => element.getBoundingClientRect();
    const title = box(header.querySelector('.fixture-title'));
    const text = box(header.querySelector('.fixture-title .title'));
    return { viewport: innerWidth,
      title: { left: title.left, right: title.right }, text: { right: text.right, width: text.width },
      leadingRight: box(header.querySelector('.fixture-leading')).right,
      actionsLeft: box(header.querySelector('.fixture-actions')).left,
      spacersVisible: [...header.querySelectorAll('.fixture-sidebar-spacer,.fixture-title-offset')].filter(element => element.getClientRects().length).map(element => element.className) };
  });
  // Expanded-sidebar offsets, collapsed-sidebar re-render, and resizes must
  // all leave the title between the leading controls and the action group.
  for (const width of [680, 560, 390, 1024, 680]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(async () => { const m = await measure(); return m.spacersVisible.length ? m : 0; }).toBe(0);
    const sample = await measure();
    expect(sample.title.left, JSON.stringify(sample)).toBeGreaterThanOrEqual(sample.leadingRight - 1);
    expect(sample.title.right, JSON.stringify(sample)).toBeLessThanOrEqual(sample.actionsLeft + 1);
    expect(sample.text.width, JSON.stringify(sample)).toBeGreaterThan(8);
    expect(sample.text.right, JSON.stringify(sample)).toBeLessThanOrEqual(sample.viewport + 1);
    if (width === 560) {
      // Re-render drops and re-adds the sidebar offsets; reconciliation
      // collapses them again without moving the controls.
      await page.evaluate(html => { document.querySelector('header').innerHTML = html; }, structure);
      await expect.poll(async () => { const m = await measure(); return m.spacersVisible.length ? m : 0; }).toBe(0);
    }
  }
});

test('compact sidebar rail persists in narrow responsive layout and opens the native drawer', async ({ page }) => {
  await page.setContent(fixture);
  await page.setViewportSize({ width: 390, height: 780 });
  await page.addStyleTag({ content: fs.readFileSync(path.join(extensionPath, 'styles/chatgpt-overrides.css'), 'utf8') });
  await page.evaluate(() => {
    window.__APP_MODE_COMPACT_SIDEBAR__ = true;
    document.body.classList.add('faux-chatgpt-app-mode');
    const root = document.querySelector('#app');
    root.style.display = 'block';
    root.style.width = '100%';
    root.setAttribute('data-app-shell-responsive-sidebar', 'true');
    const desktopRail = document.createElement('nav'); desktopRail.className = 'group/sidebar-rail';
    desktopRail.style.cssText = 'position:fixed;left:0;top:48px;width:52px;height:calc(100vh - 48px)';
    desktopRail.innerHTML = '<button aria-label="New chat"></button><button aria-label="Search"></button>';
    root.append(desktopRail);
    const native = document.createElement('button'); native.setAttribute('data-testid', 'open-sidebar-button'); native.setAttribute('aria-label', 'Open sidebar'); native.style.cssText = 'position:fixed;left:4px;top:4px;z-index:50';
    native.addEventListener('click', () => {
      if (document.querySelector('[role="dialog"]')) {
        document.querySelector('[role="dialog"]').remove(); root.setAttribute('data-app-shell-sidebar-open', 'false'); return;
      }
      if (root.getAttribute('data-app-shell-sidebar-open') === 'true') {
        root.setAttribute('data-app-shell-sidebar-open', 'false'); return;
      }
      root.setAttribute('data-app-shell-sidebar-open', 'true');
      const drawer = document.createElement('div'); drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.style.cssText = 'position:fixed;inset:0;z-index:60;background:#ddd'; document.body.append(drawer);
      drawer.id = 'browser-sidebar-popover';
      const close = document.createElement('button'); close.setAttribute('aria-label', 'Hide sidebar');
      close.addEventListener('click', () => native.click()); drawer.append(close);
      setTimeout(() => {
        if (!drawer.isConnected) return;
        const search = document.createElement('button'); search.setAttribute('aria-label', 'Search');
        search.addEventListener('click', () => {
          window.syntheticSearchCalls = (window.syntheticSearchCalls || 0) + 1;
          const modal = document.createElement('div'); modal.id = 'synthetic-action-search';
          modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
          modal.style.cssText = 'position:fixed;inset:50px;background:white';modal.innerHTML = '<input aria-label="Synthetic search">';
          drawer.setAttribute('aria-hidden', 'true');document.body.append(modal);modal.querySelector('input').focus();
        });
        drawer.append(search);
      }, 80);
    });
    document.body.append(native);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (document.getElementById('synthetic-action-search')) {
        document.getElementById('synthetic-action-search').remove();
        document.getElementById('browser-sidebar-popover')?.removeAttribute('aria-hidden');return;
      }
      root.setAttribute('data-app-shell-sidebar-open', 'false');
      document.querySelector('[role="dialog"][aria-modal="true"]')?.remove();
    });
  });
  await page.setViewportSize({ width: 1280, height: 780 });
  await injectOverrides(page);
  await expect(page.locator('#app-mode-compact-sidebar')).toHaveCount(1);
  await page.locator('nav[class~="group/sidebar-rail"]').evaluate(element => element.remove());
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(page.locator('#app-mode-compact-sidebar')).toBeVisible();
  await expect(page.locator('#app-mode-compact-sidebar-actions button')).toHaveCount(4);
  const rail = page.locator('#app-mode-compact-sidebar');
  await expect(rail).toBeVisible();
  await expect(rail).toHaveCSS('width', '36px');
  const compactRail = page.locator('#app-mode-compact-sidebar-actions');
  await expect(compactRail).toHaveCSS('width', '52px');
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'compact');
  await expect.poll(() => page.locator('#app').evaluate(element => element.getBoundingClientRect().left)).toBe(52);
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width: 390, height: 780 });
  await rail.click();
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toBeVisible();
  await page.locator('[role="dialog"][aria-modal="true"]').evaluate(element => { element.id = 'browser-sidebar-popover'; });
  await expect(page.locator('#browser-sidebar-popover')).toHaveCSS('top', '40px');
  await expect(page.locator('#browser-sidebar-popover')).toHaveCSS('left', '52px');
  await expect(page.locator('#browser-sidebar-popover')).toHaveCSS('height', '740px');
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'drawer');
  // The rail is permanent: it stays mounted beneath the modal drawer.
  await expect(page.locator('#app-mode-compact-sidebar-actions')).toBeVisible();
  await expect(page.locator('[data-app-mode-modal-sidebar-toggle]')).toHaveCSS('top', '5px');
  // A native popup may temporarily hide its parent drawer from accessibility.
  // Its rendered layout and dismissal control must remain owned and stable.
  await page.locator('#browser-sidebar-popover').evaluate(element => element.setAttribute('aria-hidden', 'true'));
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'drawer');
  await page.locator('#browser-sidebar-popover').evaluate(element => element.removeAttribute('aria-hidden'));
  await expect(rail).toHaveAttribute('aria-expanded', 'true');
  // Search invoked from an already-open native drawer preserves that intent.
  await page.locator('#browser-sidebar-popover button[aria-label="Search"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-blocked', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'drawer');
  await page.locator('[data-app-mode-modal-sidebar-toggle]').click();
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
  await expect(rail).toBeFocused();
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'compact');
  await page.locator('[data-app-mode-sidebar-action][aria-label="Search"]').click();
  await expect.poll(() => page.evaluate(() => window.syntheticSearchCalls || 0)).toBe(2);
  await expect(page.locator('#synthetic-action-search')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'compact');
  // A persisted open flag must not hide the rail without a rendered panel.
  await page.evaluate(() => document.querySelector('#app').setAttribute('data-app-shell-sidebar-open', 'true'));
  await expect(page.locator('#app-mode-compact-sidebar-actions')).toBeVisible();
  await rail.click();
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'drawer');
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'compact');
  await page.evaluate(() => {
    window.syntheticOldShell = document.querySelector('#app');
    window.syntheticOldShell.replaceWith(window.syntheticOldShell.cloneNode(true));
    history.replaceState({}, '', '#synthetic-navigation');
  });
  await expect.poll(() => page.evaluate(() => window.syntheticOldShell.hasAttribute('data-app-mode-compact-sidebar-shell'))).toBe(false);
  await expect(page.locator('#app-mode-compact-sidebar')).toHaveCount(1);
  // The expanded desktop panel owns the column; no extra compact offset.
  await page.evaluate(() => {
    const aside = document.createElement('aside'); aside.className = 'app-shell-left-panel';
    aside.style.cssText = 'display:block;width:280px;height:100vh';
    aside.innerHTML = '<div id="synthetic-sidebar-scroll" style="height:100px;overflow:auto"><div style="height:1000px"></div></div>';
    document.querySelector('#app').prepend(aside);
    aside.querySelector('#synthetic-sidebar-scroll').scrollTop = 80;
  });
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'docked');
  // The docked panel sits inside the shell column, so the permanent rail's
  // 52px reservation now shifts it right: rail 0-52, sidebar 52-291.
  await expect(page.locator('#app')).toHaveAttribute('data-app-mode-compact-sidebar-shell', '');
  await expect(page.locator('#app-mode-compact-sidebar-actions')).toBeVisible();
  const dockedBox = await page.locator('aside.app-shell-left-panel').boundingBox();
  // Native panel width is preserved (width-based state detection rules out
  // forcing 239px); only its position right of the rail is asserted.
  expect(dockedBox.width).toBeGreaterThanOrEqual(200);
  expect(Math.abs(dockedBox.x - 52)).toBeLessThanOrEqual(2);
  await expect(page.locator('aside.app-shell-left-panel')).toHaveCSS('margin-top', '40px');
  // A separate global modal blocks background controls without invalidating
  // the docked navigation layout or its scroll position.
  await page.evaluate(() => {
    document.querySelector('#app').setAttribute('aria-hidden', 'true');
    document.querySelector('[data-testid="open-sidebar-button"]').setAttribute('aria-hidden', 'true');
    const modal = document.createElement('div'); modal.id = 'synthetic-global-search';
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.style.cssText = 'position:fixed;inset:100px;background:white';modal.innerHTML = '<input aria-label="Synthetic search">';
    document.body.append(modal);
  });
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'docked');
  await expect(page.locator('aside.app-shell-left-panel')).toHaveCSS('margin-top', '40px');
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-blocked', '');
  await expect(rail).toHaveAttribute('inert', '');
  expect(await page.locator('#synthetic-sidebar-scroll').evaluate(element => element.scrollTop)).toBe(80);
  await page.evaluate(() => {
    document.getElementById('synthetic-global-search').remove();
    document.querySelector('#app').removeAttribute('aria-hidden');
    document.querySelector('[data-testid="open-sidebar-button"]').removeAttribute('aria-hidden');
  });
  await expect(page.locator('body')).not.toHaveAttribute('data-app-mode-navigation-blocked');
  await expect(rail).not.toHaveAttribute('inert');
  for (const width of [680, 1280, 390]) {
    await page.setViewportSize({ width, height: 780 });
    expect(await page.locator('#synthetic-sidebar-scroll').evaluate(element => element.scrollTop)).toBe(80);
  }
  await page.evaluate(() => document.querySelector('aside.app-shell-left-panel').remove());
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'compact');
  // Unknown native controls restore the original layout rather than a dead rail.
  await page.evaluate(() => document.querySelector('[data-testid="open-sidebar-button"]').remove());
  await expect(rail).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-app-mode-navigation-state');
  await page.evaluate(() => { document.querySelector('#app').removeAttribute('data-app-shell-responsive-sidebar'); });
  await expect(rail).toHaveCount(0);
});

test('header stays viewport-wide while a modal blocks sidebar resizing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(fixture);
  await page.evaluate(() => document.body.classList.add('faux-chatgpt-app-mode'));
  await page.addStyleTag({ content: headerLayoutCss });
  await page.evaluate(script => (0, eval)(script), headerLayoutScript);
  await expect(page.locator('header')).toHaveAttribute('data-app-mode-header-layout', '');
  await page.evaluate(() => {
    document.querySelector('header').setAttribute('aria-hidden', 'true');
    const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.style.cssText = 'position:fixed;inset:100px';document.body.append(modal);
    document.querySelector('.shell').style.gridTemplateColumns = '340px minmax(0,1fr)';
  });
  for (const width of [1280, 680, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await expect.poll(() => page.locator('header').evaluate(element => Math.abs(element.getBoundingClientRect().left))).toBeLessThanOrEqual(1);
    await expect.poll(() => page.locator('header').evaluate(element => Math.abs(element.getBoundingClientRect().right - innerWidth))).toBeLessThanOrEqual(1);
  }
});

test('home composition stays stable across the mobile breakpoint and preserves the native draft', async ({ page }) => {
  const home = `<!doctype html><style>
    *{box-sizing:border-box}body{margin:0}header{height:40px}main{height:calc(100vh - 40px)}
    .layout{height:100%;display:flex;flex-direction:column}.contents{display:contents}
    .hero{flex:1;display:flex;align-items:end;justify-content:center}.composer{flex:1}
    .group{display:flex;flex-direction:column;width:100%;max-width:816px;margin:auto}
    .suggestions{order:9999}form{margin:0}.card{border-radius:28px}
    .grid{display:grid;grid-template-columns:36px minmax(0,1fr) 150px;gap:8px;padding:8px}
    .editor{min-height:26px}.trailing{display:flex}.grid button{height:36px}
    @media(max-width:639px){.composer{position:sticky;bottom:0;flex:0}.suggestions{order:0}.grid{grid-template-columns:36px 1fr;grid-template-rows:auto auto}.cell{grid-column:1/-1;grid-row:1}.leading{grid-column:1;grid-row:2}.trailing{grid-column:2;grid-row:2}}
    </style><header></header><main><div class="layout"><div class="contents">
    <section class="hero"><h1>Synthetic welcome</h1></section>
    <section class="composer"><div class="group"><div class="suggestions"><section class="group/home-suggestions"><button type="button" onclick="window.suggestionClicks=(window.suggestionClicks||0)+1">Suggestion</button></section></div>
    <form><div class="card"><div class="grid"><div class="leading"><button type="button">Add</button></div>
    <div class="cell"><div class="editor" contenteditable="true" role="textbox" aria-label="Synthetic editor"></div></div>
    <div class="trailing"><button type="button">Model</button><button type="button">Voice</button></div></div></div></form>
    </div></section></div></div></main>`;
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: home }));
  await page.route('http://127.0.0.1:17863/**', route => route.fulfill({ contentType: 'application/json', body: '{"saved":false,"enabled":false}' }));
  await page.goto('https://chatgpt.com/');
  const editor = page.getByRole('textbox', { name: 'Synthetic editor' });
  await editor.fill('Synthetic unsent draft');
  let boundaryTop;
  for (const width of [900, 640, 639, 620, 390, 640]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.locator('[data-app-mode-home-composer]')).toHaveCSS('position', 'relative');
    await expect(editor).toHaveText('Synthetic unsent draft');
    // Recent activity stays accessible above the bottom-docked composer.
    await expect(page.locator('[data-app-mode-home-suggestions]')).toHaveCSS('order', '0');
    await expect(page.locator('[data-app-mode-home-form]')).toHaveCSS('order', '1');
    const bounds = await page.locator('form').boundingBox();
    // Codex layout: the composer anchors near the bottom of the workspace
    // while the welcome hero centers independently above it.
    expect(bounds.y).toBeGreaterThan(400);expect(bounds.y).toBeLessThan(820);
    expect(bounds.y + bounds.height).toBeGreaterThan(600);
    if (width === 640) boundaryTop = bounds.y;
    if (width === 639) expect(Math.abs(bounds.y - boundaryTop)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const disclosure = page.getByRole('button', { name: 'Recent activity', exact: true });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Suggestion', exact: true })).toBeHidden();
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Suggestion', exact: true }).click();
  expect(await page.evaluate(() => window.suggestionClicks)).toBe(1);
  await page.locator('.suggestions section').evaluate(element => element.replaceWith(element.cloneNode(true)));
  await expect(disclosure).toHaveCount(1);
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Suggestion', exact: true })).toBeVisible();
  await expect(editor).toHaveText('Synthetic unsent draft');
  expect((await page.locator('.card').boundingBox()).height).toBeGreaterThanOrEqual(120);
  await disclosure.click();
  await expect(disclosure).toBeFocused();
  await expect(page.getByRole('button', { name: 'Suggestion', exact: true })).toBeHidden();
  await page.locator('.suggestions').evaluate(element => { element.innerHTML = '<button type="button">Unknown native action</button>'; });
  await expect(disclosure).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Unknown native action' })).toBeVisible();
  await page.evaluate(() => { history.pushState({}, '', '/c/synthetic-home-exit'); document.querySelector('h1').remove(); });
  await expect(page.locator('[data-app-mode-home-layout], [data-app-mode-home-form], [data-app-mode-home-composer]')).toHaveCount(0);
  await expect(editor).toHaveText('Synthetic unsent draft');
  await page.setViewportSize({ width: 390, height: 850 });
  await expect(page.locator('.composer')).toHaveCSS('position', 'sticky');
});

test('sidebar boundary stays below the subheader throughout opening and closing', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0}.shell{display:flex;height:100vh}aside.app-shell-left-panel{width:52px;flex-shrink:0;height:100vh;transition:width 180ms linear}main{flex:1}header{height:40px}</style>
    <div class="shell" data-app-shell-responsive-sidebar="false"><aside class="app-shell-left-panel"><div>Native sidebar title</div></aside><main><header><button aria-label="Show sidebar">Sidebar</button></header></main></div>`);
  await page.addStyleTag({ content: fs.readFileSync(path.join(extensionPath, 'styles/chatgpt-overrides.css'), 'utf8') });
  await injectOverrides(page);
  await expect(page.locator('#app-mode-compact-sidebar')).toBeVisible();
  await expect(page.locator('.shell')).not.toHaveAttribute('data-app-mode-compact-sidebar-shell');
  await page.addStyleTag({ content: headerLayoutCss });
  await page.evaluate(script => (0, eval)(script), headerLayoutScript);
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(scheme => { document.documentElement.style.colorScheme = scheme; }, scheme);
    const corner = await page.evaluate(() => {
      const plate = getComputedStyle(document.body, '::before');
      const header = getComputedStyle(document.querySelector('header'));
      return { background: plate.backgroundColor, rowBackground: header.backgroundColor, width: plate.width, height: plate.height, pointerEvents: plate.pointerEvents };
    });
    expect(corner.background).toBe(corner.rowBackground);
    expect(corner.width).toBe('52px');expect(corner.height).toBe('40px');expect(corner.pointerEvents).toBe('none');
  }
  const samples = await page.evaluate(() => new Promise(resolve => {
    const panel = document.querySelector('aside');const samples = [];
    panel.style.width = '280px';
    function frame() {
      const rect = panel.getBoundingClientRect();samples.push({ width: rect.width, top: rect.top });
      if (samples.length === 25) panel.style.width = '52px';
      if (samples.length < 50) requestAnimationFrame(frame);else resolve(samples);
    }
    requestAnimationFrame(frame);
  }));
  expect(samples.some(sample => sample.width > 52 && sample.width < 100)).toBe(true);
  for (const sample of samples) expect(sample.top, JSON.stringify(sample)).toBeGreaterThanOrEqual(40);
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'compact');
  await expect(page.locator('.shell')).not.toHaveAttribute('data-app-mode-compact-sidebar-shell');
});

test('disabled compact navigation preserves native controls and layout', async ({ page }) => {
  await page.setContent('<main data-app-shell-responsive-sidebar="true"><button aria-label="Show sidebar">Sidebar</button></main>');
  await page.evaluate(() => { window.__APP_MODE_COMPACT_SIDEBAR__ = false; });
  await injectOverrides(page);
  await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible();
  await expect(page.locator('#app-mode-compact-sidebar')).toHaveCount(0);
  await expect(page.locator('[data-app-mode-sidebar-original], [data-app-mode-compact-sidebar-shell], [data-app-mode-navigation-state]')).toHaveCount(0);
});

test('header layout detects the current fixed-layer mode switch with nested tabs and data-state', async ({ page }) => {
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.route('http://127.0.0.1:17863/**', route => route.fulfill({ contentType: 'application/json', body: '{"saved":true,"enabled":false}' }));
  await page.goto('https://chatgpt.com/c/mode-switch-fixture');
  await page.evaluate(script => (0, eval)(script), headerLayoutScript);
  // Current site variant: tab controls sit inside per-tab wrappers within a
  // fixed full-width layer, using data-state instead of aria-pressed.
  await page.evaluate(() => {
    const layer = document.createElement('div');
    layer.id = 'fixed-mode-layer';
    Object.assign(layer.style, { position: 'fixed', left: '0', top: '0', width: '100vw', height: '40px', display: 'flex', justifyContent: 'center', alignItems: 'center', pointerEvents: 'none' });
    layer.innerHTML = '<div id="mode-grid" style="display:grid;grid-template-columns:repeat(2,1fr);width:192px;height:30px;pointer-events:auto">' +
      '<span><button id="mode-chat" data-state="active">Chat</button></span>' +
      '<span><button id="mode-work" data-state="inactive">Work</button></span></div>';
    document.querySelector('header').append(layer);
  });
  const tabs = page.locator('#mode-grid');
  await expect(tabs).toHaveAttribute('data-app-mode-header-tabs', '');
  // The switch's ancestor path up to the header is normalized, and re-render
  // churn does not duplicate or drop the markers.
  await expect(page.locator('[data-app-mode-header-mode-branch]')).toHaveCount(1);
  await page.evaluate(() => {
    const layer = document.getElementById('fixed-mode-layer');
    layer.replaceWith(layer.cloneNode(true));
  });
  await expect(page.locator('#mode-grid')).toHaveAttribute('data-app-mode-header-tabs', '');
  // Non-switch two-button groups in the fixed layer are never tagged.
  await page.evaluate(() => {
    const other = document.createElement('div');
    other.id = 'other-grid';
    other.innerHTML = '<button>Alpha</button><button>Beta</button>';
    document.getElementById('fixed-mode-layer').append(other);
  });
  await expect(page.locator('#other-grid')).not.toHaveAttribute('data-app-mode-header-tabs', '');
});

test('header layout ignores overlays, reconciles changed branches, and follows scrolling strips', async ({ page }) => {
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.route('http://127.0.0.1:17863/**', route => route.fulfill({ contentType: 'application/json', body: '{"saved":true,"enabled":false}' }));
  await page.goto('https://chatgpt.com/c/header-layout-fixture');
  await page.evaluate(script => (0, eval)(script), headerLayoutScript);

  await page.evaluate(() => {
    const hidden = document.createElement('div');
    hidden.id = 'hidden-tabs';
    hidden.setAttribute('role', 'tablist');
    hidden.style.visibility = 'hidden';
    hidden.innerHTML = '<button aria-pressed="true">One</button><button aria-pressed="false">Two</button>';
    document.querySelector('header').prepend(hidden);
  });
  await expect(page.locator('#hidden-tabs')).not.toHaveAttribute('data-app-mode-header-tabs', '');

  await page.evaluate(() => {
    const header = document.querySelector('header');
    const oldBranch = document.createElement('div');
    oldBranch.id = 'old-mode-branch';
    oldBranch.innerHTML = '<div id="old-tabs" role="tablist"><button aria-pressed="true">One</button><button aria-pressed="false">Two</button></div>';
    header.prepend(oldBranch);
  });
  await expect(page.locator('#old-mode-branch')).toHaveAttribute('data-app-mode-header-mode-branch', '');

  await page.evaluate(() => {
    document.getElementById('old-tabs').removeAttribute('role');
    document.getElementById('old-mode-branch').append(Object.assign(document.createElement('button'), { textContent: 'Menu' }));
    const replacement = document.createElement('div');
    replacement.id = 'replacement-mode-branch';
    replacement.innerHTML = '<div role="tablist"><button aria-pressed="true">One</button><button aria-pressed="false">Two</button></div>';
    document.querySelector('header').prepend(replacement);
  });
  await expect(page.locator('#old-mode-branch')).not.toHaveAttribute('data-app-mode-header-mode-branch', '');
  await expect(page.locator('#old-mode-branch')).toHaveAttribute('data-app-mode-header-control-branch', 'actions');

  await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.id = 'top-dialog';
    overlay.setAttribute('role', 'dialog');
    overlay.innerHTML = '<button>Overlay action</button>';
    Object.assign(overlay.style, { position: 'fixed', inset: '0 auto auto 0', width: '100%', height: '48px', zIndex: '1000' });
    document.body.append(overlay);
  });
  await expect(page.locator('#top-dialog')).not.toHaveAttribute('data-app-mode-header-strip', '');

  await page.evaluate(() => {
    document.getElementById('top-dialog').remove();
    const strip = document.createElement('div');
    strip.id = 'scroll-strip';
    strip.innerHTML = '<button>Scrolled control</button>';
    Object.assign(strip.style, { position: 'absolute', top: '300px', left: '0', width: '100%', height: '48px' });
    document.body.style.minHeight = '1200px';
    document.body.append(strip);
    window.scrollTo(0, 300);
  });
  await expect(page.locator('#scroll-strip')).toHaveAttribute('data-app-mode-header-strip', '');

  await page.evaluate(() => {
    const tabs = document.querySelector('#replacement-mode-branch [role="tablist"]');
    tabs.replaceChildren(Object.assign(document.createElement('button'), { textContent: 'Only control' }));
  });
  await expect(page.locator('#replacement-mode-branch [role="tablist"]')).not.toHaveAttribute('data-app-mode-header-tabs', '');

  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.getElementById('replacement-mode-branch').remove();
    const legacy = document.createElement('div');
    legacy.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);width:224px';
    legacy.innerHTML = '<div id="legacy-tabs" style="display:flex"><button>Chat</button><button>Work</button></div>';
    document.querySelector('header').prepend(legacy);
  });
  await expect(page.locator('#legacy-tabs')).toHaveAttribute('data-app-mode-header-tabs', '');
  await page.evaluate(() => document.querySelector('header').classList.toggle('synthetic-rerender'));
  await expect(page.locator('#legacy-tabs')).toHaveAttribute('data-app-mode-header-tabs', '');
});

test('a stale pin refresh cannot replace the accepted window binding', async ({ page }) => {
  let statusRequests = 0;
  let staleStatusRoute;
  const activityBodies = [];
  const reply = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.route('http://127.0.0.1:17863/**', async route => {
    if (route.request().url().endsWith('/session')) return reply(route, { saved: true });
    const body = route.request().postData() || '';
    const action = new URLSearchParams(body).get('action');
    if (action === 'status') {
      if (++statusRequests === 1) {
        staleStatusRoute = route;
        return;
      }
      return reply(route, { enabled: false, handle: 'fresh-handle', processId: 222 });
    }
    if (action === 'activity') {
      activityBodies.push(body);
      return reply(route, { enabled: true, handle: 'fresh-handle', processId: 222 });
    }
    if (action === 'on') {
      await reply(route, { enabled: true, handle: 'fresh-handle', processId: 222 });
      await staleStatusRoute.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: false, handle: 'stale-handle', processId: 111 }) });
      return;
    }
    return reply(route, { enabled: false, handle: 'fresh-handle', processId: 222 });
  });

  await page.goto('https://chatgpt.com/c/pin-binding-fixture');
  await page.bringToFront();
  await expect.poll(() => Boolean(staleStatusRoute)).toBe(true);
  const pin = page.locator('#chatgpt-app-mode-pin-toggle');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.wheel(0, 1);
  await expect.poll(() => activityBodies.length).toBe(1);
  expect(Object.fromEntries(new URLSearchParams(activityBodies[0]))).toMatchObject({ action: 'activity', handle: 'fresh-handle', processId: '222' });
});

const shareSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 16V3m-4 4 4-4 4 4M5 13v7h14v-7"/></svg>';
const shareButton = (attrs = 'aria-label="Share conversation"') => `<button id="share-action" ${attrs}>${shareSvg}Share</button>`;
const shareTriggerVariants = {
  // Labeled popup/menu/dialog triggers, aria hints omitted or idiosyncratic.
  menu: `${shareButton()}<button id="conversation-options" aria-label="Conversation options" aria-haspopup="menu" aria-expanded="false" aria-controls="conversation-menu">···</button>`,
  dialog: `${shareButton('aria-label="Share chat"')}<button id="conversation-options" aria-label="Conversation options" aria-haspopup="dialog" aria-expanded="false" aria-controls="conversation-menu">···</button>`,
  'no-hint': `${shareButton()}<button id="conversation-options" aria-label="Conversation options" aria-expanded="false">···</button>`,
  unlabeled: `${shareButton()}<button id="conversation-options" aria-haspopup="menu" aria-expanded="false" aria-controls="conversation-menu">···</button>`,
  // Test IDs on wrapper elements around unlabeled controls, each in its own
  // wrapper, matching sites that mount tooltip/slot containers per action.
  'wrapped-testid': `<div class="hdr-slot" data-testid="share-chat-button">${shareButton('')}</div><div class="hdr-slot" data-testid="conversation-options-button"><button id="conversation-options">${shareSvg.replace('fill="none" stroke="currentColor"', 'fill="currentColor"').replace('stroke-width="1.5"', '')}</button></div>`,
  // Non-button controls (Radix-style div[role=button]) beside a real Share.
  'role-button': `${shareButton()}<div id="conversation-options" role="button" tabindex="0" aria-label="Conversation options" aria-haspopup="menu">···</div>`,
  // An unlabeled ellipsis trailing Share inside a separate wrapper element.
  'unlabeled-after': `<div class="hdr-slot">${shareButton()}</div><div class="hdr-slot"><button id="conversation-options" aria-expanded="false">${shareSvg.replace('fill="none" stroke="currentColor"', 'fill="currentColor"').replace('stroke-width="1.5"', '')}</button></div>`,
};

for (const popup of Object.keys(shareTriggerVariants)) test(`Share moves into its conversation menu and survives keyboard use and navigation (${popup} trigger)`, async ({ page }) => {
  const html = fixture.replace(/<div class="header-actions">[\s\S]*?<\/div><\/header>/, `<div class="header-actions">${shareTriggerVariants[popup]}</div></header>`);
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('http://127.0.0.1:17863/**', route => route.fulfill({ contentType: 'application/json', body: '{"saved":true,"enabled":false}' }));
  await page.goto('https://chatgpt.com/c/share-fixture');
  await page.evaluate(() => {
    window.syntheticShareCalls = 0;
    document.addEventListener('click', event => {
      const button = event.target.closest('button, [role="button"], a[href]');
      if (button?.id === 'conversation-options') {
        const old = document.getElementById('conversation-menu');
        button.setAttribute('aria-expanded', String(!old));
        if (old) { old.remove(); button.focus(); return; }
        const menu = document.createElement('div');
        menu.id = 'conversation-menu'; menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-labelledby', button.id);
        menu.style.cssText = 'position:fixed;right:20px;top:60px;width:220px;padding:6px;color:#ddd;background:#202329;border-radius:12px;z-index:100';
        menu.innerHTML = '<button role="menuitem">Rename</button><button role="menuitem">Archive</button>';
        document.body.append(menu);
        menu.querySelector('button').focus();
      } else if (button?.id === 'share-action') {
        window.syntheticShareCalls++;
        const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
        dialog.textContent = 'Synthetic share dialog'; document.body.append(dialog);
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.getElementById('conversation-menu')) document.getElementById('conversation-options').click();
    });
  });
  const share = page.locator('header button').filter({ hasText: /^Share$/ });
  const trigger = page.locator('#conversation-options');
  const entry = page.locator('[data-app-mode-share-menu-item]');
  await expect(share).toBeHidden();
  await trigger.click();
  await expect(entry).toHaveCount(1);
  await expect(entry).toHaveText('Share');
  fs.mkdirSync(path.join(root, 'test-results', 'header-review'), { recursive: true });
  await page.getByRole('menu').screenshot({ path: path.join(root, 'test-results', 'header-review', 'share-menu.png') });
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(entry).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await page.evaluate(() => window.syntheticShareCalls)).toBe(1);
  await page.getByRole('dialog').evaluate(node => node.remove());
  await trigger.click();
  await expect(entry).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // React-style replacement plus client navigation must use the new native action.
  await page.evaluate(() => {
    history.pushState({}, '', '/c/share-fixture-second');
    const header = document.querySelector('header'); header.replaceWith(header.cloneNode(true));
  });
  await expect(share).toBeHidden();
  await trigger.click();
  await expect(entry).toHaveCount(1);
  await entry.click();
  await expect.poll(() => page.evaluate(() => window.syntheticShareCalls)).toBe(2);
  await page.getByRole('dialog').evaluate(node => node.remove());
  // Disabled native actions and menus unrelated to this conversation stay safe.
  await share.evaluate(node => { node.disabled = true; });
  await trigger.click();
  await expect(entry).toHaveAttribute('aria-disabled', 'true');
  await entry.dispatchEvent('click');
  expect(await page.evaluate(() => window.syntheticShareCalls)).toBe(2);
  await page.keyboard.press('Escape');
  await share.evaluate(node => { node.disabled = false; });
  await trigger.click();
  await page.locator('#conversation-menu').evaluate(menu => {
    const native = document.createElement('button'); native.setAttribute('role', 'menuitem'); native.textContent = 'Share'; menu.append(native);
  });
  await expect(entry).toHaveCount(0);
  await page.keyboard.press('Escape');
  await trigger.evaluate(node => node.remove());
  await expect(share).toBeVisible();
  await page.evaluate(() => {
    const unrelated = document.createElement('div'); unrelated.setAttribute('role', 'menu'); unrelated.innerHTML = '<button role="menuitem">Unrelated action</button>'; document.body.append(unrelated);
  });
  await expect(entry).toHaveCount(0);
});

test('standardized action row normalizes the site header in place without moving nodes', async ({ page }) => {
  const html = fixture.replace('<span class="header-title">',
    '<div class="header-leading" style="display:flex;gap:6px"><button aria-label="New chat"><svg viewBox="0 0 24 24"><path d="M5 19h14M8 16l1-5L18 2l4 4-9 9z" fill="none" stroke="currentColor"/></svg></button>' +
    '<button aria-label="Sidebar"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zM10 4v16" fill="none" stroke="currentColor"/></svg></button></div><span class="header-title">');
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('http://127.0.0.1:17863/**', route => route.fulfill({ contentType: 'application/json', body: '{"saved":true,"enabled":false}' }));
  await page.goto('https://chatgpt.com/c/action-row-fixture');
  // The Electron host injects the shared layout module alongside the content
  // script; reproduce that pairing in the fixture context.
  await page.addStyleTag({ content: headerLayoutCss });
  await page.evaluate(script => (0, eval)(script), headerLayoutScript);
  const header = page.locator('header');
  await expect(header).toHaveAttribute('data-app-mode-header-layout', '');
  const geometry = await page.evaluate(() => {
    const headerBox = document.querySelector('header').getBoundingClientRect();
    const box = element => element.getBoundingClientRect();
    const visible = element => {
      const rect = box(element);
      return rect.width > 0 && rect.height > 0;
    };
    const controls = [...document.querySelectorAll('header button')].filter(visible);
    return {
      header: headerBox,
      sidebar: box(document.querySelector('[aria-label="Sidebar"]')),
      newChat: box(document.querySelector('[aria-label="New chat"]')),
      options: box(document.querySelector('[aria-label="Conversation options"]')),
      pin: box(document.getElementById('chatgpt-app-mode-pin-toggle')),
      controls: controls.map(box),
      overflow: document.documentElement.scrollWidth > innerWidth,
      innerWidth,
    };
  });
  // One normalized 40px row: every control stays inside it, centered on the
  // same midline, without overlap or page-level horizontal scrolling.
  expect(Math.abs(geometry.header.height - 40)).toBeLessThanOrEqual(1);
  for (const rect of geometry.controls) {
    expect(rect.top).toBeGreaterThanOrEqual(geometry.header.top - 0.5);
    expect(rect.bottom).toBeLessThanOrEqual(geometry.header.bottom + 0.5);
    expect(rect.right).toBeLessThanOrEqual(geometry.innerWidth + 1);
  }
  expect(geometry.overlap ?? false).toBe(false);
  expect(geometry.overflow).toBe(false);
  // Sidebar is the leading control even though the site renders it second;
  // the action group is right-aligned and the app pin stays rightmost.
  expect(geometry.sidebar.left).toBeLessThanOrEqual(geometry.newChat.left);
  expect(geometry.options.right).toBeLessThanOrEqual(geometry.pin.left + 6);
  // The layout contract never moves nodes out of the site's own containers:
  // original handlers still fire exactly once on their native elements.
  await page.evaluate(() => {
    window.actionLog = [];
    for (const button of document.querySelectorAll('header button')) {
      button.addEventListener('click', () => window.actionLog.push(button.getAttribute('aria-label') || button.id));
    }
  });
  await header.locator('[aria-label="New chat"]').click();
  await header.locator('[aria-label="Conversation options"]').click();
  await expect.poll(() => page.evaluate(() => window.actionLog)).toEqual(['New chat', 'Conversation options']);
  // React-style replacement: the reconciler re-marks the new header once,
  // without duplicating markers or reparenting its controls.
  await page.evaluate(() => {
    const header = document.querySelector('header'); header.replaceWith(header.cloneNode(true));
  });
  await expect(header).toHaveAttribute('data-app-mode-header-layout', '');
  await expect(page.locator('[data-app-mode-header-layout]')).toHaveCount(1);
  // Removing the header releases every layout marker; the page falls back to
  // its own structure with no leftover app-managed artifacts.
  await page.evaluate(() => document.querySelector('header').remove());
  await expect(page.locator('[data-app-mode-header-layout]')).toHaveCount(0);
  await expect(page.locator('[data-app-mode-header-tabs],[data-app-mode-header-strip],[data-app-mode-header-control-branch]')).toHaveCount(0);
});

test('conversation typography and composer retain native styling with long content in both themes', async ({ page }) => {
  await page.goto('about:blank');
  await page.setContent(`<style>
    *{box-sizing:border-box}html{color-scheme:light}body{margin:0}
    main{padding:32px 24px;max-width:800px;margin:auto;min-width:0}
    [data-composer-body]{margin-top:28px;padding:16px}
    textarea{width:100%;min-height:60px;border:0;background:transparent;color:inherit;font:inherit;resize:vertical}
    article{min-width:0}pre{padding:16px;max-width:100%;overflow-x:auto}h2{font-size:24px}a{color:inherit}
  </style><body class="faux-chatgpt-app-mode"><main class="MainContentSurface-review">
    <article data-message-author-role="assistant"><h2>A clearer place to think</h2>
    <p>Readable conversations start with comfortable spacing and a consistent visual hierarchy.</p>
    <ul><li>Quiet surfaces keep attention on your work.</li><li>Clear headings make longer answers easier to scan.</li></ul>
    <blockquote>Useful details should be easy to find.</blockquote>
    <pre><code>${'long_example_identifier_'.repeat(15)}</code></pre>
    <p>Continue with a question or refine the next step.</p></article>
    <div data-composer-body><textarea aria-label="Message">A sample draft, preserved while resizing.</textarea></div>
  </main></body>`);
  let overridesStyle;
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.style.colorScheme = theme, theme);
    if (overridesStyle) await overridesStyle.evaluate(element => element.remove());
    await page.getByRole('textbox').focus();
    const nativeStyles = await page.evaluate(() => {
      const properties = ['fontFamily', 'fontSize', 'lineHeight', 'marginTop', 'marginBottom', 'paddingLeft', 'borderLeftWidth', 'borderLeftStyle', 'borderRadius', 'backgroundColor', 'color', 'boxShadow', 'outlineStyle', 'outlineWidth'];
      return ['[data-message-author-role]', 'h2', 'p', 'ul', 'li', 'blockquote', 'pre', '[data-composer-body]', 'textarea']
        .map(selector => properties.map(property => getComputedStyle(document.querySelector(selector))[property]));
    });
    overridesStyle = await page.addStyleTag({ path: path.join(extensionPath, 'styles/chatgpt-overrides.css') });
    for (const width of [390, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await page.getByRole('textbox').focus();
      await expect(page.getByRole('textbox')).toHaveValue('A sample draft, preserved while resizing.');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('pre').evaluate(e => e.scrollWidth > e.clientWidth)).toBe(true);
      const afterStyles = await page.evaluate(() => {
        const properties = ['fontFamily', 'fontSize', 'lineHeight', 'marginTop', 'marginBottom', 'paddingLeft', 'borderLeftWidth', 'borderLeftStyle', 'borderRadius', 'backgroundColor', 'color', 'boxShadow', 'outlineStyle', 'outlineWidth'];
        return ['[data-message-author-role]', 'h2', 'p', 'ul', 'li', 'blockquote', 'pre', '[data-composer-body]', 'textarea']
          .map(selector => properties.map(property => getComputedStyle(document.querySelector(selector))[property]));
      });
      expect(afterStyles).toEqual(nativeStyles);
    }
  }
});

test('extension styling, control, navigation and re-render in offline ChatGPT fixture', async ({ page }) => {
  const sessionPosts = [];
  let pinEnabled = false;
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`Browser console: ${message.text()}`);
  });
  await page.route('https://chatgpt.com/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: fixture,
  }));
  await page.route('http://127.0.0.1:17863/**', async (route) => {
    const request = route.request();
    const body = request.postData() || '';
    if (request.url().endsWith('/session')) sessionPosts.push(body);
    const action = new URLSearchParams(body).get('action');
    if (action === 'toggle') pinEnabled = !pinEnabled;
    if (action === 'on') pinEnabled = true;
    if (action === 'off') pinEnabled = false;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(request.url().endsWith('/session') ? { saved: true } : { enabled: pinEnabled, windows: 1 }),
    });
  });

  await page.goto('https://chatgpt.com/c/fixture-chat-id');
  await page.bringToFront();
  await expect(page.locator('#chatgpt-app-mode-pin-toggle')).toBeVisible();
  await expect(page.locator('#chatgpt-app-mode-pin-toggle')).toHaveAttribute('aria-keyshortcuts', 'Alt+Shift+P');
  await expect(page).toHaveTitle('ChatGPT');
  await expect(page.locator('body')).toHaveClass(/faux-chatgpt-app-mode/);
  await expect(page.locator('header')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('header')).toHaveCSS('background-color', 'rgb(236, 238, 242)');
  await expect.soft(page).toHaveScreenshot('fixture-desktop.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.soft(page).toHaveScreenshot('fixture-narrow.png');
  await page.setViewportSize({ width: 590, height: 400 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await expect(page.locator('header')).toHaveCSS('backdrop-filter', 'none');
  // Custom site themes can supply tokens and color-scheme without a .dark class.
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.cssText = 'color-scheme: dark; --main-surface-primary: #1e1e2e; --main-surface-secondary: #363648; --main-surface-tertiary: #45455a; --text-primary: #cdd6f4; --border-light: #58586e;';
  });
  await expect(page.locator('header')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('#chatgpt-app-mode-pin-toggle')).toHaveCSS('color', 'rgb(205, 214, 244)');
  await expect.soft(page.locator('header')).toHaveScreenshot('fixture-dark-header.png');
  await page.evaluate(() => document.documentElement.removeAttribute('style'));
  await expect(page.locator('header')).toHaveCSS('backdrop-filter', 'none');
  await page.setViewportSize({ width: 390, height: 844 });
  // The site's genuine responsive layout applies: at narrow widths its own
  // media rule collapses the aside instead of a spoofed desktop viewport.
  await expect(page.locator('aside')).toBeHidden();
  const overlapsMessage = await page.evaluate(() => {
    const pin = document.getElementById('chatgpt-app-mode-pin-toggle').getBoundingClientRect();
    return [...document.querySelectorAll('.message,.composer')].some(element => {
      const box = element.getBoundingClientRect();
      return pin.x < box.right && pin.right > box.x && pin.y < box.bottom && pin.bottom > box.y;
    });
  });
  expect(overlapsMessage).toBe(false);

  await page.locator('#chatgpt-app-mode-pin-toggle').click();
  await expect(page.locator('#chatgpt-app-mode-pin-toggle')).toHaveAttribute('aria-pressed', 'true');

  await page.evaluate(() => {
    history.pushState({}, '', '/c/second-fixture-id');
    document.querySelector('#app').replaceChildren(Object.assign(document.createElement('main'), {
      innerHTML: '<header>Re-rendered conversation</header><section class="conversation"><div class="message">Updated fixture content</div></section>',
    }));
  });
  await expect(page.locator('#chatgpt-app-mode-pin-toggle')).toBeVisible();
  await expect.poll(() => sessionPosts.some((body) => decodeURIComponent(body).includes('/c/second-fixture-id')), {
    timeout: 8_000,
  }).toBe(true);
  await expect(page.locator('#chatgpt-app-mode-pin-toggle')).toHaveCount(1);
  await page.keyboard.press('Alt+Shift+P');
  await expect(page.locator('#chatgpt-app-mode-pin-toggle')).toHaveAttribute('aria-pressed', 'false');
});

test('new-chat header and clipped app fallback inherit a custom theme with stale tokens', async ({ page }) => {
  const home = fixture.replace('<header>', '<div id="page-header" style="display:flex;align-items:center;min-height:48px">').replace('</header>', '</div>');
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: home }));
  await page.route('http://127.0.0.1:17863/**', route => route.fulfill({ contentType: 'application/json', body: '{"saved":true,"enabled":false}' }));
  await page.setViewportSize({ width: 590, height: 700 });
  await page.goto('https://chatgpt.com/');
  await page.addStyleTag({ content: `
    :root { color-scheme: dark; --main-surface-primary: #111; --text-primary: #fff; }
    .shell { position: fixed; inset: 0; overflow: hidden; }
    main { min-height: 0; overflow: auto; color: #cdd6f4; background: #1e1e2e; }
  ` });
  const pin = page.locator('#chatgpt-app-mode-pin-toggle');
  await expect(page.locator('#page-header #chatgpt-app-mode-pin-toggle')).toBeVisible();
  await expect(pin).toHaveCSS('color', 'rgb(205, 214, 244)');
  await expect(page.locator('#page-header')).toHaveCSS('backdrop-filter', 'none');
  expect(await page.locator('#page-header').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await page.evaluate(() => document.getElementById('page-header').remove());
  await expect(page.locator('main > #chatgpt-app-mode-toolbar-fallback')).toBeVisible();
  await expect(pin).toBeInViewport();
  expect(await page.locator('#chatgpt-app-mode-toolbar-fallback').evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await page.evaluate(() => {
    history.pushState({}, '', '/c/synthetic-from-home');
    const header = document.createElement('header');
    header.textContent = 'Synthetic conversation';
    document.querySelector('main').prepend(header);
  });
  await expect(page.locator('header #chatgpt-app-mode-pin-toggle')).toBeVisible();
  await expect(pin).toHaveCount(1);
  await expect(page.locator('#chatgpt-app-mode-toolbar-fallback')).toHaveCount(0);
  // Client navigation may retain the old conversation and merely hide it.
  await page.evaluate(() => {
    const oldMain = document.querySelector('main');
    oldMain.id = 'old-conversation';
    const nextMain = document.createElement('main');
    nextMain.id = 'non-conversation';
    nextMain.hidden = true;
    nextMain.innerHTML = '<h1>Synthetic library page</h1>';
    oldMain.after(nextMain);
  });
  await page.evaluate(() => {
    history.pushState({}, '', '/library');
    document.getElementById('old-conversation').style.display = 'none';
    document.getElementById('non-conversation').hidden = false;
  });
  await expect(page.locator('#non-conversation > #chatgpt-app-mode-toolbar-fallback')).toBeVisible();
  await expect(pin).toBeInViewport();
  // A second non-conversation page keeps the hidden main and its fallback.
  await page.evaluate(() => {
    const nextMain = document.createElement('main');
    nextMain.id = 'second-page';
    document.getElementById('non-conversation').style.display = 'none';
    document.querySelector('#app').append(nextMain);
    history.pushState({}, '', '/settings');
  });
  await expect(page.locator('#second-page > #chatgpt-app-mode-toolbar-fallback')).toBeVisible();
  await expect(pin).toHaveCount(1);
  await page.evaluate(() => {
    document.getElementById('second-page').style.display = 'none';
    document.getElementById('old-conversation').style.display = '';
    history.back();
  });
  await expect(page.locator('#old-conversation header #chatgpt-app-mode-pin-toggle')).toBeVisible();
  await expect(page.locator('#chatgpt-app-mode-toolbar-fallback')).toHaveCount(0);
});

test('session retry, connection recovery, pin synchronization and header fallback', async ({ page }) => {
  let sessionAttempts = 0;
  let pinOnline = false;
  let enabled = false;
  const savedRoutes = [];
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.route('http://127.0.0.1:17863/**', async route => {
    const request = route.request();
    const body = request.postData() || '';
    if (request.url().endsWith('/session')) {
      sessionAttempts++;
      savedRoutes.push(new URLSearchParams(body).get('url'));
      return route.fulfill({ status: sessionAttempts === 1 ? 503 : 200, contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://chatgpt.com' }, body: JSON.stringify({ saved: sessionAttempts > 1 }) });
    }
    if (!pinOnline) return route.abort('connectionrefused');
    if (body.includes('action=toggle')) enabled = !enabled;
    if (body.includes('action=on')) enabled = true;
    if (body.includes('action=off')) enabled = false;
    return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://chatgpt.com' }, body: JSON.stringify({ enabled, handle: '123', processId: 987, windows: 1 }) });
  });
  await page.goto('https://chatgpt.com/c/synthetic-retry?synthetic=discarded#discarded');
  await page.bringToFront();
  const pin = page.locator('#chatgpt-app-mode-pin-toggle');
  await expect(pin).toHaveClass(/is-unavailable/);
  await expect(page.locator('#chatgpt-app-mode-control-status')).toHaveCount(0);
  await expect(pin).toHaveCSS('color', 'rgb(154, 52, 18)');
  await expect.poll(() => sessionAttempts, { timeout: 10000 }).toBeGreaterThanOrEqual(2);
  expect(savedRoutes.every(url => url === 'https://chatgpt.com/c/synthetic-retry')).toBe(true);
  pinOnline = true;
  await pin.click(); // Recovery must perform the requested action on this same click.
  await expect(pin).not.toHaveClass(/is-unavailable/);
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Alt+Shift+P');
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  // App-mode headers may delegate pointer handling to their children and mark
  // the remaining header as a native drag region. Our control must opt in.
  await page.evaluate(() => {
    const header = document.querySelector('header');
    header.style.pointerEvents = 'none';
    header.style.webkitAppRegion = 'drag';
  });
  await expect(pin).toHaveCSS('pointer-events', 'auto');
  await expect(pin).toHaveCSS('-webkit-app-region', 'no-drag');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Alt+Shift+P');
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  enabled = true; // Another native control changed the actual window state.
  await expect(pin).toHaveAttribute('aria-pressed', 'true', { timeout: 8000 });
  await page.evaluate(() => document.querySelector('header').remove());
  await expect(pin).toHaveCount(1);
  await expect(page.locator('#chatgpt-app-mode-toolbar-fallback')).toBeVisible();
  await page.evaluate(() => {
    const header = document.createElement('header'); header.textContent = 'Synthetic replacement header';
    document.querySelector('main').prepend(header);
  });
  await expect(page.locator('header #chatgpt-app-mode-pin-toggle')).toHaveCount(1);
  await expect(page.locator('#chatgpt-app-mode-toolbar-fallback')).toHaveCount(0);
  await page.evaluate(() => {
    const pin = document.getElementById('chatgpt-app-mode-pin-toggle');
    pin.replaceWith(pin.cloneNode(true)); // Framework clone loses element listeners.
    document.querySelector('header').addEventListener('click', () => { throw Error('Pin click escaped into ChatGPT header'); });
  });
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
});

test('browser can reach the isolated server only from allowed origins', async ({ page, context }, testInfo) => {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const appRoot = fs.mkdtempSync(path.join(root, 'test-results', 'runs', 'browser-server-'));
  fs.writeFileSync(path.join(appRoot, 'config.json'), JSON.stringify({
    chromiumPortableRoot: path.join(appRoot, 'Browser', 'ChromiumPortable'),
    appProfileDir: path.join(appRoot, 'Browser', 'Profile'), rememberWindowPlacement: false,
    privacy: { showChatTitles: false },
  }));
  const server = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'Start-ChatGPT-TopMostServer.ps1'), '-AppRoot', appRoot, '-Port', String(port)], { windowsHide: true, stdio: 'ignore' });
  const endpoint = `http://127.0.0.1:${port}/session`;
  try {
    await expect.poll(async () => {
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { Origin: 'https://chatgpt.com', 'Content-Type': 'text/plain' }, body: 'url=https%3A%2F%2Fchatgpt.com%2Fc%2Fsynthetic-browser' });
        return response.status;
      } catch { return 0; }
    }).toBe(200);
    await context.grantPermissions(['local-network-access'], { origin: 'https://chatgpt.com' });
    await page.route('http://127.0.0.1:17863/**', route => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://chatgpt.com' }, body: '{"saved":true,"enabled":false,"handle":"123","processId":987}' }));
    await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    await page.goto('https://chatgpt.com/c/synthetic-browser');
    await page.bringToFront();
    const result = await page.evaluate(async endpoint => {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: 'url=https%3A%2F%2Fchatgpt.com%2Fc%2Fsynthetic-browser' });
      return { status: response.status, body: await response.json() };
    }, endpoint);
    expect(result).toEqual({ status: 200, body: { saved: true } });
    await page.route('https://evil.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic rejected origin</title>' }));
    await context.grantPermissions(['local-network-access'], { origin: 'https://evil.test' });
    await page.goto('https://evil.test/');
    const rejected = await page.evaluate(async endpoint => {
      try { await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'url=https%3A%2F%2Fchatgpt.com%2Fc%2Fsynthetic-rejected' }); return false; }
      catch { return true; }
    }, endpoint);
    expect(rejected).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(appRoot, 'logs', 'last-session.json'))).url).toBe('https://chatgpt.com/c/synthetic-browser');
  } finally {
    server.kill();
    await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
  }
});

base('content-script pin clicks reach a real HTTP endpoint after header cloning', async ({}, testInfo) => {
  let enabled = false;
  const mutations = [];
  const server = http.createServer((request, response) => {
    if (request.headers.origin !== 'https://chatgpt.com') { response.writeHead(403).end(); return; }
    const headers = { 'Access-Control-Allow-Origin': 'https://chatgpt.com', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
    if (request.method === 'OPTIONS') {
      if (request.headers['access-control-request-private-network'] === 'true') headers['Access-Control-Allow-Private-Network'] = 'true';
      response.writeHead(200, headers).end('{}'); return;
    }
    let body = '';
    request.on('data', chunk => body += chunk);
    request.on('end', () => {
      const fields = new URLSearchParams(body);
      if (request.url === '/session') { response.writeHead(200, headers).end('{"saved":true}'); return; }
      const action = fields.get('action');
      if (action === 'on' || action === 'off') {
        if (fields.get('handle') !== '123' || fields.get('processId') !== '987') { response.writeHead(409, headers).end('{}'); return; }
        mutations.push(action); enabled = action === 'on';
      }
      response.writeHead(200, headers).end(JSON.stringify({ enabled, handle: '123', processId: 987, windows: 1 }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const copy = testInfo.outputPath('extension');
  fs.cpSync(extensionPath, copy, { recursive: true });
  for (const relativePath of JSON.parse(fs.readFileSync(path.join(copy, 'manifest.json'), 'utf8')).content_scripts[0].js) {
    const script = path.join(copy, relativePath);
    fs.writeFileSync(script, fs.readFileSync(script, 'utf8').replaceAll('127.0.0.1:17863', `127.0.0.1:${port}`));
  }
  let context;
  try {
    context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
      executablePath, headless: false,
      args: [`--disable-extensions-except=${copy}`, `--load-extension=${copy}`, '--no-first-run', '--no-default-browser-check'],
    });
    await context.grantPermissions(['local-network-access'], { origin: 'https://chatgpt.com' });
    await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    const page = await context.newPage();
    await page.goto('https://chatgpt.com/c/synthetic-real-control');
    await page.bringToFront();
    const pin = page.locator('#chatgpt-app-mode-pin-toggle');
    await pin.click();
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => {
      const header = document.querySelector('header'); header.replaceWith(header.cloneNode(true));
    });
    await pin.click();
    await expect(pin).toHaveAttribute('aria-pressed', 'false');
    expect(mutations).toEqual(['on', 'off']);
  } finally {
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('content script reinjection is idempotent and keeps a single owned control set', async ({ page }) => {
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.route('http://127.0.0.1:17863/**', route => route.fulfill({
    contentType: 'application/json', body: '{"saved":true,"enabled":false}',
  }));
  await page.goto('https://chatgpt.com/');
  const before = await page.locator('#chatgpt-app-mode-pin-toggle').count();
  for (const script of overrideScripts) await page.evaluate(source => (0, eval)(source), script);
  await expect(page.locator('#chatgpt-app-mode-pin-toggle')).toHaveCount(before);
  await expect(page.locator('#app-mode-compact-sidebar')).toHaveCount(0);
  await expect(page.locator('[data-app-mode-share-menu-item]')).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-sidebar-status', 'unsupported');
  expect(await page.evaluate(() => window.__APP_MODE_OVERRIDE_RUNTIME__?.initialized)).toBe(true);
});
