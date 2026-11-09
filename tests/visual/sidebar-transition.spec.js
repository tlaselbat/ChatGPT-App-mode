const { test, expect, _electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { visualHtml } = require('../helpers/visual-fixture.cjs');
const { windowCapture } = require('../helpers/window-capture.cjs');
const root = path.resolve(__dirname, '../..');

async function geometry(page, app) {
  const dom = await page.evaluate(() => {
    const rect = selector => {
      const e = document.querySelector(selector); if (!e) return null;
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom, opacity: Number(s.opacity), visibility: s.visibility, inert: e.inert };
    };
    return { viewport: { width: innerWidth, height: innerHeight }, state: document.body.dataset.appModeNavigationState,
      nativeOpen: document.querySelector('[data-app-shell-responsive-sidebar]').getAttribute('data-app-shell-sidebar-open'),
      rail: rect('#app-mode-compact-sidebar-actions'), sidebar: rect('aside'), drawer: rect('#browser-sidebar-popover'), workspace: rect('main'),
      scrollWidth: document.documentElement.scrollWidth, animation: !!window.__APP_MODE_CONTEXT__.navigationController.geometryAnimation };
  });
  const host = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return { window: win.getBounds(), content: win.getContentBounds(), scale: screen.getDisplayMatching(win.getBounds()).scaleFactor,
      views: win.contentView.children.map(v => ({ bounds: v.getBounds(), zoom: v.webContents.getZoomFactor() })) };
  });
  return { ...dom, ...host };
}

async function settle(page, state) {
  await expect(page.locator('body')).toHaveAttribute('data-app-mode-navigation-state', state);
  await expect.poll(() => page.evaluate(() => !!window.__APP_MODE_CONTEXT__.navigationController.geometryAnimation)).toBe(false);
  await expect(page.locator('#app-mode-compact-sidebar-actions')).toHaveCSS('opacity', state === 'drawer' ? '0' : '1');
  await expect(page.locator('#app-mode-compact-sidebar-actions')).toHaveCSS('visibility', state === 'drawer' ? 'hidden' : 'visible');
  await expect(page.locator('#app-mode-compact-sidebar-actions')).toHaveJSProperty('inert', state === 'drawer');
}

async function startFrames(page) {
  await page.evaluate(() => {
    window.transitionFrames = []; const start = performance.now();
    window.transitionFrameEnd = start + 700;
    // Read after this frame's production reconciliation callbacks, rather
    // than mistaking their not-yet-corrected DOM geometry for a painted jump.
    const next = () => requestAnimationFrame(frameTime => setTimeout(() => sample(frameTime), 0));
    const sample = frameTime => {
      const main = document.querySelector('main').getBoundingClientRect(), rail = document.querySelector('#app-mode-compact-sidebar-actions');
      const sidebar = document.querySelector('aside')?.getBoundingClientRect();
      window.transitionFrames.push({ t: performance.now() - start, frameTime, animationTime: window.__APP_MODE_CONTEXT__.navigationController.geometryAnimation?.currentTime ?? null, paintProbeShift: window.transitionPaintProbeShift || 0, x: main.x, right: main.right, sidebarRight: sidebar?.right,
        nativeLayoutX: main.x - (parseFloat(getComputedStyle(document.querySelector('main')).getPropertyValue('--app-mode-navigation-offset')) || 0),
        offset: parseFloat(getComputedStyle(document.querySelector('main')).getPropertyValue('--app-mode-navigation-offset')) || 0,
        intent: document.querySelector('[data-app-shell-responsive-sidebar]')?.getAttribute('data-app-shell-sidebar-open'),
        state: document.body.dataset.appModeNavigationState, railOpacity: Number(getComputedStyle(rail).opacity), railInert: rail.inert,
        pendingReconciliation: window.__APP_MODE_CONTEXT__.navigationController.queued,
        animation: !!window.__APP_MODE_CONTEXT__.navigationController.geometryAnimation, overflow: document.documentElement.scrollWidth - innerWidth });
      if (performance.now() < window.transitionFrameEnd) next();
    }; next();
  });
}

async function finishFrames(page, info, name, nativeTween = false) {
  const frames = await page.evaluate(() => { window.transitionFrameEnd = 0; return window.transitionFrames; });
  const file = info.outputPath(name + '-frames.json'); fs.writeFileSync(file, JSON.stringify(frames, null, 2));
  await info.attach('synthetic-geometry', { path: file, contentType: 'application/json' });
  const desktop = await page.evaluate(() => innerWidth >= 700);
  for (const frame of frames) {
    expect(frame.overflow).toBeLessThanOrEqual(0);
    expect(frame.right).toBeCloseTo(frames[0].right, 0);
    expect(frame.railInert).toBe(frame.state === 'drawer');
    if (desktop) expect(frame.railOpacity).toBe(1);
    expect(frame.railOpacity).toBeGreaterThanOrEqual(0);
    expect(frame.railOpacity).toBeLessThanOrEqual(1);
  }
  // Reduced motion deliberately permits an immediate layout change.
  if (name === 'reduced-motion') return frames;
  // Input tasks can mutate the DOM between a frame and this timer. Keep
  // those pending samples as diagnostics, not as evidence of presented paint.
  const reconciled = frames.filter(f => !f.pendingReconciliation);
  for (const frame of reconciled) expect(frame.x).toBeGreaterThanOrEqual(0);
  const span = Math.max(...reconciled.map(f => f.x)) - Math.min(...reconciled.map(f => f.x));
  for (let i = 1; i < reconciled.length; i++) {
    const dt = reconciled[i].t - reconciled[i - 1].t;
    // The retained-panel case has a second, native layout movement. Account
    // for that measured displacement separately from correction velocity.
    const nativeStep = nativeTween ? Math.abs(reconciled[i].nativeLayoutX - reconciled[i - 1].nativeLayoutX) : 0;
    expect(Math.abs(reconciled[i].x - reconciled[i - 1].x)).toBeLessThanOrEqual(nativeStep + Math.max(12, span * dt / 220 * 3 + 2));
  }
  return frames;
}

async function compositorRecorder(page, app, nativeTween = false) {
  const session = await page.context().newCDPSession(page);
  let frames = [];
  let initialX;
  session.on('Page.screencastFrame', frame => {
    if (frames.length < 240) frames.push({ png: frame.data, time: frame.metadata.timestamp, metadata: frame.metadata });
    session.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
  });
  return {
    async start() {
      frames = [];
      initialX = await page.locator('main').evaluate(e => e.getBoundingClientRect().x);
      await page.evaluate(paintJump => {
        const main = document.querySelector('main');
        if (paintJump) {
          const style = document.createElement('style'); style.textContent = 'main{overflow:clip!important}main>*{translate:var(--transition-probe-shift,0px) 0!important}'; document.head.append(style);
        }
        const canvas = document.createElement('canvas'); canvas.id = 'transition-paint-clock'; canvas.width = 160; canvas.height = 8;
        canvas.setAttribute('aria-hidden', 'true'); canvas.style.cssText = 'position:fixed;left:0;top:0;width:160px;height:8px;z-index:2147483647;pointer-events:none';
        document.body.append(canvas);
        const context = canvas.getContext('2d', { alpha: false });
        const draw = frameTime => {
          if (paintJump) {
            const time = window.__APP_MODE_CONTEXT__.navigationController.geometryAnimation?.currentTime;
            const shift = time >= 60 && time < 120 ? 96 : 0;
            if (shift !== (window.transitionPaintProbeShift || 0)) main.style.setProperty('--transition-probe-shift', `${shift}px`);
            window.transitionPaintProbeShift = shift;
          }
          const time = Math.round(frameTime * 1000) >>> 0;
          for (let bit = 0; bit < 40; bit++) {
            context.fillStyle = (bit < 8 ? 0xa5 >>> (7 - bit) & 1 : time >>> (39 - bit) & 1) ? '#00ffff' : '#000000';
            context.fillRect(bit * 4, 0, 4, 8);
          }
          window.transitionPaintClock = requestAnimationFrame(draw);
        };
        draw(performance.now());
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
      }, process.env.APP_MODE_TRANSITION_PROBE === 'paint-jump');
      await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
      const viewportWidth = await page.evaluate(() => innerWidth);
      await expect.poll(async () => {
        const frame = frames.at(-1); if (!frame) return false;
        const ready = await app.evaluate(({ nativeImage }, { frame, viewportWidth }) => {
          const image = nativeImage.createFromBuffer(Buffer.from(frame.png, 'base64')), size = image.getSize(), data = image.toBitmap(), scale = size.width / viewportWidth;
          let prefix = 0;
          for (let bit = 0; bit < 8; bit++) {
            const index = (Math.floor(4 * scale) * size.width + Math.floor((bit * 4 + 2) * scale)) * 4;
            prefix = prefix * 2 + Number(data[index] > 180 && data[index + 1] > 180 && data[index + 2] < 40);
          }
          return prefix === 0xa5;
        }, { frame, viewportWidth });
        if (ready) frames = frames.slice(frames.indexOf(frame));
        return ready;
      }).toBe(true);
      if (process.env.APP_MODE_TRANSITION_CLOCK_PROBE) console.log('Transition runtime:', await app.evaluate(() => ({ chrome: process.versions.chrome, electron: process.versions.electron })));
      if (process.env.APP_MODE_TRANSITION_CLOCK_PROBE === 'batch-capture') await app.evaluate(() => {
        setTimeout(() => { const end = performance.now() + 60; while (performance.now() < end) {} }, 120);
      });
    },
    async finish(info, name, reversal = false) {
      await session.send('Page.stopScreencast');
      const viewportWidth = await page.evaluate(() => {
        cancelAnimationFrame(window.transitionPaintClock); document.querySelector('#transition-paint-clock')?.remove();
        return innerWidth;
      });
      const pixels = await app.evaluate(({ nativeImage }, { frames, viewportWidth }) => frames.map(frame => {
        const image = nativeImage.createFromBuffer(Buffer.from(frame.png, 'base64'));
        const size = image.getSize(), data = image.toBitmap(); let left = Infinity, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 180 && data[i + 1] < 40 && data[i + 2] > 180) { left = Math.min(left, i / 4 % size.width); count++; }
        }
        const scale = size.width / viewportWidth;
        const bits = Array.from({ length: 40 }, (_, bit) => {
          const index = (Math.floor(4 * scale) * size.width + Math.floor((bit * 4 + 2) * scale)) * 4;
          return data[index] > 180 && data[index + 1] > 180 && data[index + 2] < 40 ? 1 : 0;
        });
        const paintTime = bits.slice(8).reduce((value, bit) => value * 2 + bit, 0) / 1000;
        return { t: paintTime, paintTime, captureT: frame.time * 1000,
          clockValid: bits.slice(0, 8).reduce((value, bit) => value * 2 + bit, 0) === 0xa5,
          metadata: frame.metadata, x: left * viewportWidth / size.width, markerPixels: count };
      }), { frames, viewportWidth });
      if (process.env.APP_MODE_TRANSITION_CLOCK_PROBE) for (let i = 0; i < frames.length; i++) fs.writeFileSync(info.outputPath(`${name}-paint-${i}.png`), Buffer.from(frames[i].png, 'base64'));
      const start = pixels[0]?.t, captureStart = pixels[0]?.captureT;
      for (const frame of pixels) { frame.t -= start; frame.captureT -= captureStart; }
      const file = info.outputPath(name + '-compositor.json'); fs.writeFileSync(file, JSON.stringify(pixels, null, 2));
      await info.attach('synthetic-geometry', { path: file, contentType: 'application/json' });
      expect(pixels.length).toBeGreaterThan(3);
      for (const frame of pixels) expect(frame.clockValid).toBe(true);
      for (const frame of pixels) expect(frame.markerPixels).toBeGreaterThan(8);
      for (const frame of pixels) expect(frame.x).toBeGreaterThanOrEqual(0);
      const first = pixels[0].x, last = pixels.at(-1).x, span = Math.max(...pixels.map(f => f.x)) - Math.min(...pixels.map(f => f.x));
      expect(Math.abs(first - initialX)).toBeLessThanOrEqual(1);
      expect(Math.abs(last - await page.locator('main').evaluate(e => e.getBoundingClientRect().x))).toBeLessThanOrEqual(1);
      expect(pixels.some(f => Math.abs(f.x - first) > 5 && (reversal || Math.abs(f.x - last) > 5))).toBe(true);
      const middle = pixels.reduce((best, frame, index) => Math.abs(frame.x - (first + last) / 2) < Math.abs(pixels[best].x - (first + last) / 2) ? index : best, 0);
      const image = info.outputPath(name + '-intermediate.png');
      fs.writeFileSync(image, Buffer.from(frames[middle].png, 'base64'));
      await info.attach('synthetic-actual', { path: image, contentType: 'image/png' });
      for (let i = 1; i < pixels.length; i++) expect(pixels[i].paintTime).toBeGreaterThanOrEqual(pixels[i - 1].paintTime);
      // Capture timestamps can bunch independently of native CSS frame updates.
      // The added native-tween case checks velocity with rAF geometry above;
      // its compositor evidence checks clipping, movement and exact endpoints.
      // Preserve the original eight cases' existing pixel-velocity assertion.
      if (!nativeTween) for (let i = 1; i < pixels.length; i++) expect(Math.abs(pixels[i].x - pixels[i - 1].x)).toBeLessThanOrEqual(Math.max(12, span * (pixels[i].t - pixels[i - 1].t) / 220 * 3 + 2));
    },
    async close() { await session.detach(); },
  };
}

const scenarios = [
  [390, 'light', 1], [480, 'dark', 1], [481, 'light', 1], [680, 'dark', 1],
  [1024, 'light', 1], [1280, 'dark', 1], [1024, 'dark', 1.25], [1280, 'light', 1.25],
  [1024, 'dark', 1, 'native-width-tween'],
];
for (const [width, theme, zoom, variant] of scenarios) test(`native sidebar transition ${width} ${theme} zoom ${zoom}${variant ? ' ' + variant : ''}`, async ({}, info) => {
  test.setTimeout(60000);
  let app;
  let paint;
  const measurements = [];
  const evidence = { environment: 'electron-sidebar-transition', appearance: theme, zoom, behavioralResult: 'unavailable', geometryResult: 'unavailable', visualResult: 'skipped', reason: 'Animation-enabled captures require human image review; no golden comparison' };
  const capture = async (name, composed = false) => {
    const file = info.outputPath(name + '.png');
    if (composed) await windowCapture(app, file); else await page.screenshot({ path: file, animations: 'allow' });
    await info.attach('synthetic-actual', { path: file, contentType: 'image/png' });
  };
  let page;
  try {
    const scratch = fs.mkdtempSync(path.join(info.outputPath(), 'transition-profile-'));
    fs.writeFileSync(path.join(scratch, 'config.json'), JSON.stringify({ url: 'https://chatgpt.com/c/synthetic-recents-0', window: { width, height: 728 }, rememberWindowPlacement: false, privacy: { saveLastSession: false, trackRecentChats: false } }));
    let html = visualHtml({ theme, expanded: width === 1024 && zoom === 1 });
    html = html.replace('<style>', '<style>main{position:relative}');
    html = html.replace('</main>', '<div aria-hidden="true" style="position:absolute;left:0;top:70px;width:4px;height:10px;background:#ff00ff;z-index:2147483647;pointer-events:none"></div></main>');
    html = html.replace('function toggle(){', 'function toggle(){window.syntheticToggleCalls=(window.syntheticToggleCalls||0)+1;');
    if (variant === 'native-width-tween') {
      // Current ChatGPT retains a panel while its native width changes. The
      // original fixture replaces it synchronously and cannot expose overlap
      // between that layout motion and App Mode's workspace compensation.
      const start = html.indexOf('function render() {');
      const end = html.indexOf('function toggle()', start);
      html = html.slice(0, start) + `function render() {
        if(innerWidth<700){document.querySelector('aside')?.remove();document.querySelector('#section-portal')?.remove();if(state.open){const p=document.createElement('div');p.id='section-portal';p.innerHTML='<div class="native-scrim codex-dialog-overlay" aria-hidden="true"></div><div id="browser-sidebar-popover" role="dialog" aria-modal="true">'+navigationMarkup(true)+'</div>';document.body.append(p)}return}
        document.querySelector('#section-portal')?.remove();
        let a=document.querySelector('aside');if(!a){a=document.createElement('aside');a.className='app-shell-left-panel';a.innerHTML=navigationMarkup(false);document.querySelector('#section-shell').prepend(a)}
        a.style.cssText='width:'+(state.open?280:52)+'px;min-width:'+(state.open?280:52)+'px;max-width:'+(state.open?280:52)+'px;flex-basis:'+(state.open?280:52)+'px;transition:width 220ms,min-width 220ms,max-width 220ms,flex-basis 220ms';
      }\n` + html.slice(end);
    }
    // Native fixture behavior owns its own modal focus trap. App Mode must
    // preserve it, then restore its trusted toggle when Escape dismisses it.
    html = html.replace('</body>', `<script>
      new MutationObserver(()=>{const d=document.querySelector('#browser-sidebar-popover');if(d&&!d.contains(document.activeElement)){d.querySelector('button')?.focus()}}).observe(document.body,{childList:true});
      document.addEventListener('keydown',e=>{const d=document.querySelector('#browser-sidebar-popover');if(e.key!=='Tab'||!d)return;const items=[...d.querySelectorAll('button,a[href]')].filter(x=>x.getClientRects().length&&!x.closest('[inert],[hidden]'));if(!items.length)return;const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}});
    </script></body>`);
    if (process.env.APP_MODE_TRANSITION_LEGACY_FIXTURE === '1') html = html.replaceAll('navigationMarkup(', 'navigation(');
    const fixture = path.join(scratch, 'fixture.html'); fs.writeFileSync(fixture, html);
    const env = { ...process.env, APP_MODE_HOST_FIXTURE: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.APP_MODE_HOST_TEST_PORT;
    app = await _electron.launch({ executablePath: require('electron'), env,
      args: [path.join(root, 'WindowHost/main.cjs'), `--app-mode-root=${scratch}`, `--fixture=${fixture}`,
        "--fixture-csp=default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'"] });
    await expect.poll(() => app.windows().some(p => p.url().endsWith('/controls.html'))).toBe(true);
    const controls = app.windows().find(p => p.url().endsWith('/controls.html'));
    await expect(controls.locator('body')).toHaveAttribute('data-presentation', 'ready');
    page = app.windows().find(p => p.url().startsWith('https://chatgpt.com'));
    expect(await page.evaluate(() => typeof window.navigation?.addEventListener)).toBe('function');
    await expect.poll(() => page.evaluate(() => window.__APP_MODE_CONTEXT__?.installed && window.__APP_MODE_CONTEXT__?.hostNavigation?.ready)).toBe(true);
    if (variant && process.env.APP_MODE_REVERSAL_PROBE === 'stale-layout') {
      const source = require('node:child_process').execFileSync('git', ['show', '8e2f8d1:extension/scripts/10-sidebar.js'], { cwd: root, encoding: 'utf8' });
      const legacy = source.slice(source.indexOf('    captureGeometry() {'), source.indexOf('    closeFlyout('));
      await page.evaluate(methods => { const controller = window.__APP_MODE_CONTEXT__.navigationController; controller.cancelGeometry(); Object.assign(controller, (0, eval)('({' + methods + '})')); }, legacy);
    }
    const toggle = controls.locator('[data-action="toggle-sidebar"]'); await expect(toggle).toBeVisible();
    if (zoom !== 1) await app.evaluate(({ BrowserWindow }, zoom) => BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.setZoomFactor(zoom), zoom);
    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: theme });
    const expanded = (await page.evaluate(() => innerWidth)) < 700 ? 'drawer' : 'docked';
    if (expanded === 'docked') paint = await compositorRecorder(page, app, !!variant);
    await settle(page, width === 1024 && zoom === 1 ? 'docked' : 'compact');
    measurements.push({ phase: 'initial', ...await geometry(page, app) });
    if (width === 1024 && zoom === 1) {
      await capture('1024-settled', true);
      await toggle.click(); await settle(page, 'compact');
    }
    const toggleBox = await toggle.boundingBox();
    if (variant) {
      await startFrames(page); await paint.start();
      for (let i = 0; i < 6; i++) { await toggle.click(); await page.waitForTimeout(65); }
      await settle(page, 'compact');
      await expect(page.locator('aside')).toHaveCSS('width', '52px');
      await page.waitForTimeout(100);
      await finishFrames(page, info, 'original-rapid-reproduction', true);
      await paint.finish(info, 'original-rapid-reproduction', true);
    }
    for (const action of ['opening', 'closing']) {
      await startFrames(page);
      if (paint) await paint.start();
      await toggle.focus(); await controls.keyboard.press('Enter');
      await page.waitForTimeout(50);
      // A separate screenshot can temporarily change capture metrics at page
      // zoom. Docked cases use a real compositor frame as their intermediate.
      if (!paint) await capture(action + '-intermediate');
      await settle(page, action === 'opening' ? expanded : 'compact');
      await page.waitForTimeout(100);
      const frames = await finishFrames(page, info, action, !!variant);
      if (paint) await paint.finish(info, action);
      if (expanded === 'docked') {
        if (variant) expect(frames.some(f => Math.abs(f.x - frames[0].x) > 1 && Math.abs(f.x - frames.at(-1).x) > 1)).toBe(true);
        else expect(frames.some(f => f.animation && Math.abs(f.x - frames[0].x) > 1 && Math.abs(f.x - frames.at(-1).x) > 1)).toBe(true);
      }
      const current = await geometry(page, app); measurements.push({ phase: action, ...current });
      expect(await toggle.boundingBox()).toEqual(toggleBox);
      expect(current.scrollWidth).toBeLessThanOrEqual(current.viewport.width);
      expect(current.rail.width).toBe(52);
      expect(current.views[1].bounds.height).toBe(40);
      expect(current.views[1].zoom).toBe(1);
      if (action === 'opening' && expanded === 'docked') {
        expect(current.sidebar.x).toBe(52);
        expect(current.workspace.x - current.sidebar.right).toBeCloseTo(8, 0);
      }
      expect(current.rail.x).toBe(0);
      await capture(action + '-settled');
    }
    if ([680, 1024].includes(width) && zoom === 1) {
      await startFrames(page);
      if (variant) await paint.start();
      for (let i = 0; i < 6; i++) { const count = await page.evaluate(() => window.syntheticToggleCalls || 0); await toggle.click(); await expect.poll(() => page.evaluate(() => window.syntheticToggleCalls)).toBe(count + 1); await page.waitForTimeout(variant ? 65 : 35); }
      await settle(page, 'compact');
      if (variant) { await expect(page.locator('aside')).toHaveCSS('width', '52px'); await page.waitForTimeout(100); }
      const rapid = await finishFrames(page, info, 'rapid-reversal', !!variant);
      if (variant) await paint.finish(info, 'rapid-reversal', true);
      if (expanded === 'docked' && !variant) expect(rapid.some(frame => frame.animation)).toBe(true);
      await toggle.click(); await settle(page, expanded);
      if (expanded === 'drawer') {
        const drawer = page.locator('#browser-sidebar-popover');
        await expect.poll(() => drawer.evaluate(e => e.contains(document.activeElement))).toBe(true);
        for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+Tab');
        await expect.poll(() => drawer.evaluate(e => e.contains(document.activeElement))).toBe(true);
        await page.keyboard.press('Escape'); await settle(page, 'compact');
        await expect(toggle).toBeFocused();
      } else { await toggle.click(); await settle(page, 'compact'); }
      measurements.push({ phase: 'rapid-reversal-and-focus', ...await geometry(page, app) });
    }
    if (width === 1024 && zoom === 1) {
      await toggle.click(); await settle(page, 'docked');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(680, 728));
      await settle(page, 'drawer');
      measurements.push({ phase: 'resize-open-docked-to-drawer', ...await geometry(page, app) });
      await capture('resize-drawer');
      await page.keyboard.press('Escape'); await settle(page, 'compact');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 728));
      await settle(page, 'compact');
      measurements.push({ phase: 'resize-return-to-desktop', ...await geometry(page, app) });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startFrames(page);
    await toggle.click(); await settle(page, expanded);
    const reduced = await finishFrames(page, info, 'reduced-motion');
    expect(reduced.length).toBeGreaterThan(0);
    expect(reduced.every(frame => !frame.animation)).toBe(true);
    expect(await page.locator('#app-mode-compact-sidebar-actions').evaluate(e => getComputedStyle(e).transitionDuration)).toBe('0s');
    expect(await page.evaluate(() => !!window.__APP_MODE_CONTEXT__.navigationController.geometryAnimation)).toBe(false);
    await toggle.click(); await settle(page, 'compact');
    evidence.behavioralResult = evidence.geometryResult = 'passed';
  } finally {
    evidence.measurements = measurements;
    if (paint) await paint.close();
    if (app) await app.close();
    const file = info.outputPath('measurements.json'); fs.writeFileSync(file, JSON.stringify(measurements, null, 2));
    await info.attach('synthetic-geometry', { path: file, contentType: 'application/json' });
    await info.attach('visual-metadata', { body: Buffer.from(JSON.stringify(evidence)), contentType: 'application/json' });
  }
});
