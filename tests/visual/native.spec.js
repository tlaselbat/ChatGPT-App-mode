const { test, expect, _electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { visualHtml } = require('../helpers/visual-fixture.cjs');
const { windowCapture } = require('../helpers/window-capture.cjs');
const { checkComposition } = require('../helpers/composition-check.cjs');
const root = path.resolve(__dirname, '../..');

for (const [id, width, height, theme] of [
  ['desktop', 1280, 900, 'light'], ['narrow', 390, 850, 'dark'],
  ['loading', 680, 700, 'light'], ['fullscreen', 680, 700, 'light'],
]) test(`composition ${id}`, async ({}, info) => {
  test.setTimeout(45000);
  const evidence = { environment: 'windows-electron', window: { width, height, unit: 'dip' }, zoom: 1, appearance: theme, behavioralResult: 'unavailable', geometryResult: 'unavailable', compositionResult: 'unavailable', visualResult: 'unavailable' };
  let app;
  try {
    if (process.platform !== 'win32') { evidence.reason = 'Windows composition requires Windows'; test.skip(true, evidence.reason); }
    const scratch = fs.mkdtempSync(path.join(info.outputPath(), 'native-profile-'));
    fs.writeFileSync(path.join(scratch, 'config.json'), JSON.stringify({ url: 'https://chatgpt.com/c/synthetic-recents-0', window: { width, height }, rememberWindowPlacement: false, privacy: { saveLastSession: false, trackRecentChats: false } }));
    const fixture = path.join(scratch, 'fixture.html');
    fs.writeFileSync(fixture, id === 'loading'
      ? '<!doctype html><style>body{margin:0;background:#ff00ff!important}</style><div data-app-shell-responsive-sidebar="true">Pending synthetic shell</div>'
      : visualHtml({ theme, expanded: id === 'desktop' }));
    const env = { ...process.env, APP_MODE_HOST_FIXTURE: '1' };
    delete env.ELECTRON_RUN_AS_NODE; delete env.APP_MODE_HOST_TEST_PORT;
    app = await _electron.launch({ executablePath: require('electron'), env,
      args: [path.join(root, 'WindowHost/main.cjs'), `--app-mode-root=${scratch}`, `--fixture=${fixture}`,
        "--fixture-csp=default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'"] });
    await expect.poll(() => app.windows().some(p => p.url().endsWith('/controls.html'))).toBe(true);
    const controls = app.windows().find(p => p.url().endsWith('/controls.html'));
    await expect.poll(() => app.windows().some(p => p.url().startsWith('https://chatgpt.com'))).toBe(true);
    const page = app.windows().find(p => p.url().startsWith('https://chatgpt.com'));
    await page.waitForLoadState('load');
    // Test-only markers prove the captured pixels include each independent view.
    await app.evaluate(async ({ BrowserWindow }) => {
      const trusted = BrowserWindow.getAllWindows()[0].contentView.children.find(v => v.webContents.getURL().endsWith('/controls.html'));
      await trusted.webContents.insertCSS('*{animation:none!important;transition:none!important}body::after{content:"";position:fixed;left:170px;top:8px;width:20px;height:20px;background:rgb(0,255,255);z-index:2147483647;pointer-events:none}');
    });
    await page.evaluate(() => { const marker = document.createElement('div'); marker.style.cssText = 'position:fixed;left:200px;top:150px;width:24px;height:24px;background:rgb(0,187,0);z-index:2147483647'; document.body.append(marker); });
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', id === 'loading' ? 'loading' : 'ready');
    if (id !== 'loading') {
      // A composition capture must not silently accept partial injection or
      // the first paint of the rail's intentional initialization fade.
      expect(await page.evaluate(() => typeof window.navigation?.addEventListener)).toBe('function');
      await expect.poll(() => page.evaluate(() => window.__APP_MODE_CONTEXT__?.installed === true && window.__APP_MODE_CONTEXT__?.hostNavigation?.ready === true)).toBe(true);
      await expect(page.locator('body')).toHaveAttribute('data-app-mode-host-navigation-owned', '');
      await expect(controls.locator('[data-action="toggle-sidebar"]')).toBeVisible();
      await expect(page.locator('#app-mode-compact-sidebar-actions')).toHaveCSS('opacity', '1');
      await expect(page.locator('#app-mode-compact-sidebar-actions')).toHaveCSS('visibility', 'visible');
    }
    const owner = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
    if (id === 'fullscreen') {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true));
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].getBounds().y)).toBe(0);
    }
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); });
    await page.evaluate(() => document.fonts.ready);
    evidence.behavioralResult = 'passed';
    const file = info.outputPath('composition.png');
    if (process.env.APP_MODE_COMPOSITION_PROBE === 'missing-chrome') {
      await app.evaluate(async ({ BrowserWindow }) => {
        const trusted = BrowserWindow.getAllWindows()[0].contentView.children.find(v => v.webContents.getURL().endsWith('/controls.html'));
        await trusted.webContents.insertCSS('body::after{display:none!important}');
      });
    }
    let capture;
    evidence.geometryResult = 'failed';
    evidence.compositionResult = 'failed';
    await expect(async () => { capture = await windowCapture(app, file, owner); evidence.geometry = capture; checkComposition(capture, id); }).toPass({ timeout: 8000 });
    evidence.runtime = await app.evaluate(() => process.versions);
    evidence.geometryResult = 'passed';
    evidence.compositionResult = 'passed';
    const fingerprint = `${os.release()}-electron-${evidence.runtime.electron}-scale-${capture.scaleFactor}`;
    evidence.goldenEnvironment = fingerprint;
    // Local opt-in requires an exact environment fingerprint, never a generic native baseline.
    if (process.env.APP_MODE_NATIVE_GOLDENS === fingerprint && !process.env.CI) {
      evidence.visualResult = 'failed';
      expect(fs.readFileSync(file)).toMatchSnapshot(`${id}-${fingerprint}.png`, { maxDiffPixels: 50 });
      evidence.visualResult = 'passed';
    } else evidence.reason = 'Native golden comparison unavailable until exact environment is approved; composition assertions executed';
  } finally {
    if (app) await app.close();
    const file = info.outputPath('composition.png');
    if (fs.existsSync(file)) await info.attach('synthetic-composition', { path: file, contentType: 'image/png' });
    await info.attach('visual-metadata', { body: Buffer.from(JSON.stringify(evidence)), contentType: 'application/json' });
  }
});
