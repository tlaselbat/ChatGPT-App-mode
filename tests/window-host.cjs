const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const { _electron } = require('playwright');
const { isChatGptUrl, isLoginUrl, isExternalUrl, hostProfile, isTrustedPermission,
  allowControlOriginInCsp, singleFlight, canApplyDocumentResult, tryCreateWindow } = require('../WindowHost/policy.cjs');
const root = path.resolve(__dirname, '..');

function linkRuntime(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (entry.isDirectory()) linkRuntime(from, to); else fs.linkSync(from, to);
  }
}

test('host URL policy rejects lookalikes, privileged schemes and embedded credentials', () => {
  for (const url of ['https://chatgpt.com/', 'https://chat.openai.com/c/synthetic']) assert.equal(isChatGptUrl(url), true);
  for (const url of ['http://chatgpt.com/', 'https://chatgpt.com.evil.test/', 'https://chatgpt.com:444/', 'https://user@chatgpt.com/', 'file:///C:/synthetic', 'javascript:alert(1)', 'data:text/html,synthetic']) {
    assert.equal(isChatGptUrl(url), false, url);
  }
  assert.equal(isLoginUrl('https://accounts.google.com/'), true);
  assert.equal(isLoginUrl('https://accounts.google.com.evil.test/'), false);
  assert.equal(isExternalUrl('file:///C:/synthetic'), false);
  assert.equal(isExternalUrl('https://example.com/'), true);
  assert.equal(hostProfile(root), path.join(root, 'Browser', 'AppModeHostProfile'));
  assert.equal(isTrustedPermission('https://chatgpt.com/', { requestingUrl: 'https://evil.test/' }), false);
  assert.equal(isTrustedPermission('https://chatgpt.com/', {}), false);
  assert.equal(isTrustedPermission('https://chatgpt.com/', { requestingUrl: 'https://chatgpt.com/', isMainFrame: false }), false);
  assert.equal(isTrustedPermission('https://chatgpt.com/', { requestingUrl: 'https://chatgpt.com/', isMainFrame: true }), true);
});

test('host policy preserves CSP fallback semantics and lifecycle guards', async () => {
  const control = 'http://127.0.0.1:17863';
  assert.equal(allowControlOriginInCsp("default-src 'self' https://api.example", control),
    "default-src 'self' https://api.example; connect-src 'self' https://api.example http://127.0.0.1:17863");
  assert.equal(allowControlOriginInCsp("default-src 'none'", control), `default-src 'none'; connect-src ${control}`);
  assert.equal(allowControlOriginInCsp("connect-src 'none'; img-src https:", control),
    ` connect-src ${control}; img-src https:`);
  assert.equal(allowControlOriginInCsp("connect-src 'none' https://api.example", control),
    ` connect-src https://api.example ${control}`);
  assert.equal(allowControlOriginInCsp("script-src 'self'", control), "script-src 'self'");
  assert.deepEqual(["default-src 'self'", "connect-src 'none'"].map(policy => allowControlOriginInCsp(policy, control)), [
    `default-src 'self'; connect-src 'self' ${control}`, ` connect-src ${control}`,
  ]);
  assert.equal(allowControlOriginInCsp("default-src 'self', connect-src 'none'", control),
    `default-src 'self'; connect-src 'self' ${control}, connect-src ${control}`);

  let release;
  const started = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const poll = singleFlight(async () => { calls++; await started; });
  const first = poll();
  assert.equal(await poll(), false);
  release();
  assert.equal(await first, true);
  assert.equal(await poll(), true);
  assert.equal(calls, 2);
  assert.equal(canApplyDocumentResult({ response: 1, contentsAlive: true, requestedGeneration: 4, currentGeneration: 4, trusted: true }), true);
  assert.equal(canApplyDocumentResult({ response: 1, contentsAlive: true, requestedGeneration: 4, currentGeneration: 5, trusted: true }), false);
  assert.equal(tryCreateWindow(() => { throw new Error('synthetic invalid config'); }, []), false);
});

test('native host preserves default-src sources while allowing the loopback control origin', { timeout: 30000 }, async () => {
  const runs = path.join(root, 'test-results', 'runs'); fs.mkdirSync(runs, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(runs, 'native-host-csp-'));
  fs.writeFileSync(path.join(scratch, 'config.json'), JSON.stringify({
    installRoot: scratch, url: 'https://chatgpt.com/c/synthetic-csp',
    window: { width: 800, height: 600 }, rememberWindowPlacement: false,
  }));
  linkRuntime(path.join(root, 'node_modules/electron/dist'), path.join(scratch, 'node_modules/electron/dist'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const server = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'Start-ChatGPT-TopMostServer.ps1'),
    '-AppRoot', scratch, '-Port', String(port)], { windowsHide: true, stdio: 'ignore' });
  const fixture = path.join(scratch, 'fixture.html');
  fs.writeFileSync(fixture, '<!doctype html><title>Synthetic CSP fixture</title><body>fixture</body>');
  let electron;
  try {
    const env = { ...process.env, APP_MODE_HOST_FIXTURE: '1', APP_MODE_HOST_TEST_PORT: String(port) };
    delete env.ELECTRON_RUN_AS_NODE;
    electron = await _electron.launch({
      executablePath: path.join(scratch, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [path.join(root, 'WindowHost', 'main.cjs'), `--app-mode-root=${scratch}`,
        `--user-data-dir=${hostProfile(scratch)}`, `--fixture=${fixture}`, "--fixture-csp=default-src 'self'"],
      env, timeout: 25000,
    });
    const page = await electron.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const response = await page.reload();
    assert.equal(response.headers()['content-security-policy'], `default-src 'self'; connect-src 'self' http://127.0.0.1:${port}`);
    await page.bringToFront();
    const binding = await electron.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return { handle: win.getNativeWindowHandle().readUInt32LE(0), processId: process.pid };
    });
    const result = await page.evaluate(async ({ testPort, handle, processId }) => Promise.all([
      fetch('https://chatgpt.com/csp-self').then(response => response.ok),
      fetch(`http://127.0.0.1:${testPort}/topmost`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: `action=status&handle=${handle}&processId=${processId}`,
      }).then(response => response.ok),
    ]), { testPort: port, ...binding });
    assert.deepEqual(result, [true, true]);
  } finally {
    if (electron) await electron.close().catch(() => {});
    server.kill();
  }
});

test('native header host preserves sandbox, overlay, window actions, navigation and resizing', { timeout: 90000 }, async () => {
  const runs = path.join(root, 'test-results', 'runs'); fs.mkdirSync(runs, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(runs, 'native-host-'));
  const config = {
    installRoot: scratch, url: 'https://chatgpt.com/c/synthetic-host',
    appProfileDir: path.join(scratch, 'Browser', 'ChromiumProfileNeverOpened'),
    chromiumPortableRoot: path.join(scratch, 'Browser', 'ChromiumPortable'),
    privacy: { showChatTitles: false }, rememberWindowPlacement: false,
    window: { width: 1000, height: 700 },
  };
  fs.writeFileSync(path.join(scratch, 'config.json'), JSON.stringify(config));
  // Independent directory tree; hard-linked runtime files avoid a large copy
  // while preserving the exact executable path used by ownership checks.
  linkRuntime(path.join(root, 'node_modules/electron/dist'), path.join(scratch, 'node_modules/electron/dist'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const server = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'Start-ChatGPT-TopMostServer.ps1'),
    '-AppRoot', scratch, '-Port', String(port)], { windowsHide: true, stdio: 'ignore' });
  for (let i = 0; i < 100; ++i) {
    try { await fetch(`http://127.0.0.1:${port}/topmost`, { method: 'POST', headers: { Origin: 'https://chatgpt.com', 'Content-Type': 'text/plain' }, body: 'action=status' }); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  const fixture = path.join(scratch, 'fixture.html');
  fs.writeFileSync(fixture, `<!doctype html><html style="color-scheme:dark"><head><title>Synthetic header fixture</title>
    <style>*{box-sizing:border-box}body{margin:0;color:#cdd6f4;background:#1e1e2e;font:14px system-ui}header{display:flex;align-items:center;gap:8px;height:48px}.title{margin-right:auto}main>p{margin:40px}button{color:inherit}</style></head>
    <body><main><header><span class="title">Synthetic ChatGPT fixture</span><button aria-label="Share">Share</button></header><p>Offline native header review. No account or conversation data.</p></main></body></html>`);
  let electron;
  try {
    const env = { ...process.env, APP_MODE_HOST_FIXTURE: '1', APP_MODE_HOST_TEST_PORT: String(port) };
    delete env.ELECTRON_RUN_AS_NODE;
    electron = await _electron.launch({
      executablePath: path.join(scratch, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [path.join(root, 'WindowHost', 'main.cjs'), `--app-mode-root=${scratch}`,
        `--user-data-dir=${hostProfile(scratch)}`, `--fixture=${fixture}`, "--fixture-csp=default-src 'self'; style-src 'unsafe-inline'"],
      env,
      timeout: 25000,
    });
    const page = await electron.firstWindow();
    await page.waitForSelector('#chatgpt-app-mode-pin-toggle');
    await page.bringToFront();
    const settings = await electron.evaluate(({ BrowserWindow, app }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const prefs = win.webContents.getLastWebPreferences();
      return { profile: app.getPath('userData'), sandbox: prefs.sandbox,
        contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration,
        resizable: win.isResizable(), bounds: win.getBounds(), pid: process.pid,
        handle: win.getNativeWindowHandle().readUInt32LE(0) };
    });
    assert.equal(settings.profile, hostProfile(scratch));
    assert.equal(settings.sandbox, true); assert.equal(settings.contextIsolation, true);
    assert.equal(settings.nodeIntegration, false); assert.equal(settings.resizable, true);
    assert.equal(fs.existsSync(config.appProfileDir), false);
    assert.equal(await page.evaluate(() => typeof require), 'undefined');
    assert.equal(await page.evaluate(() => navigator.windowControlsOverlay.visible), true);
    assert.equal(await page.locator('header').evaluate(el => getComputedStyle(el).webkitAppRegion), 'drag');
    assert.equal(await page.locator('[aria-label="Share"]').evaluate(el => getComputedStyle(el).webkitAppRegion), 'no-drag');
    const geometry = await page.evaluate(() => {
      const overlay = navigator.windowControlsOverlay.getTitlebarAreaRect();
      const pin = document.getElementById('chatgpt-app-mode-pin-toggle').getBoundingClientRect();
      return { right: pin.right, safeRight: overlay.right, y: pin.y };
    });
    assert.ok(geometry.right <= geometry.safeRight, JSON.stringify(geometry));
    const native = async mode => {
      const wasPinned = await electron.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0]; const pinned = win.isAlwaysOnTop();
        win.setAlwaysOnTop(true); win.moveTop(); win.focus(); win.webContents.focus(); return pinned;
      });
      await page.waitForTimeout(150);
      const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(root, 'tests', 'WindowHost.Native.ps1'), '-Handle', String(settings.handle), '-OwnerId', String(settings.pid),
        '-Mode', mode, '-Scratch', scratch], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
      await electron.evaluate(({ BrowserWindow }, pinned) => {
        const win = BrowserWindow.getAllWindows()[0]; if (win) win.setAlwaysOnTop(pinned);
      }, wasPinned).catch(() => {});
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    await native('Activate');
    await page.locator('#chatgpt-app-mode-pin-toggle').click();
    await page.waitForFunction(() => document.getElementById('chatgpt-app-mode-pin-toggle')?.getAttribute('aria-pressed') === 'true', null, { timeout: 7000 }).catch(async error => {
      throw new Error(`${error.message}; pin status: ${await page.locator('#chatgpt-app-mode-pin-toggle').getAttribute('title')}`);
    });
    await page.locator('#chatgpt-app-mode-pin-toggle').click();
    await page.waitForFunction(() => document.getElementById('chatgpt-app-mode-pin-toggle')?.getAttribute('aria-pressed') === 'false');
    // Keyboard and wheel events must reach the native host after removing its
    // application menu, without requiring a renderer-to-main IPC bridge.
    const getZoom = () => electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
    const basePixelRatio = await page.evaluate(() => devicePixelRatio);
    await electron.evaluate(({ BrowserWindow }) => {
      globalThis.syntheticHostInputs = [];
      BrowserWindow.getAllWindows()[0].webContents.on('before-input-event', (_event, input) => {
        globalThis.syntheticHostInputs.push({ key: input.key, code: input.code, control: input.control, type: input.type });
      });
    });
    await native('ZoomIn');
    await page.waitForFunction(ratio => devicePixelRatio > ratio, basePixelRatio);
    assert.ok(await getZoom() > 1, 'Ctrl+wheel up must zoom in');
    assert.ok(await page.evaluate(() => devicePixelRatio) > basePixelRatio, 'Zoom must scale the rendered page');
    const zoomedIn = await getZoom();
    await native('ZoomOut');
    await page.waitForFunction(zoom => devicePixelRatio < zoom, zoomedIn);
    assert.ok(await getZoom() < zoomedIn, 'Ctrl+wheel down must zoom out');
    await native('ZoomKeyIn');
    assert.ok(await getZoom() > 1, JSON.stringify(await electron.evaluate(() => globalThis.syntheticHostInputs)));
    await native('ZoomReset');
    assert.equal(await getZoom(), 1);
    await electron.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      globalThis.syntheticReloadCounts = { normal: 0, force: 0 };
      const reload = contents.reload.bind(contents), force = contents.reloadIgnoringCache.bind(contents);
      contents.reload = () => { globalThis.syntheticReloadCounts.normal++; reload(); };
      contents.reloadIgnoringCache = () => { globalThis.syntheticReloadCounts.force++; force(); };
    });
    for (const shortcut of ['Reload', 'ForceReload', 'ReloadR', 'ForceReloadR']) {
      await page.evaluate(() => { window.syntheticReloadMarker = true; });
      await Promise.all([page.waitForEvent('load'), native(shortcut)]);
      await page.waitForSelector('#chatgpt-app-mode-pin-toggle');
      assert.equal(await page.evaluate(() => window.syntheticReloadMarker), undefined, shortcut);
    }
    assert.deepEqual(await electron.evaluate(() => globalThis.syntheticReloadCounts), { normal: 2, force: 2 });
    await native('DevTools');
    for (let attempt = 0; attempt < 30; ++attempt) {
      if (await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened())) break;
      await page.waitForTimeout(100);
    }
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened()), true,
      JSON.stringify(await electron.evaluate(() => globalThis.syntheticHostInputs)));
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.closeDevTools());
    await native('Capture');
    await native('Maximize');
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), true);
    await native('Restore');
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), false);
    await native('Drag');
    await native('Resize');
    await native('Minimize');
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), true);
    await electron.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.restore(); win.show(); win.setBounds({ width: 390, height: 700 }); });
    await page.waitForTimeout(250);
    await native('CaptureNarrow');
    assert.equal(await page.locator('#chatgpt-app-mode-pin-toggle').evaluate(el => {
      const pin = el.getBoundingClientRect(); const header = el.closest('header').getBoundingClientRect();
      return pin.bottom <= header.bottom && pin.right <= navigator.windowControlsOverlay.getTitlebarAreaRect().right;
    }), true);
    // Reproduce the home header's centered, fixed-width mode switch. The site
    // may replace this group during navigation; keep its controls functional.
    await page.evaluate(() => {
      document.querySelector('header').innerHTML = `<button aria-label="Sidebar">◧</button>
        <div class="mode-positioner" style="position:absolute;left:50%;transform:translateX(-50%);width:224px">
          <div role="tablist"><button role="tab" aria-selected="true">Chat</button><button role="tab" aria-selected="false">Work</button></div>
        </div><button aria-label="Refresh" style="margin-left:auto">↻</button>`;
      document.querySelector('[role="tablist"]').addEventListener('click', event => {
        const tab = event.target.closest('[role="tab"]'); if (!tab) return;
        for (const button of tab.parentElement.children) button.setAttribute('aria-selected', String(button === tab));
      });
    });
    await page.waitForSelector('[data-app-mode-header-tabs]');
    for (const width of [690, 448, 390, 1024]) {
      const expectedWidth = await electron.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setBounds({ width, height: 700 });
        return win.getContentBounds().width / win.webContents.getZoomFactor();
      }, width);
      await page.waitForFunction(expected => {
        const area = navigator.windowControlsOverlay.getTitlebarAreaRect();
        return Math.abs(innerWidth - expected) <= 1 && area.width > 0 && area.right <= innerWidth + 1;
      }, expectedWidth);
      const layout = await page.evaluate(() => {
        const header = document.querySelector('header').getBoundingClientRect();
        const rects = [...document.querySelectorAll('header button')].map(el => el.getBoundingClientRect());
        const safe = navigator.windowControlsOverlay.getTitlebarAreaRect();
        return {
          height: header.height,
          bounded: rects.every(r => r.left >= header.left && r.right <= safe.right && r.top >= header.top && r.bottom <= header.bottom),
          overlaps: rects.some((a, i) => rects.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.deepEqual(layout, { height: 48, bounded: true, overlaps: false, overflow: false }, `header width ${width}: ${JSON.stringify(layout)}`);
      await page.locator('[role="tab"]').nth(1).click();
      assert.equal(await page.locator('[role="tab"]').nth(1).getAttribute('aria-selected'), 'true');
      await page.mouse.move(20, 100);
      assert.equal(await page.locator('[role="tablist"]').evaluate(el =>
        getComputedStyle(el.children[0]).backgroundColor !== getComputedStyle(el.children[1]).backgroundColor), true);
      await page.screenshot({ path: path.join(scratch, `header-layout-${width}.png`) });
      if (width === 690 || width === 448) {
        await native('Capture');
        fs.copyFileSync(path.join(scratch, 'native-header-desktop.png'), path.join(scratch, `header-native-${width}.png`));
      }
    }
    // A site variant without ARIA tab roles must normalize its absolute
    // wrapper without oscillating back to centered positioning on mutations.
    await page.evaluate(() => {
      const old = document.querySelector('.mode-positioner');
      const replacement = document.createElement('div');
      replacement.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);width:224px';
      replacement.innerHTML = '<div style="display:flex"><button>Chat</button><button>Work</button></div>';
      old.replaceWith(replacement);
    });
    await page.waitForSelector('[data-app-mode-header-tabs]');
    await page.evaluate(() => document.querySelector('header').classList.toggle('synthetic-rerender'));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-app-mode-header-tabs]').count(), 1);
    assert.equal(await page.locator('[data-app-mode-header-tabs]').evaluate(el => getComputedStyle(el.parentElement).position), 'static');
    await page.evaluate(html => { document.querySelector('header').innerHTML = html; }, fs.readFileSync(path.join(__dirname, 'fixtures/fixed-layer-header.html'),'utf8'));
    await page.waitForSelector('.real-mode-grid[data-app-mode-header-tabs]');
    for (const zoom of [1,1.25]) for (const width of [390,489,690]) {
      const expectedWidth = await electron.evaluate(({BrowserWindow},{zoom,width}) => {
        const win=BrowserWindow.getAllWindows()[0]; win.setBounds({width,height:700}); win.webContents.setZoomFactor(zoom);
        return win.getContentBounds().width / zoom;
      },{zoom,width});
      await page.waitForFunction(expected => {
        const area = navigator.windowControlsOverlay.getTitlebarAreaRect();
        return Math.abs(innerWidth - expected) <= 1 && area.width > 0 && area.right <= innerWidth + 1 && Math.abs(area.height - 48) <= 1;
      }, expectedWidth, { timeout: 5000 });
      const layout=await page.evaluate(() => {
        const header=document.querySelector('header').getBoundingClientRect();
        const safe=navigator.windowControlsOverlay.getTitlebarAreaRect();
        const controls=[...document.querySelectorAll('header button')].filter(el=>!el.closest('[aria-hidden="true"]')).map(el=>el.getBoundingClientRect());
        return {groups:document.querySelectorAll('[data-app-mode-header-tabs]').length,
          bounded:controls.every(r=>r.left>=0 && r.right<=safe.right+1 && r.top>=0 && r.bottom<=header.bottom+1),
          overlap:controls.some((a,i)=>controls.slice(i+1).some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)),
          minimum:Math.min(...controls.map(r=>r.width))};
      });
      assert.equal(layout.groups,1); assert.equal(layout.bounded,true,JSON.stringify({zoom,width,layout}));
      assert.equal(layout.overlap,false,JSON.stringify({zoom,width,layout})); assert.ok(layout.minimum>=24);
    }
    await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await page.evaluate(() => { const h = document.querySelector('header'); h.replaceWith(h.cloneNode(true)); history.pushState({}, '', '/c/synthetic-rerender'); });
    await page.waitForSelector('header #chatgpt-app-mode-pin-toggle');
    assert.equal(await page.locator('#chatgpt-app-mode-pin-toggle').count(), 1);
    assert.equal(await page.locator('header').evaluate(el => getComputedStyle(el).webkitAppRegion), 'drag');
    await electron.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.executeJavaScript("location.href='file:///C:/synthetic-blocked'");
    });
    await page.waitForTimeout(250);
    assert.ok(isChatGptUrl(page.url()));
    await native('Close');
    await electron.process().exitCode;
    console.log(`Native host screenshots: ${scratch}`);
  } finally {
    if (electron) await electron.close().catch(() => {});
    server.kill();
  }
});
