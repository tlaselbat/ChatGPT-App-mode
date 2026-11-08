const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron, expect } = require('playwright/test');
const root = path.resolve(__dirname, '..');

async function launch(html) {
  const runs = path.join(root, 'test-results/runs'); fs.mkdirSync(runs, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(runs, 'startup-'));
  const fixture = path.join(scratch, 'fixture.html'); fs.writeFileSync(fixture, html);
  fs.writeFileSync(path.join(scratch, 'config.json'), JSON.stringify({
    window: { width: 680, height: 700 }, rememberWindowPlacement: false,
    privacy: { saveLastSession: false, trackRecentChats: false },
  }));
  const env = { ...process.env, APP_MODE_HOST_FIXTURE: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.APP_MODE_HOST_TEST_PORT;
  const app = await _electron.launch({ executablePath: require('electron'), env,
    args: [path.join(root, 'WindowHost/main.cjs'), `--app-mode-root=${scratch}`, `--fixture=${fixture}`] });
  await expect.poll(() => app.windows().some(page => page.url().endsWith('/controls.html'))).toBe(true);
  const controls = app.windows().find(page => page.url().endsWith('/controls.html'));
  await controls.waitForLoadState('load');
  await expect.poll(() => app.windows().some(page => page.url().startsWith('https://chatgpt.com'))).toBe(true);
  const page = app.windows().find(page => page.url().startsWith('https://chatgpt.com'));
  await page.waitForLoadState('load');
  return { app, controls, page, scratch };
}

const { windowCapture } = require('./helpers/window-capture.cjs');

const delayed = `<!doctype html><style>body{margin:0;background:#ff00ff!important;color:black}body.faux-chatgpt-app-mode{--app-mode-titlebar-bg:rgba(200,200,200,.25)}main{height:600px;background:green}</style>
<div data-app-shell-responsive-sidebar="true">UNSTYLED FIXTURE</div><script>
window.releaseShell=()=>{const main=document.createElement('main');main.innerHTML='<header><button aria-label="Share">Share</button></header><p>Customized fixture</p>';document.querySelector('[data-app-shell-responsive-sidebar]').append(main);};
</script>`;

test('title-bar sidebar toggle exclusively controls docked and drawer navigation with Search atop the rail', { timeout: 45000 }, async () => {
  const html = `<!doctype html><style>*{box-sizing:border-box}body{margin:0}#shell{display:flex;height:100vh}main{flex:1;min-width:0}header,.h-toolbar{height:40px}aside{width:260px;flex:none}#browser-sidebar-popover{position:fixed;inset:0 auto 0 0;width:260px;background:Canvas;z-index:80}</style>
    <div id="shell" data-app-shell-responsive-sidebar data-app-shell-sidebar-open="false"><main><header><button id="opener" aria-label="Open sidebar">Sidebar</button></header><p>Native navigation fixture</p></main></div>
    <script>
    const root=document.querySelector('#shell');window.nativeToggleCalls=0;
    function toggle(){window.nativeToggleCalls++;const open=root.dataset.appShellSidebarOpen!=='true';root.dataset.appShellSidebarOpen=String(open);render()}
    function render(){document.querySelector('aside')?.remove();document.querySelector('#browser-sidebar-popover')?.remove();const open=root.dataset.appShellSidebarOpen==='true';document.querySelector('#opener').setAttribute('aria-label',open?'Close sidebar':'Open sidebar');if(!open)return;
      const panel=document.createElement(innerWidth<700?'div':'aside');if(innerWidth<700){panel.id='browser-sidebar-popover';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true')}else panel.className='app-shell-left-panel';
      panel.innerHTML='<div class="sidebar-navigation"><div class="h-toolbar"><strong>ChatGPT</strong><button aria-label="Search">Search</button><button aria-label="Close sidebar" id="native-close">Close</button></div><div class="group/nav-list"><button aria-label="New chat">New chat</button></div></div>';
      if(innerWidth<700)document.body.append(panel);else root.prepend(panel);panel.querySelector('#native-close').onclick=toggle;panel.querySelector('[aria-label="Search"]').onclick=()=>{const dialog=document.createElement('div');dialog.id='search-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Search');dialog.innerHTML='<input aria-label="Search conversations">';document.body.append(dialog);dialog.querySelector('input').focus()}}
    document.querySelector('#opener').onclick=toggle;window.addEventListener('resize',render);document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(document.querySelector('#search-dialog'))document.querySelector('#search-dialog').remove();else if(document.querySelector('#browser-sidebar-popover'))toggle()}});
    </script>`;
  const { app, controls, page, scratch } = await launch(html);
  try {
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'ready');
    const toggle = controls.locator('[data-action="toggle-sidebar"]');
    const railSearch = page.locator('#app-mode-compact-sidebar-actions [aria-label="Search"]');
    for (const width of [1280, 680, 390]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 800), width);
      await expect(toggle).toBeVisible(); await expect(page.locator('#app-mode-compact-sidebar')).toBeHidden();
      await expect(controls.locator('[data-action="open-search"]')).toBeHidden();
      await expect(railSearch).toBeVisible();
      assert.equal((await railSearch.boundingBox()).y, 2);
      assert.equal(await page.locator('#app-mode-compact-sidebar-actions button').first().getAttribute('aria-label'), 'Search');
      const before = await toggle.boundingBox();
      await toggle.click();
      await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', width < 700 ? 'drawer' : 'docked');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true'); await expect(toggle).toBeEnabled();
      await expect(page.locator('#native-close')).toBeHidden(); await expect(page.locator('#opener')).toBeHidden();
      assert.deepEqual(await toggle.boundingBox(), before);
      await expect(page.locator('main')).toHaveCSS('margin-left', '8px');
      await expect(page.locator('#app-mode-compact-sidebar-actions')).toHaveCSS('opacity', '0');
      await controls.screenshot({ path: path.join(scratch, 'titlebar-' + width + '.png') });
      await page.screenshot({ path: path.join(scratch, 'expanded-' + width + '.png') });
      await toggle.focus(); await controls.keyboard.press('Enter');
      await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', 'compact');
      await expect(railSearch).toBeVisible();
      await expect(page.locator('main')).toHaveCSS('margin-left', '8px');
      await expect(page.locator('#app-mode-compact-sidebar-actions')).toHaveCSS('opacity', '1');
      await page.screenshot({ path: path.join(scratch, 'compact-' + width + '.png') });
    }
    assert.equal(await page.evaluate(() => window.nativeToggleCalls), 6);
    await railSearch.click();
    await expect(page.getByRole('textbox', { name: 'Search conversations' })).toBeFocused();
    await expect(toggle).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(railSearch).toBeVisible(); await expect(toggle).toBeEnabled();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true));
    await expect(page.locator('#app-mode-compact-sidebar')).toBeVisible();
    await expect(controls.locator('.titlebar')).toBeHidden();
  } finally { await app.close(); }
});

test('opaque startup covers composited content until readiness and recovers renderer failures', { timeout: 90000 }, async () => {
  const launched = await launch(delayed);
  const { app, controls, scratch } = launched;
  let { page } = launched;
  try {
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'loading');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 0, 255)');
    const initial = await windowCapture(app, path.join(scratch, 'startup-loading.png'));
    assert.equal(initial.magenta, 0, 'Opaque local view must completely obscure the remote magenta fixture');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true));
    await expect(controls.locator('body')).toHaveAttribute('data-fullscreen', 'true');
    await expect(controls.locator('.titlebar')).toBeHidden();
    assert.equal((await windowCapture(app, path.join(scratch, 'fullscreen-loading.png'))).magenta, 0);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(false));
    await expect(controls.locator('body')).toHaveAttribute('data-fullscreen', 'false');
    // An occluded/hidden remote view must not lose its installed title-bar
    // navigation integration while waiting for suspended animation frames.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    const released = Date.now(); await page.evaluate(() => window.releaseShell());
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'ready');
    assert.ok(Date.now() - released < 3000, 'Readiness must reveal without waiting for the recovery deadline');
    assert.equal(await page.evaluate(() => window.__APP_MODE_CONTEXT__.hostNavigation.ready), true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    const ready = await windowCapture(app, path.join(scratch, 'startup-ready.png'));
    assert.ok(ready.green > 5000, 'Composited capture must include the now-revealed remote view');
    assert.ok(ready.magenta > 5000, 'The same persistent underlay must be visible in the actual window after uncovering');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length), 2);
    // Full reload must cover the new document before its delayed shell exists.
    await page.reload();
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'loading');
    assert.equal((await windowCapture(app, path.join(scratch, 'reload-loading.png'))).magenta, 0);
    await page.evaluate(() => window.releaseShell());
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'ready');
    // Real renderer crash, followed by trusted UI Reload and new initialization.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]; win.focus();
      const remote = win.contentView.children[0].webContents; remote.focus(); remote.forcefullyCrashRenderer();
    });
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'recovery');
    await expect(controls.getByRole('button', { name: 'Reload', exact: true })).toBeFocused();
    await controls.keyboard.press('Enter');
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'loading');
    await expect.poll(() => app.windows().some(p => !p.isClosed() && p.url().startsWith('https://chatgpt.com'))).toBe(true);
    page = app.windows().find(p => !p.isClosed() && p.url().startsWith('https://chatgpt.com'));
    await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
      const remote = BrowserWindow.getAllWindows()[0].contentView.children[0].webContents;
      return remote.mainFrame.executeJavaScript('typeof window.releaseShell').catch(() => 'unavailable');
    })).toBe('function');
    // Playwright retains its crashed-target flag after Electron has recovered
    // this webContents; inspect the recovered renderer through its owning host.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.mainFrame.executeJavaScript('window.releaseShell()'));
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'ready');
    // Destroyed webContents is replaced in the existing slot, not an extra view.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.close({ waitForBeforeUnload: false }));
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'recovery');
    await controls.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect.poll(() => app.windows().some(p => !p.isClosed() && p !== page && p.url().startsWith('https://chatgpt.com'))).toBe(true);
    const replacement = app.windows().find(p => !p.isClosed() && p !== page && p.url().startsWith('https://chatgpt.com'));
    await replacement.waitForLoadState('load'); await replacement.evaluate(() => window.releaseShell());
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'ready');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length), 2);
    fs.writeFileSync(path.join(scratch, 'capture-results.json'), JSON.stringify({ initial, ready }, null, 2));
  } finally { await app.close(); }
});

test('optional unsupported adapters reveal immediately and injection failure reveals usable native content', { timeout: 35000 }, async () => {
  const { app, controls, page } = await launch('<!doctype html><body><main>Usable unsupported native content</main>');
  try {
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'ready');
    await expect(page.locator('body')).toHaveAttribute('data-app-mode-sidebar-status', 'unsupported');
    assert.equal(await page.evaluate(() => fetch('http://127.0.0.1:17863/session').then(() => false, () => true)), true,
      'Fixtures without an isolated control port must block production loopback calls');
    assert.equal(await controls.evaluate(() => window.appModeControls.action('reload')), false);
    for (const factor of [1, 1.25]) for (const width of [1280, 900, 680, 640, 620, 481, 480, 390, 1280]) {
      await app.evaluate(({ BrowserWindow }, { width, factor }) => {
        const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(width, 700);
        win.contentView.children[0].webContents.setZoomFactor(factor);
      }, { width, factor });
      await expect.poll(() => controls.locator('.titlebar').evaluate(e => e.getBoundingClientRect().width)).toBe(width);
      const geometry = await app.evaluate(({ BrowserWindow }) => {
        const views = BrowserWindow.getAllWindows()[0].contentView.children;
        return { remote: views[0].getBounds(), caption: views[1].getBounds(), zoom: views[1].webContents.getZoomFactor() };
      });
      assert.equal(geometry.remote.y, 40); assert.equal(geometry.caption.height, 40); assert.equal(geometry.zoom, 1);
      assert.equal(await controls.locator('[data-action="minimize"]').evaluate(e => e.getBoundingClientRect().width), 32);
    }
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.insertCSS = async () => { throw Error('synthetic'); };
    });
    await page.reload();
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'ready');
    assert.equal(await page.locator('main').innerText(), 'Usable unsupported native content');
    await expect(controls.getByRole('button', { name: 'Reload', exact: true })).toBeHidden();
    await app.evaluate(({ BrowserWindow }) => {
      const remote = BrowserWindow.getAllWindows()[0].contentView.children[0].webContents;
      remote.emit('did-fail-load', {}, -105, 'synthetic', remote.getURL(), false);
      remote.emit('did-fail-load', {}, -105, 'synthetic', 'https://chatgpt.com/stale-document', true);
    });
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'ready');
    // A failed top-level load has no usable native document to uncover.
    await app.evaluate(async ({ session, BrowserWindow }) => {
      await session.defaultSession.protocol.unhandle('https');
      session.defaultSession.protocol.handle('https', () => Response.error());
      BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.reload();
    });
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'recovery');
    await expect(controls.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
    await app.evaluate(async ({ session }) => {
      await session.defaultSession.protocol.unhandle('https');
      session.defaultSession.protocol.handle('https', () => new Response('<!doctype html><main>Recovered native content</main>', { headers: { 'content-type': 'text/html' } }));
    });
    await controls.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'ready');
  } finally { await app.close(); }
});

test('stalled initialization reaches bounded recovery with usable native content', { timeout: 30000 }, async () => {
  const { app, controls } = await launch(delayed);
  try {
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'loading');
    const start = Date.now();
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'ready', { timeout: 17000 });
    assert.ok(Date.now() - start < 16500);
  } finally { await app.close(); }
});
