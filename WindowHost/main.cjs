// Remote pages run sandboxed, without Node, preload bridges, or privileged IPC.
const { app, BrowserWindow, WebContentsView, session, shell, screen, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { isChatGptUrl, isLoginUrl, isExternalUrl, hostProfile, isTrustedPermission,
  allowControlOriginInCsp, canApplyDocumentResult, tryCreateWindow } = require('./policy.cjs');
const { installBrowserShortcuts } = require('./shortcuts.cjs');
const { installWindowControls } = require('./controls-host.cjs');
const { injectPage } = require('./injection.cjs');
const { readConfig, safeBounds } = require('./config.cjs');
const { installPlacement } = require('./placement.cjs');
const sourceRoot = path.resolve(__dirname, '..');
const option = (args, name) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(option(process.argv, 'app-mode-root') || sourceRoot);
const profile = hostProfile(root);
for (const directory of [path.join(root, 'Browser'), profile]) {
  if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) {
    throw new Error('Native host profile directories must not be links or junctions.');
  }
}
// Never adopt --user-data-dir from the command line or configuration.
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.setAppUserModelId('OpenAI.ChatGPT.AppMode');
let browserSession;
let fixturePath;
const liveReview = process.argv.includes('--live-review');
const permissionGrants = new Map();
const navigationGenerations = new WeakMap();

function openExternal(url) {
  if (isExternalUrl(url)) shell.openExternal(url).catch(() => {});
}

function guardNavigation(contents) {
  navigationGenerations.set(contents, 0);
  installBrowserShortcuts(contents);
  contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      navigationGenerations.set(contents, (navigationGenerations.get(contents) || 0) + 1);
      for (const key of permissionGrants.keys()) if (key.startsWith(`${contents.id}:`)) permissionGrants.delete(key);
    }
  });
  contents.on('destroyed', () => {
    for (const key of permissionGrants.keys()) if (key.startsWith(`${contents.id}:`)) permissionGrants.delete(key);
  });
  contents.on('will-navigate', (event, url) => {
    if (isChatGptUrl(url) || isLoginUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  contents.on('will-redirect', (event, url) => {
    if (!isChatGptUrl(url) && !isLoginUrl(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    tryCreateWindow(() => {
      if (isChatGptUrl(url)) createWindow([`--url=${url}`]);
      else if (isLoginUrl(url)) {
        const login = new BrowserWindow({ width: 600, height: 800, autoHideMenuBar: true,
          webPreferences: { session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } });
        guardNavigation(login.webContents);
        login.webContents.on('did-navigate', (_event, destination) => {
          if (isChatGptUrl(destination)) {
            if (!contents.isDestroyed()) contents.loadURL(destination).catch(() => {});
            login.close();
          }
        });
        login.loadURL(url).catch(() => {});
      } else openExternal(url);
    });
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', event => event.preventDefault());
}

function createWindow(args) {
  const config = readConfig(path.join(root, 'config.json'));
  const requested = option(args, 'url') || config.url || 'https://chatgpt.com/';
  const url = isChatGptUrl(requested) ? requested : 'https://chatgpt.com/';
  const bounds = safeBounds(args, config, screen);
  const win = new BrowserWindow({
    ...bounds, minWidth: 390, minHeight: 300,
    title: 'ChatGPT', icon: path.join(sourceRoot, 'assets', 'AppMode-hex-selected.ico'),
    backgroundColor: '#212121', autoHideMenuBar: true, show: false,
    titleBarStyle: 'hidden',
    webPreferences: { session: browserSession, sandbox: true, contextIsolation: true,
      nodeIntegration: false, webviewTag: false, navigateOnDragDrop: false },
  });
  // On Windows hidden-title-bar construction can include fractional-DPI
  // nonclient margins. setBounds and getNormalBounds share the DIP rectangle
  // contract; apply it after native frame initialization, before showing.
  win.setBounds(bounds);
  win.removeMenu();
  installPlacement(win, root, bounds);
  // The remote page runs in its own view below the application-owned title
  // bar, so the title bar's geometry never depends on ChatGPT markup and the
  // normal control bounds never overlap page controls. Loading temporarily
  // covers the remote view using this same isolated trusted surface.
  const newChatView = () => new WebContentsView({ webPreferences: { session: browserSession,
    sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false,
    navigateOnDragDrop: false } });
  let chatView = newChatView();
  win.contentView.addChildView(chatView);
  let chat = chatView.webContents;
  let controls, shown = false, attempt = 0, deadline;
  let loaded = false, responsive = true, previousUsable = false, settled = false, navigationTarget = url;
  const show = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    if (args.includes('--start-maximized')) win.maximize();
    win.show();
  };
  function begin(target) {
    if (target) navigationTarget = target;
    attempt++; settled = false;
    previousUsable = loaded && responsive && !chat.isDestroyed() && !chat.isCrashed();
    loaded = false; responsive = true;
    clearTimeout(deadline);
    controls?.setPresentation('loading');
    const currentAttempt = attempt;
    deadline = setTimeout(() => {
      console.warn('INITIALIZATION_TIMEOUT');
      if (!win.isDestroyed() && currentAttempt === attempt && !settled) { controls.setPresentation('recovery'); show(); }
      fail(currentAttempt);
    }, 15000);
    return currentAttempt;
  }
  function finish(currentAttempt, presentation) {
    if (win.isDestroyed() || currentAttempt !== attempt || settled) return;
    settled = true; clearTimeout(deadline);
    controls.setPresentation(presentation);
    show();
  }
  async function fail(currentAttempt, unavailable = false) {
    if (win.isDestroyed() || currentAttempt !== attempt || settled) return;
    const contents = chat;
    let usable = false, probeTimer;
    if (!unavailable && loaded && responsive && !contents.isDestroyed() && !contents.isCrashed()) {
      try {
        usable = await Promise.race([
          contents.mainFrame.executeJavaScript(`(() => {
              window.__APP_MODE_CONTEXT__?.cancelReadiness?.();
              if (!document.body) return false;
              return [...document.querySelectorAll('main, [role="main"], input, button, a[href]')].some(element => {
                if (element.closest('.chatgpt-app-mode-toolbar, #app-mode-compact-sidebar, #app-mode-compact-sidebar-actions, [inert], [aria-hidden="true"]')) return false;
                const box = element.getBoundingClientRect();
                return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
              }) || document.body.innerText.trim().length > 0;
          })()`),
          new Promise(resolve => { probeTimer = setTimeout(() => resolve(false), 300); }),
        ]) === true;
      } catch { /* A failed probe is a recovery surface, never a blank reveal. */ }
      finally { clearTimeout(probeTimer); }
    }
    if (currentAttempt === attempt && !settled) controls.revokePage();
    finish(currentAttempt, usable ? 'ready' : 'recovery');
  }
  function reload() {
    if (win.isDestroyed()) return false;
    if (chat.isDestroyed()) {
      win.contentView.removeChildView(chatView);
      chatView = newChatView(); chat = chatView.webContents;
      win.contentView.addChildView(chatView, 0);
      attachChat(chat);
      controls.replaceChatView(chatView);
    }
    begin();
    // Retry only this window's existing allowed document, or its initial URL.
    const target = chat.getURL();
    if (isChatGptUrl(target) || isLoginUrl(target)) chat.reload();
    else chat.loadURL(url).catch(() => {}); // Main-frame failure events own recovery.
    return true;
  }
  controls = installWindowControls(win, chatView, { isChatGptUrl, reload, onLoaded: show });
  function attachChat(contents) {
    guardNavigation(contents);
    contents.on('page-title-updated', event => { event.preventDefault(); if (!win.isDestroyed()) win.setTitle('ChatGPT'); });
    contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (contents === chat && mainFrame && !inPlace) begin(_url);
    });
    contents.on('did-redirect-navigation', (_event, target, inPlace, mainFrame) => {
      if (contents === chat && mainFrame && !inPlace) navigationTarget = target;
    });
    contents.on('did-finish-load', async () => {
      if (win.isDestroyed() || contents !== chat || chat.isDestroyed()) return;
      loaded = true;
      const currentAttempt = attempt;
      if (isLoginUrl(chat.getURL())) { finish(currentAttempt, 'ready'); return; }
      if (!isChatGptUrl(chat.getURL())) { fail(currentAttempt, true); return; }
      const generation = navigationGenerations.get(chat);
      const current = () => !win.isDestroyed() && contents === chat && !contents.isDestroyed() &&
        currentAttempt === attempt && !settled && navigationGenerations.get(contents) === generation && isChatGptUrl(contents.getURL());
      let css, script, headerScript;
      const injected = await injectPage({
        current,
        load: () => {
          const pageCss = fs.readFileSync(path.join(sourceRoot, 'extension/styles/chatgpt-overrides.css'), 'utf8');
          const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'extension/manifest.json'), 'utf8'));
          script = manifest.content_scripts[0].js.map(file => fs.readFileSync(path.join(sourceRoot, 'extension', file), 'utf8')).join('\n');
          script = `window.__APP_MODE_COMPACT_SIDEBAR__=${JSON.stringify(config.layout?.compactSidebar !== false)};\n${script}`;
          if (fixturePath && /^\d+$/.test(process.env.APP_MODE_HOST_TEST_PORT || '')) {
            script = script.replaceAll('127.0.0.1:17863', `127.0.0.1:${process.env.APP_MODE_HOST_TEST_PORT}`);
          }
          css = pageCss + '\n' + fs.readFileSync(path.join(__dirname, 'header.css'), 'utf8');
          headerScript = fs.readFileSync(path.join(__dirname, 'header.js'), 'utf8');
        },
        css: () => chat.insertCSS(css),
        scripts: () => chat.executeJavaScript(script),
        header: () => chat.executeJavaScript(headerScript),
        navigation: async () => { if (await controls.pageReady() !== true) throw Error('not-ready'); },
        reconcile: async () => {
          if (await contents.mainFrame.executeJavaScript('window.__APP_MODE_CONTEXT__.whenReady()') !== true) throw Error('not-ready');
        },
      });
      if (current()) {
        if (injected) finish(currentAttempt, 'ready');
        else fail(currentAttempt);
      }
    });
    contents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (contents !== chat || !mainFrame || _url !== navigationTarget) return;
      if (code === -3 && previousUsable && responsive && !contents.isCrashed()) {
        const currentAttempt = attempt;
        loaded = true;
        controls.pageReady().catch(() => false).then(ready => {
          if (win.isDestroyed() || currentAttempt !== attempt || settled) return;
          if (!ready) controls.revokePage();
          finish(currentAttempt, 'ready');
        });
      } else fail(attempt, true);
    });
    for (const event of ['render-process-gone', 'unresponsive', 'destroyed']) contents.on(event, () => {
      if (contents !== chat || win.isDestroyed()) return;
      responsive = false; settled = false;
      fail(attempt, true);
    });
    contents.on('responsive', () => { if (contents === chat) responsive = true; });
  }
  attachChat(chat);
  win.once('closed', () => { attempt++; clearTimeout(deadline); });
  begin();
  chat.loadURL(url).catch(() => {}); // Failure events and the deadline are generation-bound.
  return win;
}

async function start() {
  // Only the explicitly isolated fixture harness may intercept HTTPS locally.
  fixturePath = option(process.argv, 'fixture');
  if (fixturePath) {
    const runs = path.join(sourceRoot, 'test-results', 'runs') + path.sep;
    if (process.env.APP_MODE_HOST_FIXTURE !== '1' || !root.startsWith(runs)) throw new Error('Fixture requires an isolated test root.');
  }
  if (liveReview && root !== path.join(sourceRoot, 'test-results', 'live-review-profile', 'native-host')) {
    throw new Error('Live review requires the dedicated development root.');
  }
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', (_event, argv) => {
    tryCreateWindow(createWindow, argv);
  });
  await app.whenReady();
  browserSession = session.defaultSession;
  if (liveReview || (fixturePath && !/^\d+$/.test(process.env.APP_MODE_HOST_TEST_PORT || ''))) {
    // Install before any page is created, so review cannot report private
    // session metadata to, or mutate windows through, the production server.
    browserSession.webRequest.onBeforeRequest({ urls: ['http://127.0.0.1:17863/*'] }, (_details, callback) => callback({ cancel: true }));
  }
  // Injected overrides call the loopback server from the page's main world,
  // where the site's connect-src applies. Widen it by one exact origin on the
  // trusted hosts only; every other directive stays intact.
  const controlOrigin = 'http://127.0.0.1:17863';
  browserSession.webRequest.onHeadersReceived({ urls: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] }, (details, callback) => {
    const headers = { ...(details.responseHeaders || {}) };
    const key = Object.keys(headers).find(name => name.toLowerCase() === 'content-security-policy');
    if (key) {
      headers[key] = headers[key].map(policy => allowControlOriginInCsp(policy, controlOrigin));
    }
    callback({ responseHeaders: headers });
  });
  // Automatically allow the loopback control and sanitized clipboard writes
  // only for trusted documents. Other permission prompts remain explicit.
  browserSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const trusted = isTrustedPermission(contents.getURL(), details);
    if (!trusted) { callback(false); return; }
    if (permission === 'local-network-access' || permission === 'clipboard-sanitized-write') { callback(true); return; }
    if (!['media', 'clipboard-read', 'notifications', 'fullscreen'].includes(permission)) { callback(false); return; }
    const generation = navigationGenerations.get(contents);
    dialog.showMessageBox(BrowserWindow.fromWebContents(contents), {
      type: 'question', title: 'ChatGPT permission',
      message: `Allow ChatGPT to use ${permission === 'media' ? 'your microphone or camera' : permission}?`,
      buttons: ['Deny', 'Allow'], defaultId: 0, cancelId: 0,
    }).then(result => {
      const allowed = canApplyDocumentResult({ response: result.response, contentsAlive: !contents.isDestroyed(),
        requestedGeneration: generation, currentGeneration: navigationGenerations.get(contents),
        trusted: isTrustedPermission(contents.getURL(), details) });
      if (allowed) permissionGrants.set(`${contents.id}:${permission}`, true);
      callback(allowed);
    }, () => callback(false));
  });
  browserSession.setPermissionCheckHandler((contents, permission, origin, details) =>
    Boolean(contents && isTrustedPermission(contents.getURL(), details, origin) &&
      (permission === 'local-network-access' || permission === 'clipboard-sanitized-write' ||
        permissionGrants.get(`${contents.id}:${permission}`))));
  browserSession.on('will-download', (_event, item) => {
    // Electron's native Save dialog requires the user to choose the destination;
    // never silently write a server-supplied filename into a default directory.
    item.setSaveDialogOptions({ title: 'Save ChatGPT download', defaultPath: path.basename(item.getFilename()) });
  });
  if (fixturePath) {
    const html = fs.readFileSync(fixturePath, 'utf8');
    const csp = option(process.argv, 'fixture-csp');
    // Custom protocol responses bypass Electron's webRequest response-header
    // hook, so the isolated fixture applies the same policy transform here.
    const fixtureControlOrigin = /^\d+$/.test(process.env.APP_MODE_HOST_TEST_PORT || '')
      ? `http://127.0.0.1:${process.env.APP_MODE_HOST_TEST_PORT}` : 'http://127.0.0.1:17863';
    const fixtureCsp = csp && allowControlOriginInCsp(csp, fixtureControlOrigin);
    browserSession.protocol.handle('https', request => new Response(isChatGptUrl(request.url) ? html : 'Blocked', {
      status: isChatGptUrl(request.url) ? 200 : 403,
      headers: { 'content-type': 'text/html', ...(fixtureCsp ? { 'content-security-policy': fixtureCsp } : {}) },
    }));
  }
  const firstWindow = createWindow(process.argv);
  if (liveReview) require('./review.cjs').install(firstWindow, root, sourceRoot);
}

app.on('window-all-closed', () => app.quit());
start().catch(() => { console.error('App Mode window host could not start. Check its installation and configuration.'); app.exit(1); });
