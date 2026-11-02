/* Shared App Mode content-script context; classic script, ordered by manifest and Electron host. */
(() => {
  const c = window.__APP_MODE_CONTEXT__;
  if (!c || !c.initialized || c.reinjection) return;
  with (c) {
  c.nativeSidebarControl = function nativeSidebarControl(label, { interactive = true } = {}) {
    return [...document.querySelectorAll('button, a, [role="button"]')].find(element =>
      !element.closest('#app-mode-compact-sidebar-actions, #app-mode-compact-sidebar') &&
      (!interactive || !element.closest('[aria-hidden="true"], [inert]')) &&
      (element.hasAttribute('data-app-mode-sidebar-original') || element.getClientRects().length) &&
      label.test(accessibleName(element) || element.textContent.trim()));
  }

  c.waitForNavigation = function waitForNavigation(predicate, timeoutMs = 2500) {
    return new Promise(resolve => {
      const finish = value => {
        observer.disconnect(); clearTimeout(timer);
        document.removeEventListener('transitionend', check, true);
        document.removeEventListener('animationend', check, true);
        resolve(value);
      };
      const check = () => { const value = predicate(); if (value) finish(value); };
      const observer = new MutationObserver(check);
      const timer = setTimeout(() => finish(predicate() || null), timeoutMs);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      document.addEventListener('transitionend', check, true);
      document.addEventListener('animationend', check, true);
      check();
    });
  }

  c.restoreTemporarySearchDrawer = function restoreTemporarySearchDrawer(root, drawer) {
    const existing = new Set([...document.querySelectorAll('[role="dialog"]')].filter(element =>
      element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden'));
    let search = null;
    const stop = () => {
      observer.disconnect(); clearTimeout(timer);
      if (navigationController.cancelShortcut === stop) navigationController.cancelShortcut = null;
    };
    const check = () => {
      if (!root.isConnected || !drawer.isConnected || navigationAdapter.read().root !== root) { stop(); return; }
      if (!search) {
        search = [...document.querySelectorAll('[role="dialog"]')].find(element =>
          element !== drawer && !existing.has(element) && element.querySelector('input') && element.getClientRects().length);
        if (search) clearTimeout(timer);
        return;
      }
      if (search.isConnected && search.getClientRects().length && getComputedStyle(search).visibility !== 'hidden') return;
      const close = navigationAdapter.find(/^(hide|close) sidebar$/i);
      if (close && drawer.contains(close) && navigationAdapter.read().state === 'drawer' && !navigationAdapter.read().blocked) {
        stop(); close.click();
      }
    };
    const observer = new MutationObserver(check);
    const timer = setTimeout(stop, 3000);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    navigationController.cancelShortcut = stop;
  }

  c.runSidebarAction = async function runSidebarAction(label) {
    navigationController.cancelShortcut?.();
    const root = navigationAdapter.read().root;
    let temporaryDrawer = null;
    let target = nativeSidebarControl(label);
    if (!target) {
      if (navigationAdapter.read().state !== 'compact' || !await navigationAdapter.toggle()) return false;
      temporaryDrawer = navigationAdapter.read().drawer;
      target = await waitForNavigation(() => nativeSidebarControl(label));
    }
    if (!target?.isConnected || root !== navigationAdapter.read().root) return false;
    if (temporaryDrawer && label.test('Search')) restoreTemporarySearchDrawer(root, temporaryDrawer);
    if (target?.getAttribute('aria-haspopup') === 'menu') {
      target.focus();
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    } else target?.click();
    return true;
  }

  // All assumptions about native sidebar markup and activation live here.
  navigationAdapter = {
    find: nativeSidebarControl,
    activate: runSidebarAction,
    sidebarOverlay(drawer) {
      if (!drawer) return null;
      const candidates = [...drawer.parentElement.children].filter(element =>
        element.matches('.codex-dialog-overlay[aria-hidden="true"]'));
      if (candidates.length !== 1) return null;
      const overlay = candidates[0];
      const marker = 'data-app-mode-sidebar-overlay';
      const owned = overlay.hasAttribute(marker);
      // Read the native rule again on every existing lifecycle pass. Removing
      // this unobserved marker synchronously avoids stale colors after themes
      // change, without painting an intermediate frame or adding observers.
      if (owned) overlay.removeAttribute(marker);
      try {
        const style = getComputedStyle(overlay);
        const box = overlay.getBoundingClientRect();
        if (style.position !== 'fixed' || style.visibility !== 'visible' ||
            style.transform !== 'none' || style.backgroundImage !== 'none' ||
            style.backdropFilter !== 'none' || box.width <= 0 || box.height <= 0 ||
            [box.left, box.top, box.right - innerWidth, box.bottom - innerHeight].some(value => Math.abs(value) > 1)) return null;
        for (let ancestor = overlay.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const parentStyle = getComputedStyle(ancestor);
          if (parentStyle.transform !== 'none' || parentStyle.perspective !== 'none' ||
              parentStyle.filter !== 'none' || /(?:layout|paint|strict|content)/.test(parentStyle.contain) ||
              /(?:transform|perspective|filter)/.test(parentStyle.willChange)) return null;
        }
        const color = style.backgroundColor;
        if (!CSS.supports('color', color) || color === 'transparent') return null;
        const slashAlpha = color.match(/\/\s*([\d.]+)(%)?\s*\)$/);
        const commaAlpha = color.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/);
        const alpha = slashAlpha ? Number(slashAlpha[1]) / (slashAlpha[2] ? 100 : 1) : commaAlpha ? Number(commaAlpha[1]) : 1;
        if (!(alpha > 0)) return null;
        // Keep the scrim above background header controls, including when a
        // second modal is stacked above this sidebar portal.
        const stack = document.elementsFromPoint(innerWidth / 2, 20);
        const overlayIndex = stack.indexOf(overlay);
        const headerIndex = stack.findIndex(element => element.hasAttribute('data-app-mode-header-layout'));
        if (overlayIndex < 0 || (headerIndex >= 0 && overlayIndex > headerIndex)) return null;
        return { element: overlay, color };
      } finally {
        if (owned) overlay.setAttribute(marker, '');
      }
    },
    async toggle() {
      const model = this.read();
      if (model.blocked) return false;
      const opening = model.state === 'compact';
      const staleOpen = opening && model.root?.getAttribute('data-app-shell-sidebar-open') === 'true';
      const preferred = opening ? /^(open|show) sidebar$/i : /^(hide|close) sidebar$/i;
      const control = this.find(preferred) || this.find(/^(open|show|hide|close) sidebar$/i);
      if (!control) return false;
      control.click();
      // ChatGPT can retain its desktop open flag after switching to a drawer
      // breakpoint without mounting a panel. The first toggle clears that
      // stale flag; finish the user's requested open through the new opener.
      if (opening) {
        const outcome = await waitForNavigation(() => this.read().root !== model.root ? 'cancelled' :
          this.read().state !== 'compact' ? 'opened' :
          staleOpen && model.root.getAttribute('data-app-shell-sidebar-open') === 'false' ? 'cleared' : null);
        if (outcome === 'cleared') {
          this.find(/^(open|show) sidebar$/i)?.click();
          return !!await waitForNavigation(() => this.read().root === model.root && this.read().state !== 'compact');
        }
        return outcome === 'opened';
      }
      return !!await waitForNavigation(() => this.read().state === 'compact');
    },
    read() {
      const root = document.querySelector('[data-app-shell-responsive-sidebar]');
      const rendered = element => element && element.getBoundingClientRect().width > 0 &&
        getComputedStyle(element).visibility !== 'hidden';
      const drawer = document.querySelector('#browser-sidebar-popover[role="dialog"]');
      const docked = [...document.querySelectorAll('aside.app-shell-left-panel')].find(element =>
        !element.closest('[role="dialog"]') && rendered(element) && element.getBoundingClientRect().width > 52.5);
      const rail = document.querySelector('nav[class~="group/sidebar-rail"], nav[data-testid="sidebar-rail"]');
      const reservedPanel = [...document.querySelectorAll('aside.app-shell-left-panel')].some(element =>
        !element.closest('[role="dialog"]') && rendered(element));
      const reservedRail = reservedPanel || (rail && rail.getBoundingClientRect().width > 0 &&
        [...rail.querySelectorAll('button, a')].filter(element => element.getClientRects().length).length > 1);
      const blocked = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(element => element !== drawer && rendered(element));
      return { root, drawer: rendered(drawer) ? drawer : null, docked, rail, reservedRail,
        blocked,
        state: rendered(drawer) ? 'drawer' : docked ? 'docked' : 'compact' };
    }
  };

  navigationController = {
    state: null,
    root: null,
    cancelShortcut: null,
    owned: new Map(),
    queued: false,
    schedule() {
      if (this.queued) return;
      this.queued = true;
      requestAnimationFrame(() => { this.queued = false; ensureCompactSidebar(); ensureHomeLayout(); });
    },
    read: () => navigationAdapter.read(),
    apply(next) {
      for (const [element, attributes] of this.owned) {
        for (const attribute of attributes) {
          if (!next.get(element)?.has(attribute)) {
            element.removeAttribute(attribute);
            if (attribute === 'data-app-mode-sidebar-overlay') element.style.removeProperty('--app-mode-sidebar-scrim-color');
          }
        }
      }
      this.owned = next;
    },
    reset() {
      this.cancelShortcut?.();
      this.apply(new Map());
      document.getElementById('app-mode-compact-sidebar')?.remove();
      document.getElementById('app-mode-compact-sidebar-actions')?.remove();
      this.state = null;
      this.root = null;
    }
  };

  c.ensureCompactSidebar = function ensureCompactSidebar() {
    const model = navigationController.read();
    const { root, rail: nativeRail, docked: dockedPanel, state } = model;
    // Do not replace navigation when the adapter cannot identify an entry point.
    const nativeToggle = navigationAdapter.find(/^(open|show|hide|close) sidebar$/i, { interactive: false }) ||
      model.drawer?.querySelector('button[aria-label="Hide sidebar" i], button[aria-label="Close sidebar" i]');
    const retainBlockedLayout = model.blocked && navigationController.root === root && navigationController.state !== null;
    if (!compactSidebarEnabled || !root || (!nativeToggle && !retainBlockedLayout)) {
      navigationController.reset();
      setCompatibility('sidebar', !compactSidebarEnabled ? 'disabled' : 'unsupported');
      return;
    }
    setCompatibility('sidebar', 'ready');
    const next = new Map();
    const own = (element, attribute, value = '') => {
      if (!element) return;
      if (!next.has(element)) next.set(element, new Set());
      next.get(element).add(attribute);
      if (element.getAttribute(attribute) !== value) element.setAttribute(attribute, value);
    };
    let toggle = document.getElementById('app-mode-compact-sidebar');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.id = 'app-mode-compact-sidebar'; toggle.type = 'button';
      toggle.setAttribute('aria-label', 'Open sidebar'); toggle.title = 'Open sidebar';
      toggle.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M9 4v16"/></svg>';
      document.body.append(toggle);
    }
    let menu = document.getElementById('app-mode-compact-sidebar-actions');
    if (!menu) {
      menu = document.createElement('nav'); menu.id = 'app-mode-compact-sidebar-actions';
      menu.setAttribute('aria-label', 'App navigation');
      const actions = [
        ['New chat', 'M12 4v16M4 12h16'],
        ['Search', 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6'],
        ['Library', 'M4 5h5v14H4zM10 5h5v14h-5zM16 5h4v14h-4z'],
        ['Explore', 'M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z']
      ];
      for (const [label, path] of actions) {
        const action = document.createElement('button'); action.type = 'button';
        action.setAttribute('data-app-mode-sidebar-action', ''); action.setAttribute('aria-label', label); action.title = label;
        action.innerHTML = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="${path}"/></svg>`;
        menu.append(action);
      }
      document.body.append(menu);
    }
    // Codex-style rail keeps an account action pinned to the bottom. Only a
    // native account/profile control can back it; remember its accessible name
    // once seen so the button survives collapsed states where the control is
    // unmounted. When none is ever found, no button is offered.
    const accountControl = nativeSidebarControl(/account|profile|user menu/i);
    if (accountControl) railAccountLabel = accessibleName(accountControl) || accountControl.textContent.trim() || railAccountLabel;
    if (railAccountLabel && !menu.querySelector('[data-app-mode-rail-account]')) {
      const account = document.createElement('button'); account.type = 'button';
      account.setAttribute('data-app-mode-sidebar-action', '');
      account.setAttribute('data-app-mode-rail-account', '');
      account.setAttribute('aria-label', railAccountLabel); account.title = railAccountLabel;
      account.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>';
      menu.append(account);
    }
    own(document.body, 'data-app-mode-navigation-state', state);
    if (model.blocked) {
      own(document.body, 'data-app-mode-navigation-blocked');
      own(toggle, 'inert');
      own(menu, 'inert');
    }
    own(nativeRail, 'data-app-mode-native-sidebar');
    own(dockedPanel, 'data-app-mode-docked-sidebar');
    own(dockedPanel?.parentElement, 'data-app-mode-docked-sidebar-parent');
    const overlay = navigationAdapter.sidebarOverlay(model.drawer);
    if (overlay) {
      if (overlay.element.style.getPropertyValue('--app-mode-sidebar-scrim-color') !== overlay.color) {
        overlay.element.style.setProperty('--app-mode-sidebar-scrim-color', overlay.color);
      }
      own(overlay.element, 'data-app-mode-sidebar-overlay');
    }
    const modalClose = model.drawer?.querySelector('button[aria-label="Hide sidebar" i], button[aria-label="Close sidebar" i]');
    own(modalClose, 'data-app-mode-modal-sidebar-toggle');
    // The rail is permanent, so the app column reserves its 52px — except
    // when the site itself already reserves that space: a rendered collapsed
    // panel or native rail column we overlay, including a native rail kept
    // beside a docked panel. A docked panel inside the shell shifts right
    // with the offset instead of needing its own reservation.
    const navRailReserved = nativeRail && nativeRail.getBoundingClientRect().width > 0 &&
      [...nativeRail.querySelectorAll('button, a')].filter(element => element.getClientRects().length).length > 1;
    if (!navRailReserved && (dockedPanel || !model.reservedRail)) own(root, 'data-app-mode-compact-sidebar-shell');
    // The rounded Codex workspace is the single rendered content main inside
    // the shell. Ambiguous structure keeps the native, unmarked layout.
    const contentMains = [...root.querySelectorAll('main')].filter(element =>
      element.getClientRects().length && !element.closest('aside, nav, [role="dialog"]'));
    if (contentMains.length === 1) own(contentMains[0], 'data-app-mode-workspace');
    // Hide duplicate toggles only once a working replacement exists. Keep the
    // modal's native close control inside its focus trap as a fallback.
    const duplicates = [...document.querySelectorAll('header button, [role="banner"] button, [data-app-mode-header-layout] button')];
    for (const control of duplicates) {
      if (/^(open|show|hide|close) sidebar$/i.test(accessibleName(control)) &&
          !control.closest('[role="dialog"]')) own(control, 'data-app-mode-sidebar-original');
    }
    if (nativeToggle && !nativeToggle.closest('[role="dialog"]')) own(nativeToggle, 'data-app-mode-sidebar-original');
    const open = state !== 'compact';
    own(toggle, 'aria-expanded', String(open));
    own(toggle, 'aria-label', open ? 'Close sidebar' : 'Open sidebar');
    const label = open ? 'Close sidebar' : 'Open sidebar';
    if (toggle.title !== label) toggle.title = label;
    const previous = navigationController.state;
    navigationController.apply(next);
    navigationController.state = state;
    navigationController.root = root;
    if (previous === 'drawer' && state !== 'drawer' &&
        (document.activeElement === document.body || document.activeElement?.hasAttribute('data-app-mode-sidebar-original'))) {
      toggle.focus({ preventScroll: true });
    }
  }


  }
})();
