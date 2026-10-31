const { BrowserWindow, WebContentsView, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');

const ACTION_CHANNEL = 'app-mode-controls:action';
const STATE_CHANNEL = 'app-mode-controls:state';
const ACTIONS = new Set(['minimize', 'maximize', 'restore', 'close']);
const CONTROLS_WIDTH = 108;
const COMPACT_CONTROLS_WIDTH = 96;
const COMPACT_BREAKPOINT = 480;
const HEADER_HEIGHT = 48;
const EDGE_INSET = 10;
const DEFAULT_THEME = Object.freeze({ color: 'rgb(221, 221, 221)', border: 'rgba(221, 221, 221, 0.24)',
  background: '#1c1f26', hover: '#2a2f3a', hoverBorder: '#4f5d7a', pressed: '#3a4050' });

function trustedControlSender(event, { win, view, controlsUrl }) {
  try {
    if (win.isDestroyed() || view.webContents.isDestroyed()) return false;
    const contents = view.webContents;
    // The exact local main frame must still belong to this window. A subframe,
    // stale navigation, detached view or another window cannot reuse the bridge.
    return event.sender === contents && event.senderFrame === contents.mainFrame &&
      event.senderFrame?.url === controlsUrl && contents.getURL() === controlsUrl &&
      BrowserWindow.fromWebContents(contents) === win && win.contentView.children.includes(view);
  } catch { return false; } // A frame can be disposed while IPC is in flight.
}

function validateControlRequest(event, args, context) {
  return Array.isArray(args) && args.length === 1 && typeof args[0] === 'string' && ACTIONS.has(args[0]) && trustedControlSender(event, context);
}

// An isolated, unprivileged world observes visual styling only. Its pending
// promise resolves on a theme/viewport change, so no caption polling or remote
// IPC bridge is needed. No page text, labels, URLs or conversation data is read.
function observeVisualTheme(previous) {
  return new Promise(resolve => {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;border:1px solid var(--app-mode-control-border);background:var(--app-mode-control-bg);';
    let header;
    let toolbar;
    let frame;
    let finished = false;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const observer = new MutationObserver(records => {
      // Our color-resolution probe must never sustain its own RAF loop.
      if (records.every(record => record.target === probe || (record.type === 'childList' &&
        [...record.addedNodes, ...record.removedNodes].every(node => node === probe)))) return;
      if (!frame) frame = requestAnimationFrame(sample);
    });
    function finish(result) {
      if (finished) return;
      finished = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', sample);
      window.visualViewport?.removeEventListener('resize', sample);
      window.removeEventListener('pagehide', unload);
      document.removeEventListener('transitionend', sample, true);
      media.removeEventListener('change', sample);
      probe.remove();
      resolve(result);
    }
    function unload() { finish(null); }
    function sample() {
      frame = 0;
      if (!document.body) return;
      if (!toolbar?.isConnected) toolbar = document.querySelector('.chatgpt-app-mode-toolbar');
      header = toolbar?.parentElement || document.body;
      if (probe.parentElement !== header) header.append(probe);
      probe.style.color = getComputedStyle(header).color;
      const style = getComputedStyle(probe);
      const theme = { color: style.color, border: style.borderTopColor, background: style.backgroundColor };
      probe.style.background = 'var(--app-mode-control-hover)';
      theme.hover = getComputedStyle(probe).backgroundColor;
      probe.style.borderColor = 'var(--app-mode-control-hover-border)';
      theme.hoverBorder = getComputedStyle(probe).borderTopColor;
      probe.style.borderColor = 'var(--app-mode-control-border)';
      probe.style.background = 'var(--app-mode-control-pressed)';
      theme.pressed = getComputedStyle(probe).backgroundColor;
      probe.style.background = 'var(--app-mode-control-bg)';
      const result = { theme, width: innerWidth, height: innerHeight, scale: devicePixelRatio };
      if (JSON.stringify(result) !== previous) finish(result);
    }
    // Themes are inherited through html/body/header classes and styles; head
    // changes also cover custom stylesheets. Child changes catch header rerenders.
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style'] });
    window.addEventListener('resize', sample);
    window.visualViewport?.addEventListener('resize', sample);
    window.addEventListener('pagehide', unload, { once: true });
    document.addEventListener('transitionend', sample, true);
    media.addEventListener('change', sample);
    sample();
  });
}

function installWindowControls(win, { isChatGptUrl }) {
  const controlsUrl = pathToFileURL(path.join(__dirname, 'controls.html')).href;
  const controlSession = session.fromPartition(`app-mode-controls-${randomUUID()}`);
  const allowedResources = new Set(['controls.html', 'controls.css', 'controls.js'].map(name => pathToFileURL(path.join(__dirname, name)).href));
  controlSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  controlSession.setPermissionCheckHandler(() => false);
  controlSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowedResources.has(details.url) }));
  const view = new WebContentsView({ webPreferences: { session: controlSession,
    preload: path.join(__dirname, 'controls-preload.cjs'), sandbox: true, contextIsolation: true,
    nodeIntegration: false, webviewTag: false, navigateOnDragDrop: false, devTools: false } });
  const contents = view.webContents;
  view.setBackgroundColor('#00000000');
  win.contentView.addChildView(view);
  contents.setZoomMode('isolated');
  let disposed = false;
  let loaded = false;
  let theme = DEFAULT_THEME;
  let generation = 0;
  const context = { win, view, controlsUrl };
  // Match the remote header's CSS breakpoint rather than the controls view's
  // own (always narrow) viewport. Both surfaces share the page's zoom factor.
  const compact = () => win.getContentBounds().width / win.webContents.getZoomFactor() <= COMPACT_BREAKPOINT;
  const state = () => ({ maximized: win.isMaximized(), fullscreen: win.isFullScreen(), compact: compact(), theme });
  function publish() {
    if (!disposed && loaded && !win.isDestroyed() && !contents.isDestroyed()) contents.send(STATE_CHANNEL, state());
  }
  function layout() {
    if (disposed || win.isDestroyed() || contents.isDestroyed()) return;
    const zoom = win.webContents.getZoomFactor();
    const { width } = win.getContentBounds();
    contents.setZoomFactor(zoom);
    const controlsWidth = Math.round((compact() ? COMPACT_CONTROLS_WIDTH : CONTROLS_WIDTH) * zoom);
    view.setBounds({ x: Math.max(0, width - controlsWidth - Math.round(EDGE_INSET * zoom)), y: 0,
      width: controlsWidth, height: Math.round(HEADER_HEIGHT * zoom) });
    view.setVisible(!win.isFullScreen());
    publish();
  }
  contents.ipc.handle(ACTION_CHANNEL, (event, ...args) => {
    if (disposed || !loaded || !validateControlRequest(event, args, context)) return false;
    // Native caption buttons do not leave browser accelerators or the page's
    // pin shortcut focused in a separate UI. Focus before minimize, so this
    // never restores a window that has just been minimized.
    if (args[0] !== 'close') win.webContents.focus();
    switch (args[0]) {
      case 'minimize': win.minimize(); break;
      case 'maximize': if (!win.isFullScreen()) win.maximize(); break;
      case 'restore': if (!win.isFullScreen()) win.unmaximize(); break;
      case 'close': win.close(); break;
    }
    publish();
    return true;
  });
  contents.ipc.handle(STATE_CHANNEL, (event, ...args) => {
    if (disposed || !loaded || args.length || !trustedControlSender(event, context)) return null;
    return state();
  });
  // Navigation is never part of this local UI. Request filtering remains in
  // force even for programmatic navigations that bypass will-navigate.
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
    contents.on(name, event => event.preventDefault());
  }
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // A rejected provisional navigation keeps the original trusted document.
  // Do not revoke it on did-start-navigation: a denied request may never emit
  // did-finish-load. Exact current URL/main-frame checks reject any committed
  // replacement, and loaded only gates initial controls initialization.
  contents.on('did-finish-load', () => { loaded = contents.getURL() === controlsUrl; layout(); });
  const nativeEvents = ['maximize', 'unmaximize', 'restore', 'resize', 'enter-full-screen', 'leave-full-screen'];
  for (const name of nativeEvents) win.on(name, layout);
  // Keyboard zoom handling occurs in another host listener; defer until it
  // has applied the new factor. Renderer viewport events cover programmatic zoom.
  const afterZoom = () => setImmediate(layout);
  const afterInput = (_event, input) => {
    if (input.type === 'keyDown' && input.control &&
      ['+', '=', '-', '0', 'Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'Digit0', 'Numpad0'].some(key => key === input.key || key === input.code)) afterZoom();
  };
  win.webContents.on('before-input-event', afterInput);
  win.webContents.on('zoom-changed', afterZoom);
  const navigating = (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) generation++; };
  win.webContents.on('did-start-navigation', navigating);
  async function observeTheme() {
    const current = ++generation;
    let previous = '';
    while (!disposed && !win.isDestroyed() && current === generation && isChatGptUrl(win.webContents.getURL())) {
      try {
        const value = await win.webContents.executeJavaScriptInIsolatedWorld(998, [{ code: `(${observeVisualTheme.toString()})(${JSON.stringify(previous)})` }]);
        if (!value || disposed || win.isDestroyed() || current !== generation) return;
        // Only browser-resolved numeric colors cross into the trusted UI.
        // CSS functions, URLs, selectors and arbitrary strings are rejected.
        const validColor = color => typeof color === 'string' && color.length <= 160 &&
          /^(?:(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((?:[\d\s.,%/+eE-]|none)+\)|color\((?:srgb(?:-linear)?|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz(?:-d50|-d65)?)\s+(?:[\d\s.,%/+eE-]|none)+\))$/.test(color);
        if (value.theme && Object.keys(DEFAULT_THEME).every(key => validColor(value.theme[key]))) {
          theme = Object.fromEntries(Object.keys(DEFAULT_THEME).map(key => [key, value.theme[key]]));
        }
        previous = JSON.stringify(value);
        layout();
      } catch { return; }
    }
  }
  win.webContents.on('did-finish-load', observeTheme);
  win.once('closed', () => {
    disposed = true;
    generation++;
    for (const name of nativeEvents) win.removeListener(name, layout);
    if (!contents.isDestroyed()) {
      contents.ipc.removeHandler(ACTION_CHANNEL);
      contents.ipc.removeHandler(STATE_CHANNEL);
      contents.close({ waitForBeforeUnload: false });
    }
  });
  layout();
  contents.loadURL(controlsUrl).catch(() => {});
  return view;
}

module.exports = { installWindowControls, validateControlRequest, ACTION_CHANNEL, STATE_CHANNEL };
