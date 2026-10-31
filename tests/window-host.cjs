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

async function remoteWindow(electron, excluded) {
  // Playwright reports WebContentsViews as pages too; explicitly select the
  // synthetic ChatGPT renderer instead of racing the local controls document.
  for(let attempt=0;attempt<100;attempt++) {
    const page=electron.windows().find(page=>page!==excluded && isChatGptUrl(page.url()));
    if(page)return page;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('Synthetic remote fixture window missing');
}

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
    const page = await remoteWindow(electron);
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
    // Exercise the real renderer and OS clipboard without reading its prior contents.
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.id = 'synthetic-copy';
      button.textContent = 'Copy';
      button.onclick = () => { window.copyResult = navigator.clipboard.writeText('App Mode synthetic clipboard test').then(() => 'ok', error => error.name); };
      document.body.append(button);
    });
    await page.locator('#synthetic-copy').click();
    assert.equal(await page.evaluate(() => window.copyResult), 'ok');
    assert.equal(await electron.evaluate(({ clipboard }) => clipboard.readText()), 'App Mode synthetic clipboard test');
    assert.notEqual(await page.evaluate(async () => (await navigator.permissions.query({ name: 'clipboard-read' })).state), 'granted');
    const untrusted = await electron.evaluate(async ({ BrowserWindow }) => {
      const session = BrowserWindow.getAllWindows()[0].webContents.session;
      const win = new BrowserWindow({ show: false, webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await win.loadURL('https://evil.test/');
      try {
        return await win.webContents.executeJavaScript("navigator.clipboard.writeText('untrusted').then(() => 'ok', error => error.name)", true);
      } finally { win.destroy(); }
    });
    assert.notEqual(untrusted, 'ok', 'Untrusted origins must not write to the clipboard');
  } finally {
    if (electron) await electron.close().catch(() => {});
    server.kill();
  }
});

test('native header host preserves sandbox, custom controls, window actions, navigation and resizing', { timeout: 180000 }, async () => {
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
    const page = await remoteWindow(electron);
    await page.waitForSelector('#chatgpt-app-mode-pin-toggle');
    // The remote page runs in its own WebContentsView below the app-owned
    // title bar; win.webContents is the unused placeholder. Select the child
    // view whose document is the synthetic ChatGPT fixture.
    const chatScript = 'win.contentView.children.find(child=>child.webContents?.getURL().startsWith("https://chatgpt.com")).webContents';
    const controlsEval = script => electron.evaluate(async ({ BrowserWindow }, script) => {
      const view = BrowserWindow.getAllWindows()[0].contentView.children.find(child => child.webContents?.getURL().endsWith('/controls.html'));
      if (!view) throw new Error('Trusted controls view missing');
      return view.webContents.executeJavaScript(script);
    }, script);
    const waitControlLabel = async label => {
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await controlsEval('document.querySelector("[data-action=maximize]").getAttribute("aria-label")') === label) return;
        await page.waitForTimeout(50);
      }
      assert.fail(`Window controls did not synchronize ${label}`);
    };
    await page.bringToFront();
    const settings = await electron.evaluate(({ BrowserWindow, app }, chatScript) => {
      const win = BrowserWindow.getAllWindows()[0];
      const prefs = eval(chatScript).getLastWebPreferences();
      return { profile: app.getPath('userData'), sandbox: prefs.sandbox,
        contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration,
        preload: prefs.preload,
        resizable: win.isResizable(), bounds: win.getBounds(), pid: process.pid,
        handle: win.getNativeWindowHandle().readUInt32LE(0) };
    }, chatScript);
    assert.equal(settings.profile, hostProfile(scratch));
    assert.equal(settings.sandbox, true); assert.equal(settings.contextIsolation, true);
    assert.equal(settings.nodeIntegration, false); assert.equal(settings.resizable, true);
    assert.equal(settings.preload, undefined);
    assert.equal(fs.existsSync(config.appProfileDir), false);
    assert.equal(await page.evaluate(() => typeof require), 'undefined');
    assert.equal(await page.evaluate(() => typeof window.appModeControls), 'undefined');
    assert.equal(await controlsEval('typeof require'), 'undefined');
    assert.deepEqual(await controlsEval(`Array.from(document.querySelectorAll('button')).map(button => {
      const rect=button.getBoundingClientRect(), style=getComputedStyle(button);
      return {width:rect.width,height:rect.height,center:rect.y+rect.height/2,radius:style.borderRadius,drag:style.webkitAppRegion};
    })`), Array(3).fill({width:32,height:28,center:24,radius:'8px',drag:'no-drag'}));
    await waitControlLabel('Maximize');
    assert.equal(await controlsEval('getComputedStyle(document.querySelector("[data-action=close]")).borderTopColor'), 'rgb(239, 68, 68)');
    const security = await electron.evaluate(({ BrowserWindow }, modulePath) => {
      const {validateControlRequest}=process.mainModule.require(modulePath);
      const win=BrowserWindow.getAllWindows()[0];
      const view=win.contentView.children.find(child=>child.webContents?.getURL().endsWith('/controls.html'));
      const contents=view.webContents;
      const context={win,view,controlsUrl:contents.getURL()};
      const event={sender:contents,senderFrame:contents.mainFrame};
      const prefs=contents.getLastWebPreferences();
      const results={sandbox:prefs.sandbox,contextIsolation:prefs.contextIsolation,nodeIntegration:prefs.nodeIntegration,
        accepted:['minimize','maximize','restore','close'].every(action=>validateControlRequest(event,[action],context)),
        malformed:[[],['unknown'],[null],[{}],[1],['close','extra'],[['close']]].every(args=>!validateControlRequest(event,args,context)),
        remoteRejected:!validateControlRequest({sender:win.webContents,senderFrame:win.webContents.mainFrame},['close'],context),
        subframeRejected:!validateControlRequest({...event,senderFrame:{url:contents.getURL()}},['close'],context),
        staleUrlRejected:!validateControlRequest(event,['close'],{...context,controlsUrl:contents.getURL()+'#untrusted'}),
        destroyedWindowRejected:!validateControlRequest(event,['close'],{...context,win:{isDestroyed:()=>true}}),
        destroyedContentsRejected:!validateControlRequest(event,['close'],{...context,view:{webContents:{isDestroyed:()=>true}}}),
        detachedRejected:false};
      win.contentView.removeChildView(view);
      results.detachedRejected=!validateControlRequest(event,['close'],context);
      win.contentView.addChildView(view);
      return results;
    },path.join(root,'WindowHost','controls-host.cjs'));
    assert.deepEqual(security,{sandbox:true,contextIsolation:true,nodeIntegration:false,accepted:true,malformed:true,
      remoteRejected:true,subframeRejected:true,staleUrlRejected:true,destroyedWindowRejected:true,destroyedContentsRejected:true,detachedRejected:true});
    assert.deepEqual(await controlsEval(`Promise.all([window.appModeControls.action(),window.appModeControls.action('unknown'),
      window.appModeControls.action({action:'close'}),window.appModeControls.action('close','extra')])`),[false,false,false,false]);
    const originalControlsUrl=await controlsEval('location.href');
    await controlsEval("location.href='https://example.invalid/untrusted'");
    await page.waitForTimeout(150);
    assert.equal(await controlsEval('location.href'),originalControlsUrl,'Trusted controls must block remote navigation');
    assert.equal(await controlsEval("window.appModeControls.action('restore')"),true,'Blocked navigation must leave trusted controls functional');
    assert.equal(await page.evaluate(() => navigator.windowControlsOverlay?.visible || false), false);
    // The drag region lives in the app-owned title bar view above the page;
    // the site header itself is an ordinary no-drag action row.
    assert.equal(await page.locator('header').evaluate(el => getComputedStyle(el).webkitAppRegion), 'no-drag');
    assert.equal(await controlsEval('getComputedStyle(document.querySelector(".titlebar")).webkitAppRegion'), 'drag');
    assert.equal(await page.locator('[aria-label="Share"]').evaluate(el => getComputedStyle(el).webkitAppRegion), 'no-drag');
    const geometry = await page.evaluate(() => {
      const pin = document.getElementById('chatgpt-app-mode-pin-toggle').getBoundingClientRect();
      return { right: pin.right, safeRight: innerWidth, y: pin.y };
    });
    assert.ok(geometry.right <= geometry.safeRight, JSON.stringify(geometry));
    const native = async (mode, focusRemote=true) => {
      const wasPinned = await electron.evaluate(({ BrowserWindow }, focusRemote) => {
        const win = BrowserWindow.getAllWindows()[0]; const pinned = win.isAlwaysOnTop();
        // Injection may finish before ready-to-show; explicitly display only
        // this isolated fixture before sending any guarded desktop input.
        const chat=win.contentView.children.find(child=>child.webContents?.getURL().startsWith('https://chatgpt.com'))?.webContents;
        win.show();win.setAlwaysOnTop(true); win.moveTop(); win.focus(); if(focusRemote)chat?.focus(); return pinned;
      }, focusRemote);
      await page.waitForTimeout(150);
      const coordinates = ['Maximize','Restore','Minimize','Close','HoverMaximize'].includes(mode) ? await electron.evaluate(async ({BrowserWindow,screen},mode)=>{
        const win=BrowserWindow.getAllWindows()[0], content=win.getContentBounds();
        const view=win.contentView.children.find(child=>child.webContents?.getURL().endsWith('/controls.html'));
        const action=mode==='Restore'||mode==='HoverMaximize'?'maximize':mode.toLowerCase();
        const center=await view.webContents.executeJavaScript(`(()=>{const r=document.querySelector('[data-action="${action}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        const bounds=view.getBounds(),zoom=view.webContents.getZoomFactor();
        return screen.dipToScreenPoint({x:Math.round(content.x+bounds.x+center.x*zoom),y:Math.round(content.y+bounds.y+center.y*zoom)});
      },mode):null;
      const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(root, 'tests', 'WindowHost.Native.ps1'), '-Handle', String(settings.handle), '-OwnerId', String(settings.pid),
        '-Mode', mode, '-Scratch', scratch,...(coordinates?['-ControlX',String(coordinates.x),'-ControlY',String(coordinates.y)]:[])], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
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
    const getZoom = () => electron.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.contentView.children.find(child=>child.webContents?.getURL().startsWith('https://chatgpt.com')).webContents.getZoomFactor();
    });
    const basePixelRatio = await page.evaluate(() => devicePixelRatio);
    await electron.evaluate(({ BrowserWindow }) => {
      globalThis.syntheticHostInputs = [];
      const chat = BrowserWindow.getAllWindows()[0].contentView.children
        .find(child=>child.webContents?.getURL().startsWith('https://chatgpt.com')).webContents;
      chat.on('before-input-event', (_event, input) => {
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
      const contents = BrowserWindow.getAllWindows()[0].contentView.children
        .find(child=>child.webContents?.getURL().startsWith('https://chatgpt.com')).webContents;
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
    const chatEval = script => electron.evaluate(({ BrowserWindow }, script) => {
      const chat = BrowserWindow.getAllWindows()[0].contentView.children
        .find(child=>child.webContents?.getURL().startsWith('https://chatgpt.com')).webContents;
      return eval(script);
    }, script);
    await native('DevTools');
    for (let attempt = 0; attempt < 30; ++attempt) {
      if (await chatEval('chat.isDevToolsOpened()')) break;
      await page.waitForTimeout(100);
    }
    assert.equal(await chatEval('chat.isDevToolsOpened()'), true,
      JSON.stringify(await electron.evaluate(() => globalThis.syntheticHostInputs)));
    await chatEval('chat.closeDevTools()');
    await native('Capture');
    await native('Maximize');
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), true);
    await waitControlLabel('Restore');
    await native('Capture');
    fs.copyFileSync(path.join(scratch, 'native-header-desktop.png'), path.join(scratch, 'header-maximized.png'));
    await native('Restore');
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), false);
    assert.equal(await chatEval('chat.isFocused()'),true);
    await waitControlLabel('Maximize');
    await native('DoubleClickTitlebar');
    assert.equal(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized()),true);
    await waitControlLabel('Restore');
    await native('DoubleClickTitlebar');
    assert.equal(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized()),false);
    await waitControlLabel('Maximize');
    // State follows native events even when controls did not initiate them.
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    await waitControlLabel('Restore');
    assert.equal(await controlsEval('getComputedStyle(document.querySelector(".restore-icon")).display'), 'block');
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
    await waitControlLabel('Maximize');
    assert.equal(await controlsEval('getComputedStyle(document.querySelector(".maximize-icon")).display'), 'block');
    await native('Capture');
    fs.copyFileSync(path.join(scratch, 'native-header-desktop.png'), path.join(scratch, 'header-restored-dark.png'));
    await native('HoverMaximize');
    assert.equal(await controlsEval('document.querySelector("[data-action=maximize]").matches(":hover")'),true);
    await native('Capture');
    fs.copyFileSync(path.join(scratch, 'native-header-desktop.png'), path.join(scratch, 'header-hover.png'));
    const hoverFill=await controlsEval('getComputedStyle(document.querySelector("[data-action=maximize]")).backgroundColor');
    await electron.evaluate(async ({BrowserWindow})=>{
      const contents=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.webContents?.getURL().endsWith('/controls.html')).webContents;
      const point=await contents.executeJavaScript('(()=>{const r=document.querySelector("[data-action=maximize]").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
      contents.sendInputEvent({type:'mouseMove',...point});contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    });
    try {
      await page.waitForTimeout(180);
      assert.equal(await controlsEval('document.querySelector("[data-action=maximize]").matches(":active")'),true);
      assert.notEqual(await controlsEval('getComputedStyle(document.querySelector("[data-action=maximize]")).backgroundColor'),hoverFill);
      await native('Capture',false);
      fs.copyFileSync(path.join(scratch, 'native-header-desktop.png'), path.join(scratch, 'header-pressed.png'));
    } finally {
      await electron.evaluate(({BrowserWindow})=>{
        const contents=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.webContents?.getURL().endsWith('/controls.html')).webContents;
        contents.sendInputEvent({type:'mouseMove',x:1,y:1});contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:1,y:1});
      });
    }
    await electron.evaluate(({BrowserWindow})=>{
      const contents=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.webContents?.getURL().endsWith('/controls.html')).webContents;
      contents.focus();
      contents.sendInputEvent({type:'keyDown',keyCode:'Tab'});contents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
    });
    await page.waitForTimeout(100);
    assert.equal(await controlsEval('document.activeElement.matches("button:focus-visible")'),true);
    await native('Capture',false);
    fs.copyFileSync(path.join(scratch, 'native-header-desktop.png'), path.join(scratch, 'header-keyboard-focus.png'));
    await page.evaluate(()=>{
      document.documentElement.style.colorScheme='light';
      document.body.style.color='#202123';document.body.style.backgroundColor='#ffffff';
      document.body.style.setProperty('--app-mode-control-color','#202123');
      document.body.style.setProperty('--app-mode-control-border','rgba(32,33,35,.24)');
      document.body.style.setProperty('--app-mode-control-bg','rgba(32,33,35,.06)');
      document.body.style.setProperty('--app-mode-control-hover','rgba(32,33,35,.12)');
    });
    for(let attempt=0;attempt<50;attempt++) {
      if(await controlsEval('getComputedStyle(document.querySelector("button")).color')==='rgb(32, 33, 35)')break;
      await page.waitForTimeout(50);
    }
    assert.equal(await controlsEval('getComputedStyle(document.querySelector("button")).color'),'rgb(32, 33, 35)');
    await native('Capture');
    fs.copyFileSync(path.join(scratch, 'native-header-desktop.png'), path.join(scratch, 'header-restored-light.png'));
    await page.evaluate(()=>{document.documentElement.style.colorScheme='dark';document.body.removeAttribute('style');});
    await native('Drag');
    await native('Resize');
    await native('Minimize');
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), true);
    await electron.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.restore(); win.show(); win.setBounds({ width: 390, height: 700 }); });
    await page.waitForTimeout(250);
    await native('CaptureNarrow');
    assert.equal(await page.locator('#chatgpt-app-mode-pin-toggle').evaluate(el => {
      const pin = el.getBoundingClientRect(); const header = el.closest('header').getBoundingClientRect();
      return pin.bottom <= header.bottom + 1 && pin.right <= innerWidth;
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
    for (const width of [690, 560, 448, 390, 1024, 1280]) {
      const expectedWidth = await electron.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setBounds({ width, height: 700 });
        const chat = win.contentView.children.find(child=>child.webContents?.getURL().startsWith('https://chatgpt.com')).webContents;
        return win.getContentBounds().width / chat.getZoomFactor();
      }, width);
      await page.waitForFunction(expected => {
        return Math.abs(innerWidth - expected) <= 1;
      }, expectedWidth);
      const layout = await page.evaluate(() => {
        const header = document.querySelector('header').getBoundingClientRect();
        const rects = [...document.querySelectorAll('header button')].map(el => el.getBoundingClientRect());
        return {
          height: header.height,
          bounded: rects.every(r => r.left >= header.left && r.right <= innerWidth + 1 && r.top >= header.top - 1 && r.bottom <= header.bottom + 1),
          overlaps: rects.some((a, i) => rects.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.deepEqual(layout, { height: 40, bounded: true, overlaps: false, overflow: false }, `header width ${width}: ${JSON.stringify(layout)}`);
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
    const zoomSamples = [];
    for (const zoom of [1,1.25,1.5]) for (const width of [390,448,560,680,690,1024,1280]) {
      if(width/zoom<390)continue; // Minimum supported logical viewport; zoom does not expand the window.
      const expectedWidth = await electron.evaluate(({BrowserWindow},{zoom,width}) => {
        const win=BrowserWindow.getAllWindows()[0]; win.setBounds({width,height:700});
        win.contentView.children.find(child=>child.webContents?.getURL().startsWith('https://chatgpt.com')).webContents.setZoomFactor(zoom);
        return win.getContentBounds().width / zoom;
      },{zoom,width});
      await page.waitForFunction(expected => {
        return Math.abs(innerWidth - expected) <= 1 && Math.abs(document.querySelector('header').getBoundingClientRect().height - 40) <= 1;
      }, expectedWidth, { timeout: 5000 });
      const layout=await page.evaluate(() => {
        const header=document.querySelector('header').getBoundingClientRect();
        const controls=[...document.querySelectorAll('header button')].filter(el=>!el.closest('[aria-hidden="true"]')).map(el=>el.getBoundingClientRect());
        const tabs=document.querySelector('.real-mode-grid').getBoundingClientRect();
        return {viewportCss:innerWidth,devicePixelRatio,switchCss:{x:tabs.x,y:tabs.y,width:tabs.width,height:tabs.height},
          centerErrorCss:tabs.x+tabs.width/2-innerWidth/2,controlsCss:controls.map(r=>({x:r.x,y:r.y,width:r.width,height:r.height})),
          centering:document.querySelector('header').getAttribute('data-app-mode-header-centering'),
          groups:document.querySelectorAll('[data-app-mode-header-tabs]').length,
          bounded:controls.every(r=>r.left>=0 && r.right<=innerWidth+1 && r.top>=0 && r.bottom<=header.bottom+1),
          overlap:controls.some((a,i)=>controls.slice(i+1).some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)),
          minimum:Math.min(...controls.map(r=>r.width))};
      });
      zoomSamples.push({zoom,windowWidthDip:width,...layout});
      if(layout.centering==='viewport') assert.ok(Math.abs(layout.centerErrorCss)<=2,JSON.stringify({zoom,width,layout}));
      assert.equal(layout.groups,1); assert.equal(layout.bounded,true,JSON.stringify({zoom,width,layout}));
      assert.equal(layout.overlap,false,JSON.stringify({zoom,width,layout})); assert.ok(layout.minimum>=24);
      const surface=await electron.evaluate(({BrowserWindow})=>{
        const win=BrowserWindow.getAllWindows()[0];
        const view=win.contentView.children.find(child=>child.webContents?.getURL().endsWith('/controls.html'));
        const chat=win.contentView.children.find(child=>child.webContents?.getURL().startsWith('https://chatgpt.com'));
        return {bounds:view.getBounds(),chatBounds:chat.getBounds(),zoom:view.webContents.getZoomFactor(),width:win.getContentBounds().width,height:win.getContentBounds().height};
      });
      // The app-owned title bar spans the full window width; the remote page
      // view starts exactly beneath it, so the two surfaces never overlap.
      assert.equal(surface.bounds.x,0);
      assert.equal(surface.bounds.width,surface.width);
      assert.ok(Math.abs(surface.bounds.height-48*zoom)<=1);
      assert.equal(surface.chatBounds.y,surface.bounds.height);
      assert.equal(surface.chatBounds.height,surface.height-surface.bounds.height);
      assert.equal(surface.zoom,zoom,'Controls and header must share a physical centerline at page zoom');
    }
    fs.writeFileSync(path.join(scratch,'header-zoom-geometry.json'),JSON.stringify(zoomSamples,null,2));
    // Conversation headers expose five page actions plus three host actions.
    // Exercise that denser variant separately from the home mode-switch header.
    await page.evaluate(html=>{document.querySelector('header').innerHTML=html;},fs.readFileSync(path.join(__dirname,'fixtures/full-header.html'),'utf8'));
    await page.waitForSelector('header #chatgpt-app-mode-pin-toggle');
    await page.evaluate(() => {
      const leading = document.querySelector('.fixture-leading');
      leading.prepend(leading.querySelector('[aria-label="New chat"]'));
    });
    assert.equal(await page.evaluate(() => {
      const leading = document.querySelector('.fixture-leading');
      return leading.querySelector('[aria-label="Sidebar"]').getBoundingClientRect().left < leading.querySelector('[aria-label="New chat"]').getBoundingClientRect().left;
    }), true, 'Sidebar precedes New chat visually even when the site renders New chat first');
    await page.evaluate(()=>{
      window.syntheticHeaderActions=[];
      for(const button of document.querySelectorAll('.fixture-leading button,.fixture-actions button'))button.addEventListener('click',()=>window.syntheticHeaderActions.push(button.getAttribute('aria-label')));
    });
    for(const zoom of [1,1.25,1.5])for(const width of [390,448,560,690,1024,1280]) {
      if(width/zoom<390)continue;
      await electron.evaluate(({BrowserWindow},{zoom,width})=>{
        const win=BrowserWindow.getAllWindows()[0];win.setBounds({width,height:700});
        win.contentView.children.find(child=>child.webContents?.getURL().startsWith('https://chatgpt.com')).webContents.setZoomFactor(zoom);
      },{zoom,width});
      await page.waitForFunction(expected=>Math.abs(innerWidth-expected)<1,width/zoom);
      const layout=await page.evaluate(()=>{
        const header=document.querySelector('header'),bounds=header.getBoundingClientRect();
        const visible=button=>!button.closest('[aria-hidden="true"],[data-app-mode-relocated-share]')&&button.getClientRects().length;
        const buttons=[...header.querySelectorAll('button')].filter(visible);
        const rects=buttons.map(button=>button.getBoundingClientRect());
        const actions=header.querySelector('[aria-label="More options"]')?.getBoundingClientRect();
        const newChat=header.querySelector('[aria-label="New chat"]')?.getBoundingClientRect();
        const pin=document.getElementById('chatgpt-app-mode-pin-toggle')?.getBoundingClientRect();
        const leadingBox=header.querySelector('.fixture-leading')?.getBoundingClientRect();
        const actionsBox=header.querySelector('.fixture-actions')?.getBoundingClientRect();
        const titleBox=header.querySelector('.fixture-title')?.getBoundingClientRect();
        const titleText=header.querySelector('.fixture-title .title')?.getBoundingClientRect();
        const siteRects=buttons.filter(button=>button.id!=='chatgpt-app-mode-pin-toggle').map(button=>button.getBoundingClientRect());
        return {count:buttons.length,height:bounds.height,aligned:rects.every(rect=>Math.abs(rect.y+rect.height/2-20)<=1),
          bounded:rects.every(rect=>rect.left>=0&&rect.right<=innerWidth+1&&rect.top>=bounds.top-1&&rect.bottom<=bounds.bottom+1),
          overlap:rects.some((a,index)=>rects.slice(index+1).some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top)),
          order:siteRects.every(rect=>rect.right<=(pin?.left??innerWidth)+6),
          actionsRight:actions?actions.right>=bounds.right-(pin?.width??40)-30:true,
          spacersGone:![...header.querySelectorAll('.fixture-sidebar-spacer,.fixture-title-offset')].some(element=>element.getClientRects().length),
          titleBetween:!!titleBox&&!!leadingBox&&!!actionsBox&&titleBox.left>=leadingBox.right-1&&titleBox.right<=actionsBox.left+1,
          titleReadable:!!titleText&&titleText.width>8&&titleText.right<=innerWidth+1,
          overflow:document.documentElement.scrollWidth>innerWidth};
      });
      const diagnostics=layout.actionsRight?null:await page.evaluate(()=>({viewport:innerWidth,headerRight:document.querySelector('header').getBoundingClientRect().right,actionRight:document.querySelector('[aria-label="More options"]').getBoundingClientRect().right,pinWidth:document.getElementById('chatgpt-app-mode-pin-toggle').getBoundingClientRect().width}));
      assert.deepEqual(layout,{count:4,height:40,aligned:true,bounded:true,overlap:false,order:true,actionsRight:true,spacersGone:true,titleBetween:true,titleReadable:true,overflow:false},JSON.stringify({zoom,width,layout,diagnostics}));
      // The relocated Share is intentionally display:none; activate it by
      // dispatch like the in-page handler, click the visible controls normally.
      for(const label of ['Sidebar','New chat','More options','Share'])await page.locator(`header [aria-label="${label}"]`).dispatchEvent('click');
      if(zoom===1) {
        await native('Capture');
        fs.copyFileSync(path.join(scratch,'native-header-desktop.png'),path.join(scratch,`header-full-${width}.png`));
      }
    }
    assert.equal(await page.evaluate(()=>window.syntheticHeaderActions.length),52);
    await chatEval('chat.setZoomFactor(1)');
    await page.evaluate(() => { const h = document.querySelector('header'); h.replaceWith(h.cloneNode(true)); history.pushState({}, '', '/c/synthetic-rerender'); });
    await page.waitForSelector('header #chatgpt-app-mode-pin-toggle');
    assert.equal(await page.locator('#chatgpt-app-mode-pin-toggle').count(), 1);
    assert.equal(await page.locator('header').evaluate(el => getComputedStyle(el).webkitAppRegion), 'no-drag');
    assert.equal(await controlsEval('getComputedStyle(document.querySelector(".titlebar")).webkitAppRegion'), 'drag');
    // Initial maximized state and separate control ownership use a second
    // fixture window in the same process, with no production profile access.
    const originalId=await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].id);
    await electron.evaluate(({app})=>app.emit('second-instance',{},['--start-maximized','--url=https://chatgpt.com/c/synthetic-second']));
    const secondPage=await remoteWindow(electron,page);
    await secondPage.waitForSelector('#chatgpt-app-mode-pin-toggle');
    const secondId=await electron.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().find(win=>win.id!==id).id,originalId);
    assert.equal(await electron.evaluate(({BrowserWindow},{originalId,secondId,modulePath})=>{
      const {validateControlRequest}=process.mainModule.require(modulePath);
      const first=BrowserWindow.fromId(originalId),second=BrowserWindow.fromId(secondId);
      const view=first.contentView.children.find(child=>child.webContents?.getURL().endsWith('/controls.html'));
      return validateControlRequest({sender:view.webContents,senderFrame:view.webContents.mainFrame},['close'],
        {win:second,view,controlsUrl:view.webContents.getURL()});
    },{originalId,secondId,modulePath:path.join(root,'WindowHost','controls-host.cjs')}),false,'A valid controls sender cannot target another window');
    const secondControls=script=>electron.evaluate(({BrowserWindow},{id,script})=>{
      const win=BrowserWindow.fromId(id);
      return win.contentView.children.find(child=>child.webContents?.getURL().endsWith('/controls.html')).webContents.executeJavaScript(script);
    },{id:secondId,script});
    for(let attempt=0;attempt<50;attempt++) {
      if(await secondControls('document.querySelector("[data-action=maximize]").getAttribute("aria-label")')==='Restore')break;
      await secondPage.waitForTimeout(50);
    }
    assert.equal(await secondControls('document.querySelector("[data-action=maximize]").getAttribute("aria-label")'),'Restore');
    assert.equal(await electron.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).isMaximized(),secondId),true);
    await secondControls('document.querySelector("[data-action=maximize]").click()');
    for(let attempt=0;attempt<50;attempt++) {
      if(!await electron.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).isMaximized(),secondId))break;
      await secondPage.waitForTimeout(50);
    }
    assert.deepEqual(await electron.evaluate(({BrowserWindow},{originalId,secondId})=>({
      first:BrowserWindow.fromId(originalId).isMaximized(),second:BrowserWindow.fromId(secondId).isMaximized()
    }),{originalId,secondId}),{first:false,second:false});
    await secondControls('document.querySelector("[data-action=minimize]").click()');
    await secondPage.waitForTimeout(150);
    assert.deepEqual(await electron.evaluate(({BrowserWindow},{originalId,secondId})=>({
      first:BrowserWindow.fromId(originalId).isMinimized(),second:BrowserWindow.fromId(secondId).isMinimized()
    }),{originalId,secondId}),{first:false,second:true});
    const navigationSecurity=await electron.evaluate(async ({BrowserWindow},id)=>{
      const win=BrowserWindow.fromId(id);
      const contents=win.contentView.children.find(child=>child.webContents?.getURL().endsWith('/controls.html')).webContents;
      const original=contents.getURL();
      await contents.loadURL(original.replace(/controls\.html$/,'controls.css'));
      const rejected=await contents.executeJavaScript("window.appModeControls.action('close')");
      const alive=!win.isDestroyed();
      await contents.loadURL(original);
      return {rejected,alive};
    },secondId);
    assert.deepEqual(navigationSecurity,{rejected:false,alive:true},'Navigation must not retain the ability to control windows');
    await secondControls('document.querySelector("[data-action=close]").click()').catch(()=>{});
    // A WebContentsView page may not emit Playwright's close event when its
    // owner window is destroyed; poll the window identity instead.
    for(let attempt=0;attempt<50;attempt++) {
      if(!await electron.evaluate(({BrowserWindow},id)=>Boolean(BrowserWindow.fromId(id)),secondId))break;
      await secondPage.waitForTimeout(100);
    }
    assert.equal(await electron.evaluate(({BrowserWindow},id)=>Boolean(BrowserWindow.fromId(id)),secondId),false);
    assert.equal(await electron.evaluate(({BrowserWindow},id)=>Boolean(BrowserWindow.fromId(id)),originalId),true);
    await page.bringToFront();
    await electron.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.contentView.children.find(child=>child.webContents?.getURL().startsWith('https://chatgpt.com'))
        .webContents.executeJavaScript("location.href='file:///C:/synthetic-blocked'");
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
