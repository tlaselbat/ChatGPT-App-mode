/* Shared App Mode content-script context; classic script, ordered by manifest and Electron host. */
(() => {
  const c = window.__APP_MODE_CONTEXT__;
  if (!c || !c.initialized || c.reinjection) return;
  with (c) {
  c.nativeSidebarControl = function nativeSidebarControl(label, { interactive = true, rendered = true } = {}) {
    const roots = [...document.querySelectorAll('[data-app-shell-responsive-sidebar]')];
    const activeRoot = roots.find(root => root.getClientRects().length && !root.closest('[inert], [aria-hidden="true"]')) ||
      roots.find(root => root.getClientRects().length);
    const renderedControl = element => {
      // Discovery must be read-only: changing suppression attributes here
      // forces layout and can retrigger observers waiting for native controls.
      // An owned display:none control uses its native wrapper's geometry;
      // a breakpoint-hidden wrapper or zero-width panel stays unavailable.
      const panel = element.closest('aside.app-shell-left-panel');
      if (panel && panel.getBoundingClientRect().width <= 0) return false;
      if (element.hasAttribute('data-app-mode-sidebar-original') || element.hasAttribute('data-app-mode-host-search-original') ||
          element.hasAttribute('data-app-mode-rail-original')) {
        // Suppression can collapse several shrink-wrapped ancestors too.
        // Walk to a real box without crossing a native display:none branch.
        for (let source = element.parentElement; source; source = source.parentElement) {
          if (getComputedStyle(source).display === 'none' && !source.hasAttribute('data-app-mode-native-sidebar')) return false;
          const box = source.getBoundingClientRect();
          if (box.width > 0 && box.height > 0) return true;
        }
        return false;
      }
      const box = element.getBoundingClientRect();
      // Native account forwarding can use a visibility:hidden trigger.
      return !!box && box.width > 0 && box.height > 0;
    };
    return [...document.querySelectorAll('button, a, [role="button"]')].find(element =>
      (!activeRoot || activeRoot.contains(element) || !!element.closest('#browser-sidebar-popover') ||
        (activeRoot.parentElement?.contains(element) && !element.closest('[data-app-shell-responsive-sidebar]'))) &&
      // Duplicate labels in page content and unrelated dialogs are not
      // navigation controls. Keep the native drawer and contextual header.
      !element.closest('[role="menu"]') &&
      (!element.closest('[role="dialog"]') || element.closest('[role="dialog"]').id === 'browser-sidebar-popover') &&
      (!element.closest('main') || !!element.closest('header, [role="banner"], #page-header, #conversation-header, [data-testid="page-header"], aside.app-shell-left-panel, nav[class~="group/sidebar-rail"]')) &&
      !element.closest('#app-mode-compact-sidebar-actions, #app-mode-compact-sidebar, #app-mode-navigation-flyout') &&
      label.test(accessibleName(element) || element.textContent.trim()) &&
      !element.disabled && element.getAttribute('aria-disabled') !== 'true' &&
      (!interactive || !element.closest('[aria-hidden="true"], [inert]')) &&
      (!rendered || renderedControl(element)));
  }

  c.hostNavigation = {
    ready: false,
    visible: false,
    busy: false,
    searchControl: null,
    rejectedSearch: new WeakSet(),
    rejectedToggle: null,
    // Resolve a dialog's own accessible name: aria-label first, then the
    // aria-labelledby chain ChatGPT uses for its Radix dialogs.
    dialogName(element) {
      const own = element.getAttribute('aria-label');
      if (own) return own.trim();
      return (element.getAttribute('aria-labelledby') || '').split(/\s+/)
        .map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
    },
    // An open Search dialog inerts its own trigger. Recognize the dialog by
    // its resolved "Search" name and text input so unrelated input modals
    // (rename, settings) keep ordinary modal blocking.
    searchDialog(model) {
      return [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].find(element =>
        element !== model.drawer && element.getClientRects().length &&
        getComputedStyle(element).visibility !== 'hidden' && element.querySelector('input') &&
        /search/i.test(this.dialogName(element)));
    },
    read() {
      const model = navigationAdapter.read();
      const toggle = navigationAdapter.find(/^(open|show|hide|close) sidebar$/i, { interactive: false });
      const supported = compactSidebarEnabled && !!model.root && !!toggle && toggle !== this.rejectedToggle;
      const dialog = this.searchDialog(model);
      const found = navigationAdapter.find(/^Search$/i);
      if (found) this.searchControl = found;
      // While the dialog hides its trigger, the still-connected last control
      // remains the capability signal; removal or replacement still fails.
      const search = found || (dialog && this.searchControl?.isConnected ? this.searchControl : null);
      if (!supported) this.searchControl = null;
      return { state: supported ? model.state : 'unavailable', toggle: supported,
        search: supported && !!search && !this.rejectedSearch.has(search) &&
          ((!model.blocked && model.state !== 'drawer') || !!dialog),
        searchActive: !!dialog, blocked: model.blocked, identity: !!navigationAdapter.identity(model) };
    },
    publish() {
      const value = JSON.stringify(this.read());
      if (document.body?.getAttribute('data-app-mode-host-navigation') !== value) document.body?.setAttribute('data-app-mode-host-navigation', value);
    },
    async run(action) {
      if (!this.ready || !this.visible || this.busy || !['toggle-sidebar', 'open-search'].includes(action)) return false;
      const capability = this.read();
      if (!(action === 'toggle-sidebar' ? capability.toggle : capability.search)) return false;
      // A modal makes activation impossible; an already-open Search dialog
      // already satisfies the request. Neither outcome is a capability
      // verdict, so neither reaches the rejection set.
      if (navigationAdapter.read().blocked) return action === 'open-search' && capability.searchActive === true;
      this.busy = true;
      const root = navigationAdapter.read().root;
      const searchControl = this.searchControl;
      let succeeded = false;
      try {
        if (action === 'toggle-sidebar') {
          const control = navigationAdapter.find(/^(open|show|hide|close) sidebar$/i);
          const toggled = await navigationAdapter.toggle();
          if (!toggled && navigationAdapter.read().root === root) this.rejectedToggle = control;
          return toggled;
        }
        succeeded = await navigationAdapter.activate(/^Search$/i);
        return succeeded;
      }
      finally {
        if (action === 'open-search' && !succeeded && searchControl) this.rejectedSearch.add(searchControl);
        this.busy = false; navigationController.schedule();
      }
    }
  };

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

  c.restoreRailAccountFocus = function restoreRailAccountFocus(source, root) {
    const existing = new Set([...document.querySelectorAll('[role="menu"]')].filter(element => element.getClientRects().length));
    let menu = null;
    const stop = () => {
      observer.disconnect(); clearTimeout(timer);
      if (navigationController.cancelShortcut === stop) navigationController.cancelShortcut = null;
    };
    const check = () => {
      const model = navigationAdapter.read();
      if (!source.isConnected || root !== model.root) { stop(); return; }
      if (!menu) {
        menu = [...document.querySelectorAll('[role="menu"]')].find(element => !existing.has(element) && element.getClientRects().length);
        if (menu) clearTimeout(timer);
        return;
      }
      if (menu.isConnected && menu.getClientRects().length && getComputedStyle(menu).visibility !== 'hidden') return;
      stop();
      const active = document.activeElement;
      if (!model.blocked && source.getClientRects().length && getComputedStyle(source).visibility !== 'hidden' &&
          !source.closest('[inert], [aria-hidden="true"]') &&
          (active === document.body || !active?.getClientRects().length || getComputedStyle(active).visibility === 'hidden')) source.focus({ preventScroll: true });
    };
    const observer = new MutationObserver(check);
    const timer = setTimeout(stop, 3000);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'data-state'] });
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
    if (persistentRailEnabled && navigationController.rejectedUtilities.has(target)) return false;
    const source = target.hasAttribute('data-app-mode-rail-original') ?
      [...document.querySelectorAll('#app-mode-compact-sidebar-actions button')].find(element => label.test(element.getAttribute('aria-label') || '')) : null;
    if (source) {
      const box = source.getBoundingClientRect();
      if (box?.width && !source.closest('[inert]')) {
        target.style.setProperty('--app-mode-rail-anchor-x', `${box.x}px`);
        target.style.setProperty('--app-mode-rail-anchor-y', `${box.y}px`);
        const anchor = target.getBoundingClientRect();
        target.style.setProperty('--app-mode-rail-anchor-x', `${box.x * 2 - anchor.x}px`);
        target.style.setProperty('--app-mode-rail-anchor-y', `${box.y * 2 - anchor.y}px`);
      }
    }
    const utility = persistentRailEnabled && /^(Scheduled|Library|Plugins|Explore)$/i.test(accessibleName(target) || target.textContent.trim());
    const route = location.href;
    const popups = utility ? new Set([...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"]')].filter(element => element.getClientRects().length)) : null;
    const accountSource = document.querySelector('[data-app-mode-rail-account]');
    if (source && target.getAttribute('aria-haspopup') === 'menu') restoreRailAccountFocus(source, root);
    else if (accountSource && label.test(accountSource.getAttribute('aria-label') || '')) restoreRailAccountFocus(accountSource, root);
    if (target?.getAttribute('aria-haspopup') === 'menu') {
      target.focus();
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    } else target?.click();
    if (label.test('Search')) {
      const focused = await waitForNavigation(() => navigationAdapter.read().root === root &&
        [...document.querySelectorAll('[role="dialog"] input')].find(input =>
          input.getClientRects().length && !input.closest('[inert], [aria-hidden="true"]') && document.activeElement === input));
      if (focused) hostNavigation.rejectedSearch.delete(target);
      return !!focused;
    }
    if (utility) {
      const succeeded = await waitForNavigation(() => location.href !== route ||
        navigationAdapter.activeDestination() === (accessibleName(target) || target.textContent.trim()) ||
        [...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"]')].some(element =>
          !popups.has(element) && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden'));
      if (!succeeded) navigationController.rejectedUtilities.add(nativeSidebarControl(label) || target);
      navigationController.schedule();
      return !!succeeded;
    }
    return true;
  }

  c.focusSidebarSearch = function focusSidebarSearch() {
    const model = navigationAdapter.read();
    if (model.blocked) return;
    const target = model.state === 'compact' && !persistentRailEnabled ? document.querySelector('#app-mode-compact-sidebar-actions [aria-label="Search"]') : nativeSidebarControl(/^Search$/i);
    if (target?.getClientRects().length && getComputedStyle(target).visibility !== 'hidden' && !target.closest('[inert], [aria-hidden="true"]')) target.focus({ preventScroll: true });
  }

  // A rail section shortcut expands the native sidebar through the same
  // adapter, then brings the recognized section into view. Disclosure
  // preferences stay authoritative; an unrecognized section leaves the
  // ordinary expanded sidebar as the result rather than fake content.
  c.runSidebarSection = async function runSidebarSection(key) {
    navigationController.cancelShortcut?.();
    const root = navigationAdapter.read().root;
    if (navigationAdapter.read().state === 'compact' && !await navigationAdapter.toggle()) return false;
    const model = navigationAdapter.read();
    const panel = model.drawer || model.docked;
    if (!panel || model.blocked || navigationAdapter.read().root !== root) return false;
    // Section content can mount after the panel does; reuse the bounded
    // reconciliation wait instead of assuming synchronous availability.
    const entry = await waitForNavigation(() =>
      navigationAdapter.read().root === root &&
      navigationAdapter.sections(panel).find(section => section.key === key)) || null;
    if (!entry) return true;
    entry.section.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // The rail hides while expanded; keep keyboard focus meaningful inside
    // the destination section when the activating button left the DOM flow.
    const active = document.activeElement;
    if (entry.control && (active === document.body || !active?.isConnected || !active.getClientRects().length || !!active.closest('#app-mode-compact-sidebar-actions'))) {
      entry.control.focus({ preventScroll: true });
    }
    return true;
  }

  // All assumptions about native sidebar markup and activation live here.
  navigationAdapter = {
    find: nativeSidebarControl,
    activate: runSidebarAction,
    identity(model) {
      const header = (model.drawer || model.docked)?.querySelector('.sidebar-navigation [class~="h-toolbar"]');
      return [...(header?.querySelectorAll('[aria-haspopup="menu"]') || [])].find(control =>
        (/^ChatGPT\b/.test(accessibleName(control)) || /^ChatGPT\b/.test(control.textContent.trim())) &&
        !control.disabled && control.getAttribute('aria-disabled') !== 'true' &&
        !control.closest('[hidden], [inert], [aria-hidden="true"]') && control.getClientRects().length &&
        control.getBoundingClientRect().width > 0 && control.getBoundingClientRect().height > 0 &&
        getComputedStyle(control).visibility === 'visible');
    },
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
    sections(panel) {
      const navigation = panel?.querySelector('.sidebar-navigation');
      if (!navigation) return [];
      return [...navigation.querySelectorAll('section[class~="group/nav-section"]')].flatMap(section => {
        const heading = section.querySelector('[class~="group/nav-section-title"]');
        const native = heading?.querySelector('button[class~="group/section-toggle"][aria-expanded]');
        const label = (native ? accessibleName(native) || native.textContent : heading?.textContent)?.trim();
        const key = ['Pinned', 'Projects', 'Recents'].includes(label) ? label.toLowerCase() : null;
        const children = heading?.parentElement?.children;
        if (!heading || !children || children.length !== 2 || children[0] !== heading || !section.contains(children[1])) return [];
        if (native && ['true', 'false'].includes(native.getAttribute('aria-expanded'))) return [{ section, heading, control: native, content: children[1], key: key || 'native', navigation, native: true }];
        if (!key || heading.querySelector('button:not([data-app-mode-nav-disclosure]), a, input, [role="button"]')) return [];
        return [{ section, heading, content: children[1], key, label, navigation, native: false }];
      });
    },
    // Compact desktop panels may be inert/offscreen but retain native links.
    // Never open a panel to populate a flyout, or read unrelated page links.
    sectionEntries(key, model = this.read()) {
      if (model.state !== 'compact' || model.blocked || !model.root) return null;
      const panels = [...model.root.querySelectorAll('aside.app-shell-left-panel')]
        .filter(panel => !panel.closest('[role="dialog"]'));
      if (panels.length !== 1) return null;
      // The desktop panel can remain mounted under a display:none wrapper
      // after resizing to the native drawer breakpoint. Its links are stale
      // presentation sources even though they remain connected.
      if (panels[0].getBoundingClientRect().width <= 0) return null;
      const sections = this.sections(panels[0]).filter(section => section.key === key);
      if (sections.length !== 1) return null;
      const section = sections[0];
      const candidates = [...section.content.querySelectorAll('a[href]')].filter(target =>
        target.closest('section') === section.section);
      const entries = [];
      for (const target of candidates) {
        let url;
        try { url = new URL(target.getAttribute('href'), location.href); } catch { return null; }
        const supported = url.origin === location.origin && !url.search && !url.hash &&
          (key === 'projects' ? /^\/g\/[^/]+\/project\/?$/.test(url.pathname) : /^\/(?:g\/[^/]+\/)?c\/[^/]+\/?$/.test(url.pathname));
        const label = (accessibleName(target) || target.textContent).trim();
        if (!supported) continue; // Exclude project children and "See more" actions.
        if (!label || target.hasAttribute('download') || (target.target && target.target !== '_self') ||
            target.getAttribute('aria-disabled') === 'true' || target.querySelector('[aria-haspopup]')) return null;
        entries.push({ target, href: target.getAttribute('href'), label });
      }
      // A collapsed disclosure with no links does not establish an empty list.
      if (!entries.length && (candidates.length || section.content.querySelector('button, [role="button"]') ||
          section.control?.getAttribute('aria-expanded') !== 'true')) return null;
      return { section: section.section, entries: entries.slice(0, key === 'recents' ? 8 : 20) };
    },
    async toggle() {
      const model = this.read();
      if (model.blocked) return false;
      const opening = model.state === 'compact';
      const staleOpen = opening && model.root?.getAttribute('data-app-shell-sidebar-open') === 'true';
      const preferred = opening ? /^(open|show) sidebar$/i : /^(hide|close) sidebar$/i;
      const control = this.find(preferred) || this.find(/^(open|show|hide|close) sidebar$/i);
      if (!control) return false;
      navigationController.captureGeometry();
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
    activeDestination(model = this.read()) {
      if (!model.root) return null;
      const primary = new Set(['New chat', 'Search', 'Scheduled', 'Library', 'Plugins', 'Explore']);
      // Only verified page routes have a label-independent fallback. Explore
      // and Search can be menus/dialogs; opening them is not page selection.
      const routes = new Map([['/', 'New chat'], ['/scheduled', 'Scheduled'], ['/library', 'Library']]);
      const path = location.pathname.replace(/\/$/, '') || '/';
      const conversation = /^\/(?:g\/[^/]+\/)?c\/[^/]+$/.test(path);
      const project = /^\/g\/[^/]+\/project$/.test(path);
      const panels = [...model.root.querySelectorAll('aside.app-shell-left-panel')];
      if (model.drawer) panels.push(model.drawer);
      if (model.rail) panels.push(model.rail);
      const current = new Set(), matching = new Set();
      for (const panel of panels) {
        const navigation = panel === model.rail ? panel : panel.querySelector('.sidebar-navigation');
        if (!navigation) continue;
        const sections = this.sections(panel);
        for (const control of navigation.querySelectorAll('a[href], button, [role="link"], [role="tab"]')) {
          if (control.disabled || control.getAttribute('aria-disabled') === 'true' ||
              control.hasAttribute('data-app-mode-nav-disclosure')) continue;
          const section = sections.find(entry => entry.section.contains(control));
          const label = (accessibleName(control) || control.textContent).trim();
          let url = null;
          if (control.hasAttribute('href')) {
            try { url = new URL(control.getAttribute('href'), location.href); } catch { continue; }
            if (url.origin !== location.origin || url.search || url.hash) continue;
          }
          const exact = url && (url.pathname.replace(/\/$/, '') || '/') === path;
          let key = null;
          if (section) {
            // A conversation is not automatically Recent, Pinned, or a project.
            // Require its exact native link in one recognized section.
            if (exact && (conversation || project) && ['pinned', 'projects', 'recents'].includes(section.key)) key = section.key;
          } else if (!control.closest('section') && primary.has(label)) {
            const canonical = [...routes].find(([, value]) => value === label)?.[0];
            if ((!url || exact) && (!canonical || canonical === path) && !conversation && !project) key = label;
          }
          if (!key) continue;
          if (exact) matching.add(key);
          if (['page', 'true'].includes(control.getAttribute('aria-current')) || control.getAttribute('aria-selected') === 'true') current.add(key);
        }
      }
      // Conflicting native selections are ambiguous, not a reason to guess.
      if (current.size) return current.size === 1 ? [...current][0] : null;
      if (matching.size) return matching.size === 1 ? [...matching][0] : null;
      if (location.search || location.hash) return null;
      return project ? 'projects' : routes.get(path) || null;
    },
    read() {
      const roots = [...document.querySelectorAll('[data-app-shell-responsive-sidebar]')];
      const root = roots.find(element => element.getClientRects().length && !element.closest('[inert], [aria-hidden="true"]')) ||
        roots.find(element => element.getClientRects().length) || null;
      const rendered = element => element && element.getBoundingClientRect().width > 0 &&
        getComputedStyle(element).visibility !== 'hidden';
      const drawer = document.querySelector('#browser-sidebar-popover[role="dialog"]');
      const docked = [...(root?.querySelectorAll('aside.app-shell-left-panel') || [])].find(element =>
        !element.closest('[role="dialog"]') && rendered(element) && element.getBoundingClientRect().width > 52.5);
      const rail = root?.querySelector('nav[class~="group/sidebar-rail"], nav[data-testid="sidebar-rail"]');
      const reservedPanel = [...(root?.querySelectorAll('aside.app-shell-left-panel') || [])].some(element =>
        !element.closest('[role="dialog"]') && rendered(element));
      const railReserved = !!rail && !rail.closest('aside.app-shell-left-panel') && rail.getBoundingClientRect().width > 0 &&
        !['absolute', 'fixed'].includes(getComputedStyle(rail).position);
      const reservedRail = reservedPanel || (persistentRailEnabled ? railReserved : rail && rail.getBoundingClientRect().width > 0 &&
        [...rail.querySelectorAll('button, a')].filter(element => element.getClientRects().length).length > 1);
      const blocked = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(element => element !== drawer && rendered(element));
      return { root, drawer: rendered(drawer) ? drawer : null, docked, rail, reservedRail, railReserved,
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
    sections: new Map(),
    preferences: null,
    rejectedUtilities: new WeakSet(),
    flyout: null,
    pendingFlyoutFocus: null,
    geometry: null,
    geometryAnimation: null,
    geometryFrame: null,
    geometryCaptured: false,
    rebaseGeometry(workspace) {
      if (!this.geometryAnimation || !workspace?.isConnected) return;
      // Native width motion can continue underneath our correction. Keep
      // the same animation clock, but rebase its offset on that live layout.
      const offset = parseFloat(getComputedStyle(workspace).getPropertyValue('--app-mode-navigation-offset')) || 0;
      const layoutX = workspace.getBoundingClientRect().x - offset;
      if (Math.abs(layoutX - this.geometryAnimationBaseX) > .5) {
        this.geometryAnimation.effect.setKeyframes({ '--app-mode-navigation-offset': [`${this.geometryAnimationStartX - layoutX}px`, '0px'] });
        this.geometryAnimationBaseX = layoutX;
      }
    },
    captureGeometry() {
      const workspace = this.geometry?.workspace;
      if (workspace?.isConnected) {
        this.rebaseGeometry(workspace);
        this.geometry.x = workspace.getBoundingClientRect().x;
        this.geometryCaptured = true;
      }
    },
    cancelGeometry() {
      cancelAnimationFrame(this.geometryFrame);
      this.geometryFrame = null;
      this.geometryAnimation?.cancel();
      this.geometryAnimation = null;
    },
    reconcileGeometry(model, workspace) {
      const previous = this.geometry;
      const intent = model.root.getAttribute('data-app-shell-sidebar-open');
      const compatible = previous?.root === model.root && previous.workspace === workspace &&
        previous.width === innerWidth && previous.height === innerHeight;
      const changed = compatible && (previous.state !== model.state || previous.intent !== intent);
      // React's transparent layout wrappers do not create CSS boxes; the
      // workspace is still a flex item of their first boxed ancestor.
      let parent = workspace?.parentElement;
      while (parent && parent !== model.root && getComputedStyle(parent).display === 'contents') parent = parent.parentElement;
      if (!compatible || matchMedia('(prefers-reduced-motion: reduce)').matches) this.cancelGeometry();
      // A width-based state may catch up after native motion has already
      // started. Only a new intent warrants starting another correction.
      else if (changed && previous.intent !== intent && workspace && getComputedStyle(workspace).flexGrow !== '0' &&
          parent && getComputedStyle(parent).display === 'flex' && getComputedStyle(parent).flexDirection === 'row') {
        // Correct only the workspace's layout offset, never the native panel's
        // measured width. Native animation/detection remains authoritative.
        // An animated margin lets flex reflow text/composer without scaling it.
        this.cancelGeometry();
        const delta = previous.x - workspace.getBoundingClientRect().x;
        if (Math.abs(delta) > .5) {
          this.geometryAnimationStartX = previous.x;
          this.geometryAnimationBaseX = workspace.getBoundingClientRect().x;
          this.geometryAnimation = workspace.animate({ '--app-mode-navigation-offset': [`${delta}px`, '0px'] },
            { duration: 220, easing: 'cubic-bezier(.4, 0, .6, 1)' });
          const animation = this.geometryAnimation;
          // CSS/native width transitions need not emit DOM mutations. Sample
          // their layout until this existing animation completes or is replaced;
          // this updates its keyframes, not a second movement/timing system.
          const rebase = () => {
            if (this.geometryAnimation !== animation) return;
            this.rebaseGeometry(workspace);
            this.geometryFrame = requestAnimationFrame(rebase);
          };
          this.geometryFrame = requestAnimationFrame(rebase);
          // Native mounting can occupy most of this frame. Hold the starting
          // layout until the next frame so its cost cannot consume the tween
          // before the first corrected position is painted.
          animation.pause(); animation.currentTime = 0;
          requestAnimationFrame(() => { if (this.geometryAnimation === animation) animation.play(); });
          animation.addEventListener('finish', () => {
            if (this.geometryAnimation === animation) {
              this.geometryAnimation = null;
              cancelAnimationFrame(this.geometryFrame); this.geometryFrame = null;
            }
          }, { once: true });
        }
      }
      this.geometry = { root: model.root, workspace, state: model.state, intent,
        width: innerWidth, height: innerHeight, x: workspace?.getBoundingClientRect().x };
      this.geometryCaptured = false;
    },
    closeFlyout(restore = false, keepNative = false) {
      const active = this.flyout;
      if (!active) return;
      this.flyout = null;
      if (active.kind === 'native') {
        active.footer?.remove();
        if (active.openedDisclosure?.isConnected && active.openedDisclosure.getAttribute('aria-expanded') === 'true' &&
            !active.openedDisclosure.closest('[inert], [aria-hidden="true"]') && !this.read().blocked) active.openedDisclosure.click();
        active.element?.removeAttribute('data-app-mode-section-flyout');
        active.element?.style.removeProperty('--app-mode-section-flyout-top');
        active.element?.style.removeProperty('--app-mode-section-flyout-left');
        if (restore) this.pendingFlyoutFocus = { key: active.key, root: active.root, route: active.route };
        if (!keepNative && active.element === this.read().drawer && !this.read().blocked) {
          const close = navigationAdapter.find(/^(hide|close) sidebar$/i);
          if (close && active.element.contains(close)) close.click();
        }
        this.schedule();
      } else active.element.remove();
      active.trigger.setAttribute('aria-expanded', 'false');
      active.trigger.removeAttribute('aria-controls');
      if (restore && active.trigger.isConnected && this.read().state === 'compact' && !this.read().blocked &&
          active.trigger.getClientRects().length && !active.trigger.closest('[inert], [aria-hidden="true"]')) active.trigger.focus({ preventScroll: true });
    },
    positionFlyout() {
      const active = this.flyout;
      if (!active) return;
      const box = active.trigger.getBoundingClientRect();
      const right = active.trigger.closest('nav').getBoundingClientRect().right;
      const width = Math.max(0, Math.min(280, innerWidth - right - 16));
      const height = Math.max(0, Math.min(innerHeight * .68, innerHeight - 16));
      for (const [name, value] of Object.entries({ width: `${width}px`, maxHeight: `${height}px`,
        left: `${right + 8}px` })) if (active.element.style[name] !== value) active.element.style[name] = value;
      const top = Math.max(8, Math.min(box.top, innerHeight - active.element.getBoundingClientRect().height - 8));
      if (active.element.style.top !== `${top}px`) active.element.style.top = `${top}px`;
    },
    reconcileFlyout(model) {
      const active = this.flyout;
      if (!active) return;
      if (active.kind === 'native') {
        if (active.root !== model.root || active.route !== location.href || model.blocked ||
            (active.element && active.element !== model.drawer) || model.state === 'docked') {
          this.closeFlyout(!model.blocked && active.route === location.href, model.blocked || model.state === 'docked'); return;
        }
        if (!model.drawer) return;
        active.element = model.drawer;
        const entry = navigationAdapter.sections(model.drawer).find(entry => entry.key === active.key);
        if (active.section && active.section !== entry?.section) { this.closeFlyout(false, true); return; }
        if (entry && !active.section) {
          active.section = entry.section;
          active.navigation = entry.navigation;
          if (entry.native && entry.control.getAttribute('aria-expanded') === 'false') {
            active.openedDisclosure = entry.control; entry.control.click();
          }
        }
        if (!active.footer?.isConnected) {
          const footer = document.createElement('div'); footer.setAttribute('data-app-mode-section-flyout-actions', '');
          const all = document.createElement('button'); all.type = 'button';
          all.textContent = `View all ${active.key === 'recents' ? 'recent chats' : active.key} →`;
          all.addEventListener('click', () => { this.closeFlyout(false, true); c.runSidebarSection(active.key); });
          footer.append(all); model.drawer.append(footer); active.footer = footer;
        }
        const top = Math.max(8, Math.min(active.top, innerHeight - Math.min(innerHeight * .68, model.drawer.getBoundingClientRect().height) - 8));
        if (model.drawer.style.getPropertyValue('--app-mode-section-flyout-top') !== `${top}px`) model.drawer.style.setProperty('--app-mode-section-flyout-top', `${top}px`);
        const left = Math.min(60, Math.max(8, innerWidth - 288));
        if (model.drawer.style.getPropertyValue('--app-mode-section-flyout-left') !== `${left}px`) model.drawer.style.setProperty('--app-mode-section-flyout-left', `${left}px`);
        return;
      }
      const fresh = navigationAdapter.sectionEntries(active.key, model);
      if (!active.trigger.isConnected || active.root !== model.root || active.route !== location.href ||
          !fresh || fresh.section !== active.section || fresh.entries.length !== active.entries.length ||
          fresh.entries.some((entry, index) => entry.target !== active.entries[index].target ||
            entry.href !== active.entries[index].href || entry.label !== active.entries[index].label)) {
        this.closeFlyout(active.element.contains(document.activeElement)); return;
      }
      this.positionFlyout();
    },
    async openSection(key, trigger) {
      if (this.flyout?.key === key) { this.closeFlyout(true); return; }
      this.closeFlyout();
      const model = this.read();
      const source = navigationAdapter.sectionEntries(key, model);
      if (!source || innerWidth - trigger.closest('nav').getBoundingClientRect().right < 160) {
        this.flyout = { kind: 'native', key, trigger, root: model.root, route: location.href, top: trigger.getBoundingClientRect().top };
        const active = this.flyout;
        trigger.setAttribute('aria-expanded', 'true'); trigger.setAttribute('aria-controls', 'browser-sidebar-popover');
        await c.runSidebarSection(key);
        if (this.flyout !== active) return;
        this.reconcileFlyout(this.read());
        if (!active.section || !active.element) { this.closeFlyout(false, true); return; }
        const focus = [...active.section.querySelectorAll('a[href], button:not([disabled]), [role="button"][tabindex="0"]')]
          .find(control => control.getClientRects().length && !control.closest('[inert], [aria-hidden="true"]'));
        focus?.focus({ preventScroll: true }); this.schedule();
        requestAnimationFrame(() => {
          if (this.flyout !== active || !active.section?.isConnected) return;
          const scroll = active.section.closest('[data-app-mode-nav-scroll]');
          if (scroll) scroll.scrollTop = 0;
        });
        return;
      }
      this.cancelShortcut?.();
      const element = document.createElement('section');
      element.id = 'app-mode-navigation-flyout';
      element.setAttribute('role', 'region');
      element.setAttribute('aria-label', `${trigger.getAttribute('aria-label')} navigation`);
      const heading = document.createElement('strong');
      heading.textContent = trigger.getAttribute('aria-label');
      element.append(heading);
      const list = document.createElement('div'); list.setAttribute('data-app-mode-flyout-list', '');
      element.append(list);
      const active = { ...source, element, key, trigger, root: model.root, route: location.href };
      this.flyout = active;
      for (const entry of source.entries) {
        const button = document.createElement('button'); button.type = 'button';
        button.title = entry.label;
        // Copy only App Mode's verified icon artwork, never native components.
        button.innerHTML = (key === 'projects' ? trigger : document.querySelector('[data-app-mode-rail-section="recents"]')).innerHTML;
        const title = document.createElement('span'); title.textContent = entry.label; button.append(title);
        button.addEventListener('click', async () => {
          const fresh = navigationAdapter.sectionEntries(key);
          const valid = this.flyout === active && active.route === location.href && fresh?.section === active.section &&
            fresh.entries.some(item => item.target === entry.target && item.href === entry.href && item.label === entry.label) && entry.target.isConnected;
          this.closeFlyout();
          if (!valid) { if (!this.read().blocked) await c.runSidebarSection(key); return; }
          entry.target.click();
          const navigated = await c.waitForNavigation(() => location.href !== active.route ||
            location.href === new URL(entry.href, active.route).href, 1500);
          if (!navigated && this.read().root === active.root && !this.read().blocked) await c.runSidebarSection(key);
        });
        list.append(button);
      }
      if (!source.entries.length) { const empty = document.createElement('p'); empty.textContent = 'No available entries'; list.append(empty); }
      const all = document.createElement('button'); all.type = 'button';
      all.textContent = `View all ${key === 'recents' ? 'recent chats' : key} →`;
      all.addEventListener('click', () => { this.closeFlyout(); c.runSidebarSection(key); });
      element.append(all);
      trigger.setAttribute('aria-expanded', 'true'); trigger.setAttribute('aria-controls', element.id);
      document.body.append(element); this.positionFlyout();
      element.querySelector('button').focus({ preventScroll: true });
    },
    sectionPreferences() {
      if (this.preferences) return this.preferences;
      this.preferences = {};
      try {
        const saved = JSON.parse(localStorage.getItem('app-mode-sidebar-disclosures-v1') || '{}');
        for (const key of ['pinned', 'projects', 'recents']) if (typeof saved?.[key] === 'boolean') this.preferences[key] = saved[key];
      } catch {}
      return this.preferences;
    },
    toggleSection(control) {
      const entry = [...this.sections.values()].find(entry => !entry.native && entry.control === control);
      if (!entry) return;
      const preferences = this.sectionPreferences();
      preferences[entry.key] = !preferences[entry.key];
      try { localStorage.setItem('app-mode-sidebar-disclosures-v1', JSON.stringify(preferences)); } catch {}
      this.schedule();
    },
    reconcileSections(panel, own) {
      const next = new Map();
      const entries = navigationAdapter.sections(panel);
      // Read scroll geometry before writing section markers. Interleaving
      // these reads/writes forced repeated layout during native expansion.
      const scrolls = new Map(entries.map(entry => {
        let scroll = entry.section.parentElement;
        while (scroll && scroll !== entry.navigation && !['auto', 'scroll'].includes(getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement;
        return [entry.section, scroll];
      }));
      const navigations = new Set();
      const capability = entries.length ? hostNavigation.read() : null;
      for (const entry of entries) {
        const { section, heading, content, key, navigation } = entry;
        if (!entry.native) {
          let control = heading.querySelector('[data-app-mode-nav-disclosure]');
          if (!control) {
            control = document.createElement('button');
            control.type = 'button';
            control.setAttribute('data-app-mode-nav-disclosure', '');
            control.setAttribute('aria-label', entry.label);
            heading.append(control);
          }
          entry.control = control;
          const expanded = this.sectionPreferences()[key] === true;
          own(control, 'aria-expanded', String(expanded));
          if (!expanded) own(content, 'data-app-mode-nav-collapsed');
          own(heading, 'data-app-mode-nav-fallback-heading');
        }
        own(section, 'data-app-mode-nav-section', key);
        own(entry.control, 'data-app-mode-nav-heading');
        own(content, 'data-app-mode-nav-content');
        own(navigation, 'data-app-mode-sidebar-navigation');
        const wrapper = panel.firstElementChild;
        if (wrapper?.contains(navigation) && wrapper.style.width && wrapper.style.minWidth) own(wrapper, 'data-app-mode-sidebar-width-wrapper');
        const scroll = scrolls.get(section);
        if (scroll && scroll !== navigation) {
          own(scroll, 'data-app-mode-nav-scroll');
          for (let node = section.parentElement; node && node !== scroll; node = node.parentElement) {
            if (node.querySelectorAll('section').length === 1) own(node, 'data-app-mode-nav-group-wrapper');
          }
        }
        next.set(section, entry);
        if (navigations.has(navigation)) continue;
        navigations.add(navigation);
        const header = navigation.querySelector('[class~="h-toolbar"]');
        if (header && !header.contains(section)) {
          own(header, 'data-app-mode-nav-header');
          const hosted = hostNavigation.ready && hostNavigation.visible && capability.toggle;
          const controls = [...header.querySelectorAll('button, a, [role="button"], input, select, textarea, summary, [tabindex], [contenteditable="true"]')];
          const known = controls.length > 0 && controls.every(control =>
            /^(open|show|hide|close) sidebar$|^Search$/i.test(accessibleName(control)) ||
            (control.getAttribute('aria-haspopup') === 'menu' && /^ChatGPT\b/.test(control.textContent.trim())));
          if (hosted && known) {
            own(header, 'data-app-mode-host-nav-header');
          }
        }
        const account = [...navigation.querySelectorAll('button, [role="button"]')].find(element =>
          !element.closest('section') && /account|profile|user menu/i.test(accessibleName(element)));
        const accountRow = account?.closest('[class~="h-toolbar"]');
        if (accountRow && accountRow !== header) own(accountRow, 'data-app-mode-nav-account-row');
        for (const list of navigation.querySelectorAll('[class~="group/nav-list"]')) {
          if (!list.closest('section')) own(list, 'data-app-mode-nav-primary');
        }
      }
      for (const [section, entry] of this.sections) {
        if (!entry.native && next.get(section)?.control !== entry.control) entry.control.remove();
      }
      this.sections = next;
    },
    schedule() {
      if (this.queued) return;
      this.queued = true;
      requestAnimationFrame(() => { this.queued = false; ensureCompactSidebar(); ensureHomeLayout(); hostNavigation.publish(); });
    },
    read: () => navigationAdapter.read(),
    apply(next) {
      for (const [element, attributes] of this.owned) {
        for (const attribute of attributes) {
          if (!next.get(element)?.has(attribute)) {
            element.removeAttribute(attribute);
            if (attribute === 'data-app-mode-rail-original') {
              element.style.removeProperty('--app-mode-rail-anchor-x'); element.style.removeProperty('--app-mode-rail-anchor-y');
            }
            if (attribute === 'data-app-mode-sidebar-overlay') element.style.removeProperty('--app-mode-sidebar-scrim-color');
          }
        }
      }
      this.owned = next;
    },
    reset() {
      this.cancelGeometry(); this.geometry = null; this.geometryCaptured = false;
      clearTimeout(this.replacementTimer); this.replacementTimer = null; this.replacementExpired = false;
      this.closeFlyout(false, true);
      this.cancelShortcut?.();
      this.reconcileSections(null, () => {});
      this.apply(new Map());
      document.getElementById('app-mode-compact-sidebar')?.remove();
      document.getElementById('app-mode-compact-sidebar-actions')?.remove();
      this.state = null;
      this.root = null;
    }
  };

  c.ensureCompactSidebar = function ensureCompactSidebar() {
    // Reversing or advancing a native animation starts at its current visual
    // position, rather than the previous frame's cached correction.
    if (navigationController.geometryAnimation && !navigationController.geometryCaptured) navigationController.captureGeometry();
    const model = navigationController.read();
    navigationController.reconcileFlyout(model);
    const { root, rail: nativeRail, docked: dockedPanel, state } = model;
    // Do not replace navigation when the adapter cannot identify an entry point.
    const nativeToggle = navigationAdapter.find(/^(open|show|hide|close) sidebar$/i, { interactive: false }) ||
      model.drawer?.querySelector('button[aria-label="Hide sidebar" i], button[aria-label="Close sidebar" i]');
    const retainBlockedLayout = model.blocked && navigationController.root === root && navigationController.state !== null;
    // React can remove an opener before mounting its responsive replacement.
    // Keep validated presentation briefly, with forwarding controls disabled;
    // a genuinely unsupported layout still releases all native fallbacks.
    const replacing = compactSidebarEnabled && navigationController.state !== null && (!root || !nativeToggle) && !retainBlockedLayout;
    if (replacing && !navigationController.replacementExpired) {
      for (const control of document.querySelectorAll('#app-mode-compact-sidebar, #app-mode-compact-sidebar-actions button')) if (!control.disabled) control.disabled = true;
      if (!navigationController.replacementTimer) navigationController.replacementTimer = setTimeout(() => {
        navigationController.replacementExpired = true; navigationController.schedule();
      }, 250);
      setCompatibility('sidebar', 'pending'); hostNavigation.publish();
      return;
    }
    if (!compactSidebarEnabled || !root || (nativeToggle && nativeToggle === hostNavigation.rejectedToggle) || (!nativeToggle && !retainBlockedLayout)) {
      navigationController.reset();
      setCompatibility('sidebar', !compactSidebarEnabled ? 'disabled' : 'unsupported');
      return;
    }
    setCompatibility('sidebar', 'ready');
    if (navigationController.replacementTimer) {
      for (const control of document.querySelectorAll('#app-mode-compact-sidebar, #app-mode-compact-sidebar-actions button')) if (control.disabled) control.disabled = false;
    }
    clearTimeout(navigationController.replacementTimer); navigationController.replacementTimer = null; navigationController.replacementExpired = false;
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
      toggle.innerHTML = `<svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true"><g data-icon-collapsed><path fill-rule="evenodd" clip-rule="evenodd" d="M14.5 2.877a3.665 3.665 0 0 1 3.665 3.665v6.917a3.665 3.665 0 0 1-3.665 3.665h-9a3.665 3.665 0 0 1-3.665-3.665V6.542A3.665 3.665 0 0 1 5.5 2.877zm-9 1.33a2.335 2.335 0 0 0-2.335 2.335v6.917A2.335 2.335 0 0 0 5.5 15.794h9a2.335 2.335 0 0 0 2.335-2.335V6.542A2.335 2.335 0 0 0 14.5 4.207z"/><path d="M5.833 6.001c.367 0 .665.298.665.665v6.667a.665.665 0 0 1-1.33 0V6.666c0-.367.298-.665.665-.665"/></g><path data-icon-expanded fill-rule="evenodd" clip-rule="evenodd" d="M14.5 2.877a3.665 3.665 0 0 1 3.665 3.665v6.917a3.665 3.665 0 0 1-3.665 3.665h-9a3.665 3.665 0 0 1-3.665-3.665V6.542A3.665 3.665 0 0 1 5.5 2.877zM8.165 15.794H14.5a2.335 2.335 0 0 0 2.335-2.335V6.542A2.335 2.335 0 0 0 14.5 4.207H8.165zM5.5 4.207a2.335 2.335 0 0 0-2.335 2.335v6.917A2.335 2.335 0 0 0 5.5 15.794h1.335V4.207z"/></svg>`;
      document.body.append(toggle);
    }
    let menu = document.getElementById('app-mode-compact-sidebar-actions');
    if (!menu) {
      menu = document.createElement('nav'); menu.id = 'app-mode-compact-sidebar-actions';
      menu.setAttribute('aria-label', 'App navigation');
      // Verified native sidebar icon geometry (20px filled artwork).
      // Verified native sidebar icon geometry (20px artwork in 36px hit areas).
      const fillIcon = icon => `<svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">${icon}</svg>`;
      const actions = [
        ['New chat', fillIcon('<path d="M8.16675 2.50127C8.53391 2.50127 8.83161 2.7992 8.83179 3.16631C8.83179 3.53358 8.53402 3.83135 8.16675 3.83135H5.83374C4.72836 3.83135 3.83197 4.72797 3.83179 5.8333V14.1663C3.83179 15.2718 4.72825 16.1683 5.83374 16.1683H14.1667C15.2722 16.1683 16.1687 15.2718 16.1687 14.1663V11.8333C16.1689 11.4662 16.4666 11.1683 16.8337 11.1683C17.2007 11.1684 17.4986 11.4663 17.4988 11.8333V14.1663C17.4988 16.0063 16.0068 17.4983 14.1667 17.4983H5.83374C3.99371 17.4983 2.50171 16.0063 2.50171 14.1663V5.8333C2.50189 3.99343 3.99382 2.50127 5.83374 2.50127H8.16675Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M13.4265 3.10381C14.3857 2.15908 15.9276 2.16466 16.8796 3.11651C17.8339 4.07106 17.8372 5.61827 16.8865 6.57647L11.7244 11.7786C11.3005 12.2058 10.7622 12.5027 10.1746 12.6321L7.78784 13.1565C7.20661 13.2842 6.6889 12.766 6.81714 12.1849L7.34253 9.80498C7.47294 9.21426 7.77197 8.67391 8.20288 8.24932L13.4265 3.10381ZM15.9392 4.05694C15.5038 3.62172 14.7988 3.61907 14.3601 4.05108L9.13647 9.19659C8.88861 9.44077 8.71644 9.75138 8.64136 10.0911L8.28979 11.6849L9.88843 11.3333C10.2265 11.2588 10.5362 11.0878 10.78 10.8421L15.9421 5.63897C16.3769 5.20075 16.3756 4.49352 15.9392 4.05694Z"/>')],
        ['Search', fillIcon('<path fill-rule="evenodd" clip-rule="evenodd" d="M9.161 2.379a6.707 6.707 0 0 1 5.157 10.993l3.242 3.243a.665.665 0 0 1-.94.94l-3.252-3.25A6.707 6.707 0 1 1 9.161 2.379m0 1.33a5.377 5.377 0 1 0 0 10.754 5.377 5.377 0 0 0 0-10.754"/>')],
        ['Scheduled', '<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.33" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M9.99996 5.8335V9.82757C9.99996 9.93808 9.95606 10.0441 9.87792 10.1222L7.91663 12.0835" stroke-linecap="round"/></svg>'],
        ['Library', fillIcon('<path fill-rule="evenodd" clip-rule="evenodd" d="M14.4021 2.64802C15.5977 2.4372 16.7381 3.23563 16.949 4.43122L18.7312 14.5416C18.942 15.7371 18.1444 16.8774 16.949 17.0884L15.4548 17.3511C14.2594 17.5618 13.1189 16.7643 12.908 15.5689L12.0515 10.7095V15.1334C12.0513 16.3473 11.0673 17.3316 9.85327 17.3316H8.33667C7.73973 17.3315 7.19954 17.0919 6.80347 16.7056C6.40733 17.0919 5.86729 17.3316 5.27026 17.3316H3.75366C2.53973 17.3315 1.5556 16.3473 1.55542 15.1334V4.86677C1.55549 3.65276 2.53966 2.6686 3.75366 2.66853H5.27026C5.86695 2.66853 6.4074 2.90664 6.80347 3.29255C7.19948 2.90662 7.74007 2.66866 8.33667 2.66853H9.85327C10.5993 2.66853 11.2576 3.04071 11.655 3.60896C11.972 3.25511 12.4048 3.00061 12.9089 2.91169L14.4021 2.64802ZM15.6394 4.66169C15.556 4.1897 15.1056 3.87452 14.6335 3.95759L13.1394 4.22126C12.6674 4.30473 12.3521 4.75503 12.4353 5.22712L14.2185 15.3375C14.3018 15.8097 14.7521 16.1248 15.2244 16.0416L16.7175 15.7779C17.1897 15.6946 17.5047 15.2452 17.4216 14.773L15.6394 4.66169ZM3.75366 3.9986C3.2742 3.99868 2.88557 4.3873 2.8855 4.86677V15.1334C2.88568 15.6127 3.27427 16.0015 3.75366 16.0015H5.27026C5.74972 16.0015 6.13825 15.6128 6.13843 15.1334V4.86677C6.13836 4.38726 5.74979 3.9986 5.27026 3.9986H3.75366ZM8.33667 3.9986C7.85737 3.99887 7.46858 4.38743 7.46851 4.86677V15.1334C7.46869 15.6126 7.85744 16.0013 8.33667 16.0015H9.85327C10.3327 16.0015 10.7213 15.6128 10.7214 15.1334C10.7214 4.38726 10.3328 3.9986 9.85327 3.9986H8.33667Z"/>')],
        ['Plugins', fillIcon('<path fill-rule="evenodd" clip-rule="evenodd" d="M10.522 1.88c5.201 0 7.787 3.839 7.787 7.308 0 1.475-.615 2.977-1.706 3.845a3.22 3.22 0 0 1-2.021.723c-.661 0-1.346-.203-2.03-.617-.673.536-1.486.903-2.358.903-.827 0-1.625-.33-2.282-1.013l-.039-.04-1.266-1.332-.059-.068a.87.87 0 0 1 .084-1.166l.212-.205-.988-1.02a.664.664 0 1 1 .955-.926l.991 1.024 1.793-1.727-.987-1.018a.663.663 0 0 1 .476-1.128c.174 0 .348.068.479.203l.99 1.021c.267-.256.438-.458.83-.458.23 0 .46.09.632.271l1.303 1.37c.636.655.943 1.417.943 2.198 0 .777-.301 1.497-.755 2.117.403.201.763.28 1.076.28.445 0 .847-.158 1.193-.433.715-.57 1.204-1.653 1.204-2.805 0-2.823-2.076-5.976-6.457-5.976-3.66 0-6.822 2.797-7.068 6.316a8 8 0 0 0-.018.533c0 3.7 2.722 6.729 6.771 6.73 1.612 0 3.205-.404 4.31-1.26a.665.665 0 1 1 .815 1.052c-1.414 1.094-3.33 1.537-5.125 1.537-4.831 0-8.102-3.67-8.102-8.062q0-.309.022-.622c.299-4.273 4.094-7.554 8.395-7.554m-2.64 9.186.957 1.008.035.036c.412.426.865.601 1.319.601q.075 0 .151-.006c.525-.044 1.109-.32 1.652-.842.49-.471.935-1.129.935-1.834 0-.424-.162-.857-.57-1.276l-.006-.006-.988-1.036z"/>')],
        ['Explore', fillIcon('<path d="M4.1665 8.50146C4.9939 8.50146 5.66535 9.17215 5.66553 9.99951C5.66553 10.827 4.99401 11.4985 4.1665 11.4985C3.33915 11.4984 2.66846 10.8269 2.66846 9.99951C2.66863 9.17226 3.33926 8.50164 4.1665 8.50146Z"/><path d="M9.99951 8.50146C10.8269 8.50146 11.4984 9.17215 11.4985 9.99951C11.4985 10.827 10.827 11.4985 9.99951 11.4985C9.17227 11.4982 8.50146 10.8268 8.50146 9.99951C8.50164 9.17234 9.17238 8.50177 9.99951 8.50146Z"/><path d="M15.8335 8.50146C16.6607 8.50166 17.3323 9.17228 17.3325 9.99951C17.3325 10.8269 16.6608 11.4983 15.8335 11.4985C15.0061 11.4984 14.3354 10.8269 14.3354 9.99951C14.3356 9.17226 15.0062 8.50164 15.8335 8.50146Z"/>')]
      ];
      for (const [label, icon] of actions.filter(([label]) => !persistentRailEnabled || !['Search', 'New chat'].includes(label))) {
        const action = document.createElement('button'); action.type = 'button';
        action.setAttribute('data-app-mode-sidebar-action', ''); action.setAttribute('aria-label', label); action.title = label;
        action.innerHTML = icon;
        // Align Search with the native expanded sidebar's header row.
        if (label === 'Search') menu.prepend(action); else menu.append(action);
      }
      // Navigation-section shortcuts mirror the expanded sidebar's own
      // sections. Semantically matched native icon geometry.
      const divider = document.createElement('div');
      divider.setAttribute('data-app-mode-rail-divider', ''); divider.setAttribute('aria-hidden', 'true');
      if (!persistentRailEnabled) menu.append(divider);
      const sections = [
        ['Pinned', 'pinned', fillIcon('<path fill-rule="evenodd" clip-rule="evenodd" d="M10.866 2.837c.82-1.222 2.536-1.33 3.554-.336l.003.003 3.054 3.019.002.003c.536.535.7 1.25.626 1.888-.073.63-.384 1.256-.9 1.655l-.01.007-.01.007-3.017 2.156a1 1 0 0 0-.4.615l-.662 3.239-.004.02-.055.186c-.273.82-.885 1.48-1.661 1.747-.858.295-1.817.076-2.57-.733l-2.111-2.077L2.97 17.97a.666.666 0 0 1-.942-.94l3.729-3.73-1.99-1.958c-.737-.716-.987-1.692-.74-2.562.246-.872.97-1.567 2.014-1.771l3.1-.716c.241-.056.454-.2.596-.403zm2.624.615c-.459-.447-1.194-.366-1.524.132l-.004.007-.005.007L9.83 6.652c-.33.474-.826.808-1.39.938l-3.1.716-.027.006c-.584.108-.901.46-1.007.832-.093.332-.033.738.254 1.096l.138.15.004.006 5.047 4.97.013.012.011.013c.428.469.852.51 1.18.397.363-.125.713-.478.855-.99l.657-3.21c.118-.578.45-1.09.93-1.432l3.001-2.144c.193-.15.352-.43.389-.751.036-.313-.05-.596-.243-.792z"/>')],
        ['Projects', 'projects', fillIcon('<path fill-rule="evenodd" clip-rule="evenodd" d="M6.995 2.7c.454 0 .899.135 1.276.387l1.66 1.106c.17.114.37.174.574.174H15.3A2.834 2.834 0 0 1 18.134 7.2v7.134a2.967 2.967 0 0 1-2.967 2.967H4.833a2.967 2.967 0 0 1-2.967-2.967V5.667A2.967 2.967 0 0 1 4.833 2.7zm9.871 7.1H3.134v4.534c0 .939.76 1.7 1.699 1.7h10.334a1.7 1.7 0 0 0 1.7-1.7zM3.134 8.534h13.732V7.2c0-.865-.701-1.566-1.566-1.566h-4.795c-.454 0-.899-.134-1.276-.386l-1.66-1.107a1.03 1.03 0 0 0-.574-.173H4.833a1.7 1.7 0 0 0-1.7 1.699z"/>')],
        ['Recents', 'recents', fillIcon('<path d="M10.833 11.044a.665.665 0 1 1 0 1.33h-3.75a.666.666 0 0 1 0-1.33zM12.916 7.627a.665.665 0 1 1 0 1.33H7.083a.665.665 0 0 1 0-1.33z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M10 2.252c4.473 0 8.165 3.433 8.165 7.748 0 4.314-3.692 7.749-8.165 7.749-1.52 0-2.804-.453-4.06-1.04l-2.204.572a.832.832 0 0 1-1.02-.985l.463-2.09C2.537 12.954 1.835 11.73 1.835 10c0-4.315 3.692-7.748 8.165-7.748m0 1.33C6.189 3.582 3.165 6.49 3.165 10c0 1.414.567 2.35 1.282 3.765.087.171.111.368.07.555l-.327 1.469 1.59-.411.145-.025a.8.8 0 0 1 .287.029l.136.05.459.212c1.062.472 2.06.775 3.193.775 3.811 0 6.835-2.91 6.835-6.42S13.811 3.583 10 3.583"/>')]
      ];
      for (const [label, key, icon] of persistentRailEnabled ? [] : sections) {
        const action = document.createElement('button'); action.type = 'button';
        action.setAttribute('data-app-mode-sidebar-action', ''); action.setAttribute('data-app-mode-rail-section', key);
        action.setAttribute('aria-expanded', 'false');
        action.setAttribute('aria-label', label); action.title = label;
        action.innerHTML = icon;
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
      account.innerHTML = '<svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M10 10.989a7.105 7.105 0 0 1 7.076 6.482.666.666 0 0 1-1.325.115 5.775 5.775 0 0 0-11.504 0 .666.666 0 0 1-1.324-.115 7.104 7.104 0 0 1 7.076-6.482"/><path fill-rule="evenodd" clip-rule="evenodd" d="M10 1.756a3.986 3.986 0 1 1-.002 7.971A3.986 3.986 0 0 1 10 1.756m0 1.33a2.656 2.656 0 1 0 0 5.31 2.656 2.656 0 0 0 0-5.31"/></svg>';
      menu.append(account);
    }
    const activeDestination = navigationAdapter.activeDestination(model);
    for (const action of menu.querySelectorAll('[data-app-mode-sidebar-action]')) {
      const selected = !!activeDestination && activeDestination ===
        (action.getAttribute('data-app-mode-rail-section') || action.getAttribute('aria-label'));
      action.toggleAttribute('data-app-mode-rail-active', selected);
      if (selected) { if (action.getAttribute('aria-current') !== 'page') action.setAttribute('aria-current', 'page'); }
      else action.removeAttribute('aria-current');
    }
    own(document.body, 'data-app-mode-navigation-state', state);
    if (hostNavigation.ready && hostNavigation.visible && hostNavigation.read().state !== 'unavailable') own(document.body, 'data-app-mode-host-navigation-owned');
    if (model.blocked) {
      own(document.body, 'data-app-mode-navigation-blocked');
      own(toggle, 'inert');
      own(menu, 'inert');
    }
    // A fading rail must leave keyboard/pointer navigation immediately.
    if (state === 'drawer' || (!persistentRailEnabled && state !== 'compact')) own(menu, 'inert');
    if (persistentRailEnabled) own(document.body, 'data-app-mode-persistent-rail');
    own(nativeRail, 'data-app-mode-native-sidebar');
    if (persistentRailEnabled && model.railReserved) own(nativeRail, 'data-app-mode-rail-reservation');
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
    if (hostNavigation.ready && hostNavigation.visible && hostNavigation.read().toggle) own(modalClose, 'data-app-mode-sidebar-original');
    // Only compact navigation needs the 52px rail reservation. A rendered
    // docked panel or drawer is the expanded navigation surface, so it starts
    // at the page origin and the workspace gets that width back.
    const navRailReserved = persistentRailEnabled ? model.railReserved : nativeRail && nativeRail.getBoundingClientRect().width > 0 &&
      [...nativeRail.querySelectorAll('button, a')].filter(element => element.getClientRects().length).length > 1;
    const sectionPopover = navigationController.flyout?.kind === 'native' && !!model.drawer;
    if ((state === 'compact' || sectionPopover || (persistentRailEnabled && state === 'docked')) &&
        !navRailReserved && (state === 'docked' || !model.reservedRail)) own(root, 'data-app-mode-compact-sidebar-shell');
    // The rounded Codex workspace is the single rendered content main inside
    // the shell. Ambiguous structure keeps the native, unmarked layout.
    const contentMains = [...root.querySelectorAll('main')].filter(element =>
      element.getClientRects().length && !element.closest('aside, nav, [role="dialog"]'));
    if (contentMains.length === 1) {
      const workspace = contentMains[0];
      own(workspace, 'data-app-mode-workspace');
      // Recognize the clipped content surface adjoining the contextual row.
      // Both share the main's paint; only the content's lower corners round.
      // Use unambiguous geometry and leave unknown layouts native.
      const box = workspace.getBoundingClientRect();
      const headers = [...workspace.children].filter(element =>
        element.matches('header, [role="banner"]') && element.getClientRects().length &&
        Math.abs(element.getBoundingClientRect().top - box.top) <= 1 &&
        Math.abs(element.getBoundingClientRect().height - 40) <= 1);
      if (headers.length === 1) {
        const headerBox = headers[0].getBoundingClientRect();
        const surfaces = [...workspace.children].filter(element => {
          const style = getComputedStyle(element);
          const surfaceBox = element.getBoundingClientRect();
          return element !== headers[0] && element.getClientRects().length &&
            Math.abs(surfaceBox.top - headerBox.bottom) <= 1 &&
            Math.abs(surfaceBox.bottom - box.bottom) <= 1 &&
            Math.abs(surfaceBox.left - box.left) <= 1 &&
            Math.abs(surfaceBox.right - box.right) <= 1 &&
            surfaceBox.height > 0 && style.position !== 'static' &&
            (style.overflowX === 'hidden' || style.overflowX === 'clip') &&
            (style.overflowY === 'hidden' || style.overflowY === 'clip');
        });
        if (surfaces.length === 1) own(surfaces[0], 'data-app-mode-workspace-surface');
      }
    }
    // Hide duplicate toggles only once a working replacement exists. Keep the
    // modal's native close control inside its focus trap as a fallback.
    const duplicates = new Set([
      ...document.querySelectorAll('header button, [role="banner"] button, [data-app-mode-header-layout] button'),
      ...(dockedPanel?.querySelectorAll('button') || [])
    ]);
    for (const control of duplicates) {
      if (/^(?:(open|show|hide|close) sidebar|sidebar)$/i.test(accessibleName(control)) &&
          !control.closest('[role="dialog"]')) own(control, 'data-app-mode-sidebar-original');
    }
    if (nativeToggle && !nativeToggle.closest('[role="dialog"]')) own(nativeToggle, 'data-app-mode-sidebar-original');
    const open = state !== 'compact';
    own(toggle, 'aria-expanded', String(open));
    own(toggle, 'aria-label', open ? 'Close sidebar' : 'Open sidebar');
    const label = open ? 'Close sidebar' : 'Open sidebar';
    if (toggle.title !== label) toggle.title = label;
    navigationController.reconcileSections(model.drawer || dockedPanel, own);
    let fallbackFocus = null;
    if (persistentRailEnabled) {
      // Either expanded surface presents the same unified navigation: rail
      // utilities are suppressed inside the panel or modal drawer alike.
      const expandedPanel = dockedPanel || model.drawer;
      for (const action of menu.querySelectorAll('[data-app-mode-sidebar-action]')) {
        const label = action.getAttribute('aria-label');
        const target = navigationAdapter.find(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), { interactive: !model.blocked });
        const account = action.hasAttribute('data-app-mode-rail-account');
        if (navigationController.rejectedUtilities.has(target) && document.activeElement === action) fallbackFocus = target;
        if (account && expandedPanel && target && expandedPanel.contains(target) &&
            getComputedStyle(target).visibility === 'visible') own(action, 'data-app-mode-rail-unavailable');
        if (!account && target && expandedPanel?.contains(target) && target.closest('[data-app-mode-nav-primary]') && !target.closest('section') &&
            !navigationController.rejectedUtilities.has(target)) own(target, 'data-app-mode-rail-original');
        if (!account && (navigationController.rejectedUtilities.has(target) || (!target && expandedPanel))) own(action, 'data-app-mode-rail-unavailable');
      }
    }
    const flyout = navigationController.flyout;
    if (flyout?.kind === 'native' && flyout.element === model.drawer) {
      own(model.drawer, 'data-app-mode-section-flyout');
      if (flyout.section) {
        own(flyout.section, 'data-app-mode-section-flyout-current');
        for (const section of model.drawer.querySelectorAll('section[class~="group/nav-section"]')) {
          if (section !== flyout.section && !section.contains(flyout.section) && !flyout.section.contains(section)) own(section, 'data-app-mode-section-flyout-hidden');
        }
        for (let parent = flyout.navigation; parent && parent !== model.drawer; parent = parent.parentElement) own(parent, 'data-app-mode-section-flyout-container');
      }
    }
    const previous = navigationController.state;
    navigationController.apply(next);
    if (fallbackFocus?.isConnected && !model.blocked && !fallbackFocus.closest('[inert], [aria-hidden="true"]') &&
        fallbackFocus.getClientRects().length && getComputedStyle(fallbackFocus).visibility === 'visible') fallbackFocus.focus({ preventScroll: true });
    navigationController.reconcileGeometry(model, contentMains.length === 1 ? contentMains[0] : null);
    navigationController.state = state;
    navigationController.root = root;
    if (previous === 'drawer' && state !== 'drawer' &&
        (document.activeElement === document.body || document.activeElement?.hasAttribute('data-app-mode-sidebar-original'))) {
      toggle.focus({ preventScroll: true });
    }
    const restore = navigationController.pendingFlyoutFocus;
    if (restore && state === 'compact' && !model.blocked) {
      const target = menu.querySelector(`[data-app-mode-rail-section="${restore.key}"]`);
      if (restore.root !== root || restore.route !== location.href) navigationController.pendingFlyoutFocus = null;
      else if (target?.getClientRects().length && !target.closest('[inert], [aria-hidden="true"]')) {
        navigationController.pendingFlyoutFocus = null; target.focus({ preventScroll: true });
      }
    }
  }


  }
})();
