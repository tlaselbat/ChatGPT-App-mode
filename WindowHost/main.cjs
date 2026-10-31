// Remote pages run sandboxed, without Node, preload bridges, or privileged IPC.
const { app, BrowserWindow, WebContentsView, session, shell, screen, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { isChatGptUrl, isLoginUrl, isExternalUrl, hostProfile, isTrustedPermission,
  allowControlOriginInCsp, canApplyDocumentResult, tryCreateWindow } = require('./policy.cjs');
const { installBrowserShortcuts } = require('./shortcuts.cjs');
const { installWindowControls } = require('./controls-host.cjs');
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

function readConfig() {
  return JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
}

function safeBounds(args, config) {
  const size = option(args, 'window-size')?.match(/^(\d+),(\d+)$/);
  const pos = option(args, 'window-position')?.match(/^(-?\d+),(-?\d+)$/);
  const width = Math.max(390, Math.min(4096, Number(size?.[1] || config.window?.width || 1280)));
  const height = Math.max(300, Math.min(4096, Number(size?.[2] || config.window?.height || 900)));
  const candidate = { x: Number(pos?.[1] || 80), y: Number(pos?.[2] || 40), width, height };
  const area = screen.getDisplayMatching(candidate).workArea;
  candidate.width = Math.min(width, area.width);
  candidate.height = Math.min(height, area.height);
  candidate.x = Math.max(area.x, Math.min(candidate.x, area.x + area.width - candidate.width));
  candidate.y = Math.max(area.y, Math.min(candidate.y, area.y + area.height - candidate.height));
  return candidate;
}

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
  const config = readConfig();
  const requested = option(args, 'url') || config.url || 'https://chatgpt.com/';
  const url = isChatGptUrl(requested) ? requested : 'https://chatgpt.com/';
  const win = new BrowserWindow({
    ...safeBounds(args, config), minWidth: 390, minHeight: 300,
    title: 'ChatGPT', icon: path.join(sourceRoot, 'assets', 'AppMode-hex-selected.ico'),
    backgroundColor: '#212121', autoHideMenuBar: true, show: false,
    titleBarStyle: 'hidden',
    webPreferences: { session: browserSession, sandbox: true, contextIsolation: true,
      nodeIntegration: false, webviewTag: false, navigateOnDragDrop: false },
  });
  win.removeMenu();
  // The remote page runs in its own view below the application-owned title
  // bar, so the title bar's geometry never depends on ChatGPT markup and the
  // controls surface never covers page controls. Same sandbox preferences.
  const chatView = new WebContentsView({ webPreferences: { session: browserSession,
    sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false,
    navigateOnDragDrop: false } });
  win.contentView.addChildView(chatView);
  const chat = chatView.webContents;
  guardNavigation(chat);
  installWindowControls(win, chatView, { isChatGptUrl });
  chat.on('page-title-updated', event => { event.preventDefault(); win.setTitle('ChatGPT'); });
  chat.on('did-finish-load', async () => {
    if (!isChatGptUrl(chat.getURL())) return;
    try {
      // Main-process injection is restricted to exact ChatGPT origins. No API
      // is exposed to the page; these are the same unprivileged site overrides.
      const css = fs.readFileSync(path.join(sourceRoot, 'extension/styles/chatgpt-overrides.css'), 'utf8');
      let script = fs.readFileSync(path.join(sourceRoot, 'extension/scripts/chatgpt-overrides.js'), 'utf8');
      const compactSidebar = config.layout?.compactSidebar !== false;
      script = `window.__APP_MODE_COMPACT_SIDEBAR__=${JSON.stringify(compactSidebar)};\n${script}`;
      if (fixturePath && /^\d+$/.test(process.env.APP_MODE_HOST_TEST_PORT || '')) {
        script = script.replaceAll('127.0.0.1:17863', `127.0.0.1:${process.env.APP_MODE_HOST_TEST_PORT}`);
      }
      const hostCss = fs.readFileSync(path.join(__dirname, 'header.css'), 'utf8');
      await chat.insertCSS(css + '\n' + hostCss);
      await chat.executeJavaScript(script);
      await chat.executeJavaScript(fs.readFileSync(path.join(__dirname, 'header.js'), 'utf8'));
    } catch { /* The trusted controls remain available if page selectors change. */ }
  });
  let shown = false;
  const show = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    if (args.includes('--start-maximized')) win.maximize();
    win.show();
  };
  // The window's own contents stays empty; reveal when the remote view has
  // painted its first document rather than the blank fallback.
  chat.once('did-finish-load', show);
  chat.once('did-fail-load', show);
  chat.loadURL(url).catch(() => {
    // Never log navigation URLs, titles, or page content.
    show();
  });
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
  if (liveReview) {
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
