const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { _electron } = require('playwright');
const { installPlacement } = require('../WindowHost/placement.cjs');
const { safeBounds } = require('../WindowHost/config.cjs');
const repo = path.resolve(__dirname, '..'), runs = path.join(repo, 'test-results/runs');
fs.mkdirSync(runs, { recursive: true });
const delay = ms => new Promise(r => setTimeout(r, ms));

test('placement preserves DIP coordinates, skips transient states and disabled persistence', () => {
  const root = fs.mkdtempSync(path.join(runs, 'placement-unit-'));
  const config = path.join(root, 'config.json'), file = path.join(root, 'logs/window-state.json');
  fs.writeFileSync(config, '{}');
  const win = Object.assign(new EventEmitter(), { id: 1, minimized: false, fullscreen: false,
    isDestroyed: () => false, isVisible: () => true, isFocused: () => true,
    isMinimized() { return this.minimized; }, isFullScreen() { return this.fullscreen; },
    isMaximized: () => false, getNormalBounds: () => ({ x: -1100, y: 20, width: 680, height: 850 }) });
  installPlacement(win, root, { x: -1100, y: 20, width: 679, height: 850 });
  try {
    win.emit('show');
    win.emit('close'); const initial = fs.readFileSync(file, 'utf8'), stamp = fs.statSync(file).mtimeMs;
    assert.equal(JSON.parse(initial).width, 679, 'native startup rounding is not a user resize');
    win.emit('close'); assert.equal(fs.statSync(file).mtimeMs, stamp, 'unchanged state is not rewritten');
    win.minimized = true; win.emit('close'); win.minimized = false;
    win.fullscreen = true; win.emit('close'); win.fullscreen = false;
    fs.writeFileSync(config, '{"rememberWindowPlacement":false}'); win.emit('close');
    assert.equal(fs.readFileSync(file, 'utf8'), initial);
    fs.writeFileSync(config, '{}');
    win.getNormalBounds = () => ({ x: -1000, y: 30, width: 730, height: 620 });
    win.emit('close'); assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).width, 730, 'real resize persists');
    for (const scaleFactor of [1, 1.25, 1.5]) {
      const area = { x: -1536, y: 0, width: 1536, height: 864 };
      const screen = { getDisplayMatching: () => ({ scaleFactor, workArea: area }) };
      for (const [position, size] of [['-1100,20','390,300'], ['99999,-99999','4096,4096'], ['-99999,99999','680,850']]) {
        let b = safeBounds([`--window-position=${position}`, `--window-size=${size}`], {}, screen);
        assert.ok(b.x >= area.x && b.y >= area.y && b.x + b.width <= 0 && b.y + b.height <= 864);
        for (let i = 0; i < 10; i++) assert.deepEqual(safeBounds([`--window-position=${b.x},${b.y}`, `--window-size=${b.width},${b.height}`], {}, screen), b);
      }
    }
  } finally { win.emit('closed'); }
});

test('real Electron geometry survives ten persisted relaunches and window-state transitions', { timeout: 240000 }, async () => {
  const root = fs.mkdtempSync(path.join(runs, 'geometry-host-'));
  function link(from, to) { fs.mkdirSync(to, { recursive: true }); for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) link(path.join(from, e.name), path.join(to, e.name)); else fs.linkSync(path.join(from, e.name), path.join(to, e.name));
  } }
  // Resolve the package entry point first: on a clean installation Electron
  // materializes its binary lazily. Do not depend on another test running first.
  link(path.dirname(require('electron')), path.join(root, 'node_modules/electron/dist'));
  const file = path.join(root, 'logs/window-state.json'), config = path.join(root, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ installRoot: root, url: 'https://chatgpt.com/', rememberWindowPlacement: true, window: { width: 680, height: 850 } }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Valid legacy state: start from the exact original drift reproduction.
  fs.writeFileSync(file, JSON.stringify({ x: 100, y: 90, width: 680, height: 850, maximized: false }));
  const fixture = path.join(root, 'fixture.html'); fs.writeFileSync(fixture, '<!doctype html><title>Geometry fixture</title><main>Synthetic geometry test. No account data.</main>');
  const net = require('node:net'), listener = net.createServer();
  await new Promise(r => listener.listen(0, '127.0.0.1', r)); const port = listener.address().port; await new Promise(r => listener.close(r));
  const server = spawn('powershell.exe', ['-NoProfile', '-File', path.join(repo, 'Start-ChatGPT-TopMostServer.ps1'), '-AppRoot', root, '-Port', String(port)], { windowsHide: true, stdio: 'ignore' });
  let host; const measurements = [];
  const state = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const savedArgs = () => {
    const script = `. '${repo.replaceAll("'", "''")}/tools/ChatGPT-AppMode.Helpers.ps1'; $c=Get-Content -LiteralPath '${config.replaceAll("'", "''")}' -Raw|ConvertFrom-Json; @(Get-AppModeWindowArgs -Config $c)|ConvertTo-Json -Compress`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout.trim());
  };
  async function launch(extra = []) {
    const env = { ...process.env, APP_MODE_HOST_FIXTURE: '1', APP_MODE_HOST_TEST_PORT: String(port) }; delete env.ELECTRON_RUN_AS_NODE;
    host = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [path.join(repo, 'WindowHost/main.cjs'), `--app-mode-root=${root}`, `--user-data-dir=${path.join(root, 'Browser/AppModeHostProfile')}`, `--fixture=${fixture}`, ...savedArgs(), ...extra], env });
    for (let i = 0; i < 100; i++) { if (await host.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())) return; await delay(50); }
    throw Error('Fixture never became visible');
  }
  async function snapshot(label) {
    const data = await host.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0], d = screen.getDisplayMatching(w.getBounds()); return { bounds: w.getBounds(), content: w.getContentBounds(), normal: w.getNormalBounds(), maximized: w.isMaximized(), scaleFactor: d.scaleFactor, workArea: d.workArea }; });
    measurements.push({ label, ...data }); return data;
  }
  async function close() { await host.close(); host = null; }
  const boundsOnly = s => ({ x: s.x, y: s.y, width: s.width, height: s.height });
  try {
    await launch(); const initial = (await snapshot('initial')).bounds; await close();
    for (let i = 1; i <= 10; i++) { await launch(); assert.deepEqual((await snapshot(`relaunch-${i}`)).bounds, initial); await close(); assert.deepEqual(boundsOnly(state()), initial); }
    await launch(); await host.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 240, y: 100, width: 730, height: 620 }));
    const resized = (await snapshot('resized')).bounds; await close(); await launch(); assert.deepEqual((await snapshot('resize-relaunch')).bounds, resized);
    await host.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize()); await delay(250); await close(); assert.equal(state().maximized, true);
    await launch(); assert.equal((await snapshot('maximized-relaunch')).maximized, true);
    await host.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize()); await delay(250); assert.deepEqual((await snapshot('restored')).bounds, resized); await close();
    await launch(); const beforeMin = fs.readFileSync(file, 'utf8'); await host.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize()); await close(); assert.equal(fs.readFileSync(file, 'utf8'), beforeMin);
    await launch(); await host.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true)); await delay(250); const beforeFull = fs.readFileSync(file, 'utf8'); await close(); assert.equal(fs.readFileSync(file, 'utf8'), beforeFull);
    await launch(); await host.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 100, y: 100, width: 390, height: 300 })); await close();
    for (let i = 0; i < 3; i++) { await launch(); assert.equal((await snapshot('minimum')).bounds.width, 390); assert.equal((await snapshot('minimum-height')).bounds.height, 300); await close(); }
    for (const factor of [1.25, 1.5]) { await launch([`--force-device-scale-factor=${factor}`]); const b = (await snapshot(`emulated-scale-${factor}`)).bounds; await close(); for (let i = 1; i <= 10; i++) { await launch([`--force-device-scale-factor=${factor}`]); assert.deepEqual((await snapshot(`emulated-scale-${factor}-relaunch-${i}`)).bounds, b); await close(); } }
    fs.writeFileSync(file, JSON.stringify({ x: 99999, y: -99999, width: 4096, height: 4096, maximized: false, coordinateSpace: 'electron-dip' }));
    await launch(); const recovered = await snapshot('offscreen'); assert.ok(recovered.bounds.x >= recovered.workArea.x && recovered.bounds.y >= recovered.workArea.y); assert.ok(recovered.bounds.width <= recovered.workArea.width && recovered.bounds.height <= recovered.workArea.height); await close();
    await launch();
    assert.equal(await host.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const chat = w.contentView.children.find(v => v.webContents?.getURL().startsWith('https://chatgpt.com')).webContents;
      // Keep the app alive while delivering callbacks queued by the old view.
      const keeper = new BrowserWindow({ show: false });
      w.destroy();
      chat.emit('page-title-updated', { preventDefault() {} });
      chat.emit('did-finish-load');
      return true;
    }), true);
    await close();
  } finally {
    if (host) await host.close().catch(() => {});
    server.kill(); if (server.exitCode === null && server.signalCode === null) await new Promise(r => server.once('exit', r));
    fs.writeFileSync(path.join(root, 'measurements.json'), JSON.stringify(measurements, null, 2));
    console.log(`Geometry measurements: ${root}`);
  }
});
