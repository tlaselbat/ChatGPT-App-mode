const { test: base, expect, chromium } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const extensionPath = path.join(root, 'extension');
const profilePath = path.join(root, 'test-results', 'browser-profile');
const configuredChrome = process.env.APP_MODE_CHROMIUM_EXE;
const candidates = [
  configuredChrome,
  path.join(root, 'Browser', 'ChromiumPortable', 'App', 'Chromium', 'chrome.exe'),
];
const executablePath = candidates.find((candidate) => candidate && fs.existsSync(candidate));
if (!executablePath) {
  throw new Error('Chromium was not found. Install the project Chromium runtime or set APP_MODE_CHROMIUM_EXE.');
}

const test = base.extend({
  context: async ({}, use) => {
    fs.mkdirSync(profilePath, { recursive: true });
    const context = await chromium.launchPersistentContext(profilePath, {
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
  html, body { margin: 0; min-height: 100%; font-family: Arial, sans-serif; color: #202123; background: #fff; }
  .shell { min-height: 100vh; display: grid; grid-template-columns: 250px minmax(0, 1fr); }
  aside { background: #f7f7f8; padding: 22px 16px; border-right: 1px solid #ececf1; }
  .brand { font-size: 17px; font-weight: 700; margin-bottom: 30px; }
  .nav { padding: 10px 12px; border-radius: 8px; background: #ececf1; font-size: 14px; }
  main { min-width: 0; display: flex; flex-direction: column; }
  header { height: 58px; border-bottom: 1px solid #ececf1; display:flex; align-items:center; padding: 0 26px; font-size: 14px; font-weight: 600; }
  .conversation { width: min(720px, calc(100% - 48px)); margin: 42px auto; }
  .message { padding: 18px 20px; margin-bottom: 16px; border: 1px solid #ececf1; border-radius: 14px; line-height: 1.55; font-size: 15px; }
  .message.user { background: #f7f7f8; }
  .composer { margin-top: 35px; padding: 16px; border: 1px solid #d9d9e3; border-radius: 16px; color: #777; }
  @media (max-width: 600px) { .shell { grid-template-columns: 1fr; } aside { display:none; } header { padding: 0 16px; } .conversation { width: calc(100% - 28px); margin-top: 24px; } }
</style></head><body><div class="shell" id="app">
<aside><div class="brand">ChatGPT</div><div class="nav">Current conversation</div></aside>
<main><header>Fixture conversation</header><section class="conversation">
<div class="message user">Can you help me organize a visual review?</div>
<div class="message">Here is a clean offline fixture for checking layout, narrow-window behavior, and extension controls. No private conversation data is included.</div>
<div class="composer">Message ChatGPT</div></section></main></div></body></html>`;

test('extension styling, control, navigation and re-render in offline ChatGPT fixture', async ({ page }) => {
  const sessionPosts = [];
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
    const enabled = body.includes('action=toggle');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(request.url().endsWith('/session') ? { saved: true } : { enabled, windows: 1 }),
    });
  });

  await page.goto('https://chatgpt.com/c/fixture-chat-id');
  await expect(page.locator('#chatgpt-app-mode-pin-toggle')).toBeVisible();
  await expect(page).toHaveTitle('ChatGPT');
  await expect(page.locator('body')).toHaveClass(/faux-chatgpt-app-mode/);
  await expect(page).toHaveScreenshot('fixture-desktop.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page).toHaveScreenshot('fixture-narrow.png');
  await expect(page.locator('aside')).toBeHidden();

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
});
