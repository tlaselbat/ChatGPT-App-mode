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
  await expect(page.locator('header')).toHaveCSS('background-color', 'rgb(244, 245, 247)');
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
  await expect.soft(page.locator('#page-header')).toHaveScreenshot('fixture-home-header.png');
  await page.evaluate(() => document.getElementById('page-header').remove());
  await expect(page.locator('main > #chatgpt-app-mode-toolbar-fallback')).toBeVisible();
  await expect(pin).toBeInViewport();
  await expect.soft(page.locator('#chatgpt-app-mode-toolbar-fallback')).toHaveScreenshot('fixture-home-fallback.png');
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
  const script = path.join(copy, 'scripts', 'chatgpt-overrides.js');
  fs.writeFileSync(script, fs.readFileSync(script, 'utf8').replaceAll('127.0.0.1:17863', `127.0.0.1:${port}`));
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
