const fs = require('node:fs');
const path = require('node:path');
const childMode = process.versions.electron && process.argv.includes('--review-capture-child');

function option(name) {
  return process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function tintedPixelCount(image) {
  const bitmap = image.toBitmap();
  let count = 0;
  // nativeImage uses BGRA on Windows. Count highly saturated pixels rather
  // than a specific channel order so this test stays renderer-platform-safe.
  for (let index = 0; index < bitmap.length; index += 4) {
    const channels = [bitmap[index], bitmap[index + 1], bitmap[index + 2]].sort((a, b) => a - b);
    if (channels[2] > 180 && channels[1] < 80 && channels[0] < 80) count += 1;
  }
  return count;
}

function nextPaint(contents) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Offscreen review fixture did not paint')), 10000);
    contents.once('paint', (_event, _dirty, image) => { clearTimeout(timer); resolve(image); });
  });
}

async function runElectronCaptureFixture() {
  const { app, BrowserWindow, nativeImage } = require('electron');
  const outputRoot = option('--review-capture-output');
  if (!outputRoot) process.exitCode = 2;
  await app.whenReady();
  const backgroundSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="30"><text y="24" font-size="28" fill="#0000ff">background secret</text></svg>';
  const html = `<!doctype html><style>body{margin:0;background:#010203;overflow:hidden}#html-secret{position:absolute;top:70px;color:#ff0000;font:28px sans-serif}#svg-secret{position:absolute;top:36px;left:220px}#background-secret{position:absolute;top:5px;left:5px;width:180px;height:30px;background-image:url(data:image/svg+xml;base64,${Buffer.from(backgroundSvg).toString('base64')})}</style><div id="html-secret">HTML secret</div><svg id="svg-secret" width="150" height="40"><text y="30" font-size="28" fill="#00ff00">SVG secret</text></svg><div id="background-secret"></div>`;
  const win = new BrowserWindow({ show: false, paintWhenInitiallyHidden: true, width: 489, height: 1000,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    const firstPaint = nextPaint(win.webContents);
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await firstPaint;
    await win.webContents.executeJavaScript(`
      document.querySelector('#html-secret').style.setProperty('color', '#ff0000', 'important');
      document.querySelector('#svg-secret text').style.setProperty('fill', '#00ff00', 'important');
      const background = document.querySelector('#background-secret');
      background.style.setProperty('background-image', getComputedStyle(background).backgroundImage, 'important');
    `);
    const zoomPaint = nextPaint(win.webContents);
    win.webContents.setZoomFactor(0.8);
    win.webContents.invalidate();
    await zoomPaint;
    const capturePage = win.webContents.capturePage.bind(win.webContents);
    const captureRect = { x: 0, y: 0, width: win.getContentBounds().width, height: 64 };
    const before = await capturePage(captureRect);
    const { run } = require('../WindowHost/review-actions.cjs');
    await run(win, { action: 'capture' }, path.resolve(__dirname, '..'), outputRoot);
    const masked = nativeImage.createFromPath(path.join(outputRoot, 'header.png'));
    fs.writeFileSync(path.join(outputRoot, 'render-result.json'), JSON.stringify({ before: tintedPixelCount(before), masked: tintedPixelCount(masked) }));
  } finally {
    if (!win.isDestroyed()) win.destroy();
    app.quit();
  }
}

if (childMode) {
  runElectronCaptureFixture().catch(error => { console.error(error.stack); require('electron').app.exit(1); });
} else {
  const { test } = require('node:test');
  const assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');
  const { run, isTrustedReviewOrigin, captureMaskHeight } = require('../WindowHost/review-actions.cjs');
  const root = path.resolve(__dirname, '..');

  test('review navigation only accepts the exact trusted ChatGPT origin', async () => {
    for (const url of ['https://chatgpt.com/', 'https://chatgpt.com/c/synthetic']) assert.equal(isTrustedReviewOrigin(url), true);
    for (const url of ['http://chatgpt.com/', 'https://chatgpt.com.evil.test/', 'https://user@chatgpt.com/', 'file:///C:/fixture']) assert.equal(isTrustedReviewOrigin(url), false);
    const win = { webContents: { getURL: () => 'https://chatgpt.com.evil.test/', executeJavaScript: () => { throw new Error('must not inspect an untrusted page'); } } };
    assert.deepEqual(await run(win, { action: 'open-conversation' }, '', ''), { status: 'review-navigation-origin-rejected' });
    assert.deepEqual(await run(win, { action: 'home' }, '', ''), { status: 'review-navigation-origin-rejected' });
  });

  test('review capture expands its text mask below 100 percent zoom and suppresses image-derived text', async () => {
    assert.equal(captureMaskHeight(0.8), 80);
    assert.equal(captureMaskHeight(1), 64);
    const scripts = [], cssRules = [];
    const runs = path.join(root, 'test-results', 'runs');
    fs.mkdirSync(runs, { recursive: true });
    const outputRoot = fs.mkdtempSync(path.join(runs, 'review-actions-'));
    const win = {
      getContentBounds: () => ({ width: 489, height: 1000 }),
      webContents: {
        getZoomFactor: () => 0.8,
        executeJavaScript: async script => { scripts.push(script); },
        insertCSS: async (css, options) => { assert.equal(options.cssOrigin, 'user'); cssRules.push(css); return 'review-mask'; },
        removeInsertedCSS: async key => assert.equal(key, 'review-mask'),
        capturePage: async rect => { assert.deepEqual(rect, { x: 0, y: 0, width: 489, height: 64 }); return { toPNG: () => Buffer.from('masked') }; },
      },
    };
    try {
      assert.deepEqual(await run(win, { action: 'capture' }, '', outputRoot), { status: 'header-captured', scope: 'top-64px-only-with-private-text-masked' });
      assert.match(scripts[0], /box\.top<80/);
      assert.match(cssRules[0], /svg,svg \*/);
      assert.match(cssRules[0], /background-image:none/);
      assert.deepEqual(fs.readFileSync(path.join(outputRoot, 'header.png')), Buffer.from('masked'));
    } finally { fs.rmSync(outputRoot, { recursive: true, force: true }); }
  });

  test('rendered Electron capture masks 70px text, SVG text, and background image text at 80 percent zoom', { timeout: 30000 }, async () => {
    const runs = path.join(root, 'test-results', 'runs');
    fs.mkdirSync(runs, { recursive: true });
    const outputRoot = fs.mkdtempSync(path.join(runs, 'review-capture-render-'));
    const profile = path.join(outputRoot, 'profile');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    try {
      const child = spawn(require('electron'), [__filename, '--review-capture-child', `--review-capture-output=${outputRoot}`, `--user-data-dir=${profile}`], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      const code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new Error('Electron capture fixture timed out')); }, 25000);
        child.once('error', reject);
        child.once('exit', exitCode => { clearTimeout(timer); resolve(exitCode); });
      });
      assert.equal(code, 0);
      assert.equal(fs.existsSync(path.join(outputRoot, 'render-result.json')), true, stderr);
      const result = JSON.parse(fs.readFileSync(path.join(outputRoot, 'render-result.json'), 'utf8'));
      assert.ok(result.before > 50, `fixture colors did not render: ${JSON.stringify(result)}`);
      assert.equal(result.masked, 0, `masked capture still contained private colored content: ${JSON.stringify(result)}`);
    } finally { fs.rmSync(outputRoot, { recursive: true, force: true }); }
  });
}
