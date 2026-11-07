const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { readConfig, safeBounds } = require('../WindowHost/config.cjs');
const runs = path.join(__dirname, '../test-results/runs');
fs.mkdirSync(runs, { recursive: true });

test('native config rejects malformed data and clamps finite geometry to matching work area', () => {
  const codes = [], diagnose = code => codes.push(code);
  const dir = fs.mkdtempSync(path.join(runs, 'app-mode-config-'));
  const file = path.join(dir, 'config.json');
  for (const text of ['{private-invalid', 'null', '[]']) {
    fs.writeFileSync(file, text); assert.deepEqual(readConfig(file, diagnose), {});
  }
  fs.writeFileSync(file, '{"window":{"width":1400},"layout":{"compactSidebar":false}}');
  assert.equal(readConfig(file).layout.compactSidebar, false);
  const area = { x: -1920, y: 120, width: 1920, height: 1040 };
  const screen = { getDisplayMatching(bounds) {
    assert.ok(Object.values(bounds).every(Number.isFinite)); return { workArea: area };
  } };
  for (const bad of ['invalid', 'NaN', 'Infinity', Infinity, NaN, null, {}, -100, 1e100]) {
    const b = safeBounds([], { window: { width: bad, height: bad } }, screen, diagnose);
    assert.ok(Object.values(b).every(Number.isInteger));
    assert.ok(b.width >= 390 && b.width <= area.width && b.height >= 300 && b.height <= area.height);
    assert.ok(b.x >= area.x && b.x + b.width <= 0 && b.y >= area.y && b.y + b.height <= area.y + area.height);
  }
  assert.deepEqual(safeBounds(['--window-size=800,600', '--window-position=-1800,200'], {}, screen), { x: -1800, y: 200, width: 800, height: 600 });
  assert.equal(safeBounds(['--window-position=0,0'], {}, { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 800, height: 600 } }) }).x, 0);
  assert.ok(codes.every(code => /^CONFIG_[A-Z_]+$/.test(code)));
});

test('delayed caption initialization cannot overwrite a push or notify after unsubscribe', async () => {
  let bridge, listener, resolve;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../WindowHost/controls-preload.cjs'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: { on: (_name, value) => { listener = value; }, removeListener: () => {},
        invoke: () => new Promise(done => { resolve = done; }) } }),
  });
  const states = []; let unsubscribe = bridge.onState(value => states.push(value));
  listener({}, { pinned: true, maximized: true, navigation: 'new' });
  resolve({ pinned: false, maximized: false, navigation: 'old' }); await new Promise(setImmediate);
  assert.equal(states.length, 1); assert.equal(states[0].pinned, true);
  unsubscribe(); listener({}, {}); assert.equal(states.length, 1);
  unsubscribe = bridge.onState(value => states.push(value)); unsubscribe(); resolve({});
  await new Promise(setImmediate); assert.equal(states.length, 1);
});

test('server process ownership rejects incidental arguments and revalidates before termination', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-File', path.join(__dirname, 'ServerOwnership.Tests.ps1')], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('injection reports fixed stages, stops partial initialization and rejects stale documents', async () => {
  const { injectPage } = require('../WindowHost/injection.cjs');
  const stages = ['load', 'css', 'scripts', 'header', 'navigation', 'reconcile'];
  for (let failed = 0; failed < stages.length; failed++) {
    const calls = [], codes = [];
    const options = { current: () => true, diagnose: code => codes.push(code) };
    for (let i = 0; i < stages.length; i++) options[stages[i]] = async () => { calls.push(stages[i]); if (i === failed) throw Error('private'); };
    assert.equal(await injectPage(options), false);
    assert.equal(calls.length, failed + 1); assert.equal(codes.length, 1); assert.match(codes[0], /^INJECTION_[A-Z_]+_FAILED$/);
  }
  let alive = true, later = false;
  assert.equal(await injectPage({ current: () => alive, load: () => { alive = false; }, css: () => { later = true; } }), false);
  assert.equal(later, false);
  for (let reload = 0; reload < 3; reload++) {
    assert.equal(await injectPage(Object.fromEntries([['current', () => true], ...stages.map(name => [name, async () => {}])])), true);
  }
  for (const staleAt of stages) {
    let active = true;
    const calls = [], codes = [];
    const options = { current: () => active, diagnose: code => codes.push(code) };
    for (const name of stages) options[name] = async () => {
      calls.push(name); if (name === staleAt) { active = false; throw Error('discarded-document'); }
    };
    assert.equal(await injectPage(options), false);
    assert.deepEqual(calls, stages.slice(0, stages.indexOf(staleAt) + 1));
    assert.deepEqual(codes, [], 'Stale failures must not diagnose the replacement document');
  }
});

test('unchanged native events avoid bounds, zoom and state writes while changed events propagate', () => {
  const { measure } = require('../tools/measure-controls.cjs');
  const result = measure();
  assert.deepEqual(result.unchanged100Events, { bounds: 0, zoom: 0, publications: 0 });
  assert.deepEqual(result.changedTotals, { bounds: 2, zoom: 0, publications: 1 });
});

test('optional shell registration cannot block launch, new session, shortcut, or explicit error reporting', () => {
  const { spawnSync } = require('node:child_process');
  const scratch = fs.mkdtempSync(path.join(__dirname, '../test-results/runs/taskbar-optional-'));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-File', path.join(__dirname, 'Taskbar.Optional.Tests.ps1'), '-Scratch', scratch], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('caption IPC rejects stale, remote, detached, cross-window and malformed requests without desktop input', () => {
  const module = { exports: {} };
  let owner;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../WindowHost/controls-host.cjs'), 'utf8'), {
    module, require: name => name === 'electron' ? { BrowserWindow: { fromWebContents: () => owner } } : require(name),
  });
  const validate = module.exports.validateControlRequest;
  const url = 'file:///synthetic/controls.html';
  const contents = { isDestroyed: () => false, getURL: () => url, mainFrame: { url } };
  const view = { webContents: contents };
  const win = { isDestroyed: () => false, contentView: { children: [view] } }; owner = win;
  const context = { win, view, controlsUrl: url }, event = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal(validate(event, ['pin'], context), true);
  assert.equal(validate(event, ['reload'], context), true);
  for (const args of [[], ['unknown'], ['close', 'extra'], [null], ['open-search', {}]]) assert.equal(validate(event, args, context), false);
  assert.equal(validate({ ...event, sender: {} }, ['pin'], context), false);
  assert.equal(validate({ ...event, sender: {} }, ['reload'], context), false);
  assert.equal(validate({ ...event, senderFrame: { url } }, ['reload'], context), false);
  assert.equal(validate(event, ['reload', 'https://example.com'], context), false);
  assert.equal(validate({ ...event, senderFrame: { url } }, ['pin'], context), false);
  assert.equal(validate(event, ['pin'], { ...context, controlsUrl: url + '#other' }), false);
  win.contentView.children = []; assert.equal(validate(event, ['pin'], context), false);
  win.contentView.children = [view]; owner = {}; assert.equal(validate(event, ['pin'], context), false);
  owner = win; win.isDestroyed = () => true; assert.equal(validate(event, ['pin'], context), false);
});

test('real supported shell images match and terminate only their own disposable sleeping script', () => {
  const { spawnSync } = require('node:child_process');
  const scratch = fs.mkdtempSync(path.join(runs, 'ownership-smoke-'));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-File', path.join(__dirname, 'ServerOwnership.Smoke.ps1'), '-Scratch', scratch], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
