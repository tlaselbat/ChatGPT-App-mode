// Chromium chooses native tab order. Only reaching a document edge asks the
// owning host to move between views; remote content receives no IPC bridge.
const WORLD = 997;
function observeBoundary(trusted) {
  const key = '__appModeKeyboardBoundary';
  if (!globalThis[key]) {
    const guards = [document.createElement('span'), document.createElement('span')];
    let waiter, queued = null, entering = false, lastTab = null;
    // Observe direction without cancelling or forwarding ordinary key events.
    const keydown = event => { lastTab = event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey ? event.shiftKey : null; };
    document.addEventListener('keydown', keydown, true);
    const blocked = () => !!document.fullscreenElement ||
      (trusted && (document.body.dataset.presentation !== 'ready' || document.body.dataset.fullscreen === 'true')) ||
      [...document.querySelectorAll('[aria-modal="true"], [role="menu"], [role="listbox"], dialog:modal')]
        .some(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
    const update = () => {
      if (!document.body) return;
      if (document.body.firstChild !== guards[0]) document.body.prepend(guards[0]);
      if (document.body.lastChild !== guards[1]) document.body.append(guards[1]);
      const enabled = !blocked();
      guards.forEach((g, i) => {
        // The leading guard precedes native positive tabindex values too.
        const index = enabled ? (i ? 0 : 1) : -1;
        if (g.tabIndex !== index) g.tabIndex = index;
      });
    };
    guards.forEach((g, i) => {
      g.setAttribute('role', 'group'); g.setAttribute('aria-label', trusted ? 'ChatGPT content' : 'Window controls');
      g.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;';
      g.addEventListener('focus', () => {
        if (entering || blocked()) return;
        const edge = { index: i, reverse: lastTab ?? i === 0 };
        if (waiter) { const done = waiter; waiter = null; done(edge); }
        else queued = edge;
      });
    });
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden', 'aria-modal', 'open', 'data-presentation', 'data-fullscreen'] });
    const dispose = () => {
      observer.disconnect(); guards.forEach(g => g.remove());
      document.removeEventListener('keydown', keydown, true);
      if (waiter) waiter(null); delete globalThis[key];
      window.removeEventListener('pagehide', dispose);
    };
    globalThis[key] = {
      wait: () => new Promise(resolve => {
        // A retained document can start a newer watcher without pagehide.
        if (waiter) { waiter(null); waiter = null; }
        if (queued !== null) { const value = queued; queued = null; resolve(value); }
        else waiter = resolve;
      }),
      enter(reverse, expectedEdge) {
        update(); if (blocked()) return false;
        if (expectedEdge !== undefined && !this.atBoundary(expectedEdge)) return false;
        entering = true;
        try { guards[reverse ? 1 : 0].focus({ preventScroll: true }); }
        finally { entering = false; }
        return guards.includes(document.activeElement);
      },
      atBoundary: index => !blocked() && document.activeElement === guards[index],
      dispose,
    };
    window.addEventListener('pagehide', dispose, { once: true });
    update();
  }
  return globalThis[key].wait();
}

function installKeyboardTraversal(win, controls, initialRemote, canTraverse) {
  let remote = initialRemote, disposed = false;
  const bindings = new Map();
  const run = (contents, code) => contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]);
  const alive = view => {
    try { return !disposed && !win.isDestroyed() && !view.webContents.isDestroyed() && win.contentView.children.includes(view); }
    catch { return false; }
  };
  async function watch(view, trusted, token) {
    const contents = view.webContents;
    while (alive(view) && bindings.get(view)?.token === token) {
      let edge;
      try { edge = await run(contents, `(${observeBoundary.toString()})(${trusted})`); }
      catch { return; }
      if (!edge || typeof edge.reverse !== 'boolean' || ![0, 1].includes(edge.index) || !alive(view) || bindings.get(view)?.token !== token) return;
      const { reverse, index } = edge;
      if (!win.isFocused() || !contents.isFocused()) continue;
      const destination = trusted ? remote : controls;
      // Covered/loading, fullscreen, modal and stale views never transfer out.
      // If a host guard rejects a handoff, retain ordinary same-document wrap.
      // The first Tab from BODY can hit the leading guard in forward order:
      // continue locally instead of treating that as a reverse boundary exit.
      let target = index === (reverse ? 0 : 1) && canTraverse() && alive(destination) ? destination : view;
      let targetToken = bindings.get(target)?.token;
      try {
        if (await run(contents, `globalThis.__appModeKeyboardBoundary?.atBoundary(${index}) === true`) !== true) continue;
        let prepared = await run(target.webContents, `globalThis.__appModeKeyboardBoundary?.enter(${reverse}, ${target === view ? index : 'undefined'}) === true`);
        if (!prepared && target !== view) {
          // A just-opened native modal can precede the host's state update.
          target = view; targetToken = token;
          prepared = await run(contents, `globalThis.__appModeKeyboardBoundary?.enter(${reverse}, ${index}) === true`);
        }
        const stillAtBoundary = target === view || await run(contents, `globalThis.__appModeKeyboardBoundary?.atBoundary(${index}) === true`);
        if (!prepared || !stillAtBoundary || !alive(view) || !alive(target) || bindings.get(view)?.token !== token ||
            bindings.get(target)?.token !== targetToken || !win.isFocused() || !contents.isFocused()) continue;
        if (target !== view && !canTraverse()) continue;
        target.webContents.focus();
        const modifiers = reverse ? ['shift'] : [];
        target.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers });
        target.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers });
      } catch { /* A navigating/destroyed renderer cannot authorize another view. */ }
    }
  }
  function bind(view, trusted) {
    const contents = view.webContents;
    const binding = { token: 0 };
    const loaded = () => { const token = ++binding.token; watch(view, trusted, token); };
    const navigating = (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) binding.token++; };
    binding.remove = () => {
      binding.token++;
      contents.removeListener('did-finish-load', loaded);
      contents.removeListener('did-start-navigation', navigating);
      if (!contents.isDestroyed()) run(contents, 'globalThis.__appModeKeyboardBoundary?.dispose()').catch(() => {});
      bindings.delete(view);
    };
    bindings.set(view, binding);
    view.webContents.on('did-finish-load', loaded);
    view.webContents.on('did-start-navigation', navigating);
    if (!view.webContents.isLoadingMainFrame() && view.webContents.getURL()) loaded();
  }
  bind(controls, true); bind(remote, false);
  return {
    replaceRemote(next) { bindings.get(remote)?.remove(); remote = next; bind(remote, false); },
    dispose() { disposed = true; for (const binding of [...bindings.values()]) binding.remove(); },
  };
}
module.exports = { installKeyboardTraversal };
