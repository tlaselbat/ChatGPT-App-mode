const { BrowserWindow, WebContentsView, session, screen, nativeTheme } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');

const ACTION_CHANNEL = 'app-mode-controls:action';
const STATE_CHANNEL = 'app-mode-controls:state';
const ACTIONS = new Set(['minimize', 'maximize', 'restore', 'close', 'pin', 'reload']);
const NAVIGATION_ACTIONS = new Set(['toggle-sidebar', 'open-search']);
const EMPTY_NAVIGATION = Object.freeze({ state: 'unavailable', toggle: false, search: false, searchActive: false, blocked: false, identity: false });
// Native DIP geometry is independent of the remote page's CSS zoom.
const HEADER_HEIGHT = 40;
const DEFAULT_THEME = Object.freeze({ color: 'rgb(221, 221, 221)', border: 'rgba(221, 221, 221, 0.24)',
  background: '#212121', hover: '#303030', hoverBorder: '#666666', pressed: '#404040', accent: 'rgb(221, 221, 221)' });

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
  return Array.isArray(args) && args.length === 1 && typeof args[0] === 'string' && (ACTIONS.has(args[0]) || NAVIGATION_ACTIONS.has(args[0])) && trustedControlSender(event, context);
}

// An isolated, unprivileged world observes visual styling only. Its pending
// promise resolves on a theme/viewport change, so no caption polling or remote
// IPC bridge is needed. No page text, labels, URLs or conversation data is read.
function observeVisualTheme(previous) {
  return new Promise(resolve => {
    const probe = document.createElement('span');
    probe.setAttribute('data-app-mode-theme-probe', '');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;border:1px solid var(--app-mode-control-border, var(--color-border-primary-outline, currentColor));background:var(--app-mode-titlebar-bg, var(--color-surface-secondary, Canvas));';
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
      probe.style.background = 'var(--app-mode-control-hover, var(--color-background-primary-surface, color-mix(in srgb, currentColor 8%, Canvas)))';
      theme.hover = getComputedStyle(probe).backgroundColor;
      probe.style.borderColor = 'var(--app-mode-control-hover-border, var(--color-border-primary-outline, currentColor))';
      theme.hoverBorder = getComputedStyle(probe).borderTopColor;
      probe.style.borderColor = 'var(--app-mode-control-border, var(--color-border-primary-outline, currentColor))';
      probe.style.background = 'var(--app-mode-control-pressed, color-mix(in srgb, currentColor 14%, Canvas))';
      theme.pressed = getComputedStyle(probe).backgroundColor;
      probe.style.background = 'var(--app-mode-accent, var(--app-color-icon-accent, currentColor))';
      theme.accent = getComputedStyle(probe).backgroundColor;
      probe.style.background = 'var(--app-mode-titlebar-bg, var(--color-surface-secondary, Canvas))';
      let navigation = null;
      const status = document.body.getAttribute('data-app-mode-host-navigation');
      if (status && status.length <= 256) { try { navigation = JSON.parse(status); } catch {} }
      const result = { theme, navigation, width: innerWidth, height: innerHeight, scale: devicePixelRatio };
      if (JSON.stringify(result) !== previous) finish(result);
    }
    // Themes are inherited through html/body/header classes and styles; head
    // changes also cover custom stylesheets. Child changes catch header rerenders.
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-app-mode-host-navigation'] });
    window.addEventListener('resize', sample);
    window.visualViewport?.addEventListener('resize', sample);
    window.addEventListener('pagehide', unload, { once: true });
    document.addEventListener('transitionend', sample, true);
    media.addEventListener('change', sample);
    sample();
  });
}

function installWindowControls(win, chatView, { isChatGptUrl, reload = () => false, onLoaded = () => {} }) {
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
  // Native backing is opaque even before the local document's first paint.
  view.setBackgroundColor('#212121');
  win.contentView.addChildView(view);
  contents.setZoomMode('isolated');
  let disposed = false;
  let loaded = false;
  let theme = nativeTheme?.shouldUseDarkColors === false ? { ...DEFAULT_THEME,
    color: 'rgb(23, 23, 23)', background: 'rgb(244, 244, 244)', border: 'rgba(23, 23, 23, 0.24)',
    hover: 'rgb(225, 225, 225)', hoverBorder: 'rgb(150, 150, 150)', pressed: 'rgb(210, 210, 210)', accent: 'rgb(23, 23, 23)' } : DEFAULT_THEME;
  let generation = 0;
  let navigation = EMPTY_NAVIGATION;
  let pageReady = false;
  let navigationPending = false;
  let ownership = null;
  let presentation = 'loading';
  let recoveryFocus = false;
  function syncOwnership() {
    const visible = loaded && !disposed && !win.isDestroyed() && !win.isFullScreen();
    if (!pageReady || chat.isDestroyed() || !isChatGptUrl(chat.getURL()) || ownership === visible) return;
    ownership = visible;
    chat.mainFrame.executeJavaScript(`(() => {
      const c = window.__APP_MODE_CONTEXT__;
      if (c?.hostNavigation) { c.hostNavigation.visible = ${JSON.stringify(visible)}; c.navigationController.schedule(); }
    })()`).catch(() => {});
  }
  const context = { win, view, controlsUrl };
  let chat = chatView.webContents;
  const state = () => ({ maximized: win.isMaximized(), fullscreen: win.isFullScreen(), presentation,
    pinned: win.isAlwaysOnTop(), theme, navigation: pageReady && presentation === 'ready' ? navigation : EMPTY_NAVIGATION });
  let lastPublished = '';
  let lastLayout = '';
  function publish() {
    if (disposed || !loaded || win.isDestroyed() || contents.isDestroyed()) return;
    const value = state();
    const serialized = JSON.stringify(value);
    if (serialized === lastPublished) return;
    lastPublished = serialized;
    contents.send(STATE_CHANNEL, value);
  }
  function layout() {
    if (disposed || win.isDestroyed() || contents.isDestroyed()) return;
    const { width, height } = win.getContentBounds();
    if (contents.getZoomFactor() !== 1) contents.setZoomFactor(1);
    const fullscreen = win.isFullScreen();
    const bar = fullscreen ? 0 : Math.min(HEADER_HEIGHT, height);
    const covering = presentation !== 'ready';
    const geometry = JSON.stringify([width, height, fullscreen, covering]);
    if (geometry !== lastLayout) {
      lastLayout = geometry;
      view.setBounds({ x: 0, y: 0, width, height: covering ? height : bar });
      chatView.setBounds({ x: 0, y: bar, width, height: Math.max(0, height - bar) });
      view.setVisible(covering || !fullscreen);
    }
    syncOwnership();
    publish();
  }
  contents.ipc.handle(ACTION_CHANNEL, async (event, ...args) => {
    if (disposed || !loaded || !validateControlRequest(event, args, context)) return false;
    const action = args[0];
    if (action === 'reload') return presentation === 'recovery' && reload() === true;
    if (NAVIGATION_ACTIONS.has(action)) {
      if (presentation !== 'ready' || !pageReady || navigationPending || chat.isDestroyed() || !isChatGptUrl(chat.getURL()) ||
          !win.contentView.children.includes(chatView)) return false;
      const current = generation;
      const frame = chat.mainFrame;
      navigationPending = true;
      try {
        chat.focus();
        let timer;
        try {
          const result = await Promise.race([
            frame.executeJavaScript(`window.__APP_MODE_CONTEXT__?.hostNavigation?.run(${JSON.stringify(action)})`),
            new Promise(resolve => { timer = setTimeout(() => resolve(false), 6000); }),
          ]);
          return !disposed && current === generation && result === true;
        } finally { clearTimeout(timer); }
      } catch { return false; }
      finally { if (current === generation) navigationPending = false; }
    }
    // Native caption buttons do not leave browser accelerators or the page's
    // pin shortcut focused in a separate UI. Focus before minimize, so this
    // never restores a window that has just been minimized.
    if (args[0] !== 'close' && !chat.isDestroyed() && presentation === 'ready') chat.focus();
    switch (args[0]) {
      case 'minimize': win.minimize(); break;
      case 'maximize': if (!win.isFullScreen()) win.maximize(); break;
      case 'restore': if (!win.isFullScreen()) win.unmaximize(); break;
      case 'close': win.close(); break;
      case 'pin': win.setAlwaysOnTop(!win.isAlwaysOnTop()); break;
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
  contents.on('did-finish-load', () => { loaded = contents.getURL() === controlsUrl; lastPublished = ''; layout(); if (loaded) onLoaded(); });
  const controlsUnavailable = () => { loaded = false; syncOwnership(); };
  contents.on('render-process-gone', controlsUnavailable);
  contents.on('destroyed', controlsUnavailable);
  const nativeEvents = ['maximize', 'unmaximize', 'restore', 'resize', 'enter-full-screen', 'leave-full-screen', 'always-on-top-changed'];
  for (const name of nativeEvents) win.on(name, layout);
  screen.on('display-metrics-changed', layout);
  win.on('move', layout);
  // Keyboard zoom handling occurs in another host listener; defer until it
  // has applied the new factor. Renderer viewport events cover programmatic zoom.
  const afterZoom = () => setImmediate(layout);
  const afterInput = (_event, input) => {
    if (input.type === 'keyDown' && input.control &&
      ['+', '=', '-', '0', 'Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'Digit0', 'Numpad0'].some(key => key === input.key || key === input.code)) afterZoom();
  };
  const navigating = (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) { generation++; pageReady = false; navigationPending = false; ownership = null; navigation = EMPTY_NAVIGATION; publish(); }
  };
  async function observeTheme() {
    const current = ++generation;
    const observedChat = chat;
    let previous = '';
    while (!disposed && !win.isDestroyed() && !observedChat.isDestroyed() && current === generation && isChatGptUrl(observedChat.getURL())) {
      try {
        const value = await observedChat.executeJavaScriptInIsolatedWorld(998, [{ code: `(${observeVisualTheme.toString()})(${JSON.stringify(previous)})` }]);
        if (!value || disposed || win.isDestroyed() || current !== generation) return;
        // Only browser-resolved numeric colors cross into the trusted UI.
        // CSS functions, URLs, selectors and arbitrary strings are rejected.
        const validColor = color => typeof color === 'string' && color.length <= 160 &&
          /^(?:(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((?:[\d\s.,%/+eE-]|none)+\)|color\((?:srgb(?:-linear)?|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz(?:-d50|-d65)?)\s+(?:[\d\s.,%/+eE-]|none)+\))$/.test(color);
        if (value.theme && Object.keys(DEFAULT_THEME).every(key => validColor(value.theme[key]))) {
          theme = Object.fromEntries(Object.keys(DEFAULT_THEME).map(key => [key, value.theme[key]]));
        }
        const next = value.navigation;
        const focusAction = navigation.searchActive && next?.searchActive !== true && !next?.blocked ? 'open-search' :
          navigation.state === 'drawer' && next?.state === 'compact' && next.toggle === true ? 'toggle-sidebar' :
          navigation.blocked && next?.search === true ? 'open-search' : null;
        if (focusAction && !next.blocked && win.isFocused() && chat.isFocused()) {
          const needsFocus = await chat.mainFrame.executeJavaScript(`(() => {
            const active = document.activeElement;
            return active === document.body || !active?.getClientRects().length || getComputedStyle(active).visibility === 'hidden' || !!active.closest('[inert], [aria-hidden="true"]');
          })()`);
          if (disposed || current !== generation || win.isDestroyed()) return;
          if (needsFocus === true && current === generation && loaded && win.isFocused() && chat.isFocused()) {
            if (focusAction === 'open-search') {
              chat.mainFrame.executeJavaScript('window.__APP_MODE_CONTEXT__?.focusSidebarSearch?.()').catch(() => {});
            } else {
              contents.focus();
              contents.executeJavaScript("requestAnimationFrame(() => document.querySelector('[data-action=\"toggle-sidebar\"]:not([hidden]):not(:disabled)')?.focus())").catch(() => {});
            }
          }
        }
        navigation = next && ['compact', 'docked', 'drawer', 'unavailable'].includes(next.state) &&
          ['toggle', 'search', 'blocked'].every(key => typeof next[key] === 'boolean') ?
          { state: next.state, toggle: next.toggle, search: next.search, searchActive: next.searchActive === true,
            blocked: next.blocked, identity: next.identity === true } : EMPTY_NAVIGATION;
        previous = JSON.stringify(value);
        publish();
      } catch {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  function bindChat(remove = false) {
    for (const [event, listener] of [['before-input-event', afterInput], ['zoom-changed', afterZoom],
      ['did-start-navigation', navigating], ['did-finish-load', observeTheme]]) {
      if (remove) chat.removeListener(event, listener); else chat.on(event, listener);
    }
  }
  bindChat();
  win.once('closed', () => {
    disposed = true;
    generation++;
    for (const name of nativeEvents) win.removeListener(name, layout);
    screen.removeListener('display-metrics-changed', layout);
    win.removeListener('move', layout);
    bindChat(true);
    if (!contents.isDestroyed()) {
      contents.ipc.removeHandler(ACTION_CHANNEL);
      contents.ipc.removeHandler(STATE_CHANNEL);
      contents.close({ waitForBeforeUnload: false });
    }
  });
  layout();
  contents.loadURL(controlsUrl).catch(() => {});
  return { view, setPresentation(value) {
    if (!['loading', 'ready', 'recovery'].includes(value) || disposed) return;
    presentation = value;
    if (value !== 'ready') { pageReady = false; navigation = EMPTY_NAVIGATION; }
    if (value === 'recovery' && loaded && win.isFocused()) { recoveryFocus = true; contents.focus(); }
    if (value === 'ready' && recoveryFocus) {
      recoveryFocus = false;
      if (win.isFocused() && contents.isFocused() && !chat.isDestroyed()) chat.focus();
    }
    layout();
  }, revokePage() {
    if (!chat.isDestroyed()) chat.mainFrame.executeJavaScript(`(() => {
      const c = window.__APP_MODE_CONTEXT__;
      if (c?.hostNavigation) { c.hostNavigation.ready = false; c.hostNavigation.visible = false; c.navigationController.schedule(); }
    })()`).catch(() => {});
    pageReady = false; ownership = null; navigation = EMPTY_NAVIGATION; publish();
  }, replaceChatView(next) {
    bindChat(true); generation++; pageReady = false; ownership = null; navigationPending = false;
    chatView = next; chat = next.webContents; bindChat(); lastLayout = ''; layout();
  }, async pageReady() {
    if (disposed || chat.isDestroyed() || !isChatGptUrl(chat.getURL())) return false;
    const current = generation;
    const ready = await chat.mainFrame.executeJavaScript(`(() => {
      const navigation = window.__APP_MODE_CONTEXT__?.hostNavigation;
      if (!navigation) return false;
      navigation.ready = true;
      navigation.publish();
      return true;
    })()`);
    if (disposed || current !== generation) return false;
    pageReady = ready === true;
    syncOwnership();
    publish();
    return pageReady;
  } };
}

module.exports = { installWindowControls, validateControlRequest, ACTION_CHANNEL, STATE_CHANNEL };
