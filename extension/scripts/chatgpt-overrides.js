/*
  ChatGPT App Mode JS Overrides
  Do not store passwords, tokens, secrets, or conversation data here.
*/

(() => {
  const markerClass = "faux-chatgpt-app-mode";
  const pinButtonId = "chatgpt-app-mode-pin-toggle";
  const controlUrl = "http://127.0.0.1:17863/topmost";
  const sessionUrl = "http://127.0.0.1:17863/session";
  const cleanTitle = "ChatGPT";
  // Keep the same compact navigation surface across responsive breakpoints.
  const compactSidebarEnabled = window.__APP_MODE_COMPACT_SIDEBAR__ !== false;
  let lastReportedUrl = "";
  let lastReportedTitle = "";
  let sessionPending = false;
  let sessionRetryAt = 0;
  let retryDelay = 3000;
  let windowHandle = "";
  let windowProcessId = 0;
  let pinPending = false;
  let pinRevision = 0;
  let activityPending = false;
  let activityRetryAt = 0;
  let relocatedShare = null;
  let shareMenuTrigger = null;

  function nativeSidebarControl(label, { interactive = true } = {}) {
    return [...document.querySelectorAll('button, a, [role="button"]')].find(element =>
      !element.closest('#app-mode-compact-sidebar-actions, #app-mode-compact-sidebar') &&
      (!interactive || !element.closest('[aria-hidden="true"], [inert]')) &&
      (element.hasAttribute('data-app-mode-sidebar-original') || element.getClientRects().length) &&
      label.test(accessibleName(element) || element.textContent.trim()));
  }

  function waitForNavigation(predicate, timeoutMs = 2500) {
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

  function restoreTemporarySearchDrawer(root, drawer) {
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

  async function runSidebarAction(label) {
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
  const navigationAdapter = {
    find: nativeSidebarControl,
    activate: runSidebarAction,
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

  const navigationController = {
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
          if (!next.get(element)?.has(attribute)) element.removeAttribute(attribute);
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

  function ensureCompactSidebar() {
    const model = navigationController.read();
    const { root, rail: nativeRail, docked: dockedPanel, state } = model;
    // Do not replace navigation when the adapter cannot identify an entry point.
    const nativeToggle = navigationAdapter.find(/^(open|show|hide|close) sidebar$/i, { interactive: false }) ||
      model.drawer?.querySelector('button[aria-label="Hide sidebar" i], button[aria-label="Close sidebar" i]');
    const retainBlockedLayout = model.blocked && navigationController.root === root && navigationController.state !== null;
    if (!compactSidebarEnabled || !root || (!nativeToggle && !retainBlockedLayout)) {
      navigationController.reset();
      return;
    }
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
    own(document.body, 'data-app-mode-navigation-state', state);
    if (model.blocked) {
      own(document.body, 'data-app-mode-navigation-blocked');
      own(toggle, 'inert');
      own(menu, 'inert');
    }
    own(nativeRail, 'data-app-mode-native-sidebar');
    own(dockedPanel, 'data-app-mode-docked-sidebar');
    own(dockedPanel?.parentElement, 'data-app-mode-docked-sidebar-parent');
    const modalClose = model.drawer?.querySelector('button[aria-label="Hide sidebar" i], button[aria-label="Close sidebar" i]');
    own(modalClose, 'data-app-mode-modal-sidebar-toggle');
    if (!model.reservedRail && !dockedPanel) own(root, 'data-app-mode-compact-sidebar-shell');
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

  const homeLayoutController = { owned: new Map() };

  function ensureHomeLayout() {
    const next = new Map();
    const own = (element, attribute) => {
      if (!element) return;
      if (!next.has(element)) next.set(element, new Set());
      next.get(element).add(attribute);
      if (!element.hasAttribute(attribute)) element.setAttribute(attribute, '');
    };
    // Only the blank home route has a centered welcome/editor composition.
    // Keep every native node and handler; conversations retain native layout.
    if (location.pathname === '/') {
      const editor = [...document.querySelectorAll('main textarea, main [contenteditable="true"]')].find(element =>
        element.getClientRects().length && !element.closest('[role="dialog"], aside, nav'));
      const form = editor?.closest('form');
      const title = [...(form?.closest('main')?.querySelectorAll('h1') || [])].find(element =>
        element.getClientRects().length && !element.closest('[role="dialog"], aside, nav'));
      let common = title?.parentElement;
      while (common && !common.contains(form)) common = common.parentElement;
      const branch = element => {
        let rendered = null;
        for (let node = element; node && node !== common; node = node.parentElement) {
          if (getComputedStyle(node).display !== 'contents') rendered = node;
        }
        return rendered;
      };
      let layout = common;
      while (layout && getComputedStyle(layout).display === 'contents') layout = layout.parentElement;
      const hero = common && branch(title);
      const composer = common && branch(form);
      let group = null;
      for (let node = form?.parentElement; node && node !== composer; node = node.parentElement) {
        if ([...node.children].some(child => !child.contains(form) && child.querySelector('button, a[href]') && child.getBoundingClientRect().height > 0)) {
          group = node;
        }
      }
      // Validate two separate branches under the same native layout before
      // normalizing it. Unknown markup keeps ChatGPT's original presentation.
      if (form && title && layout && hero && composer && hero !== composer && layout !== form.closest('main') && layout !== document.body && layout !== document.documentElement) {
        own(layout, 'data-app-mode-home-layout');
        own(hero, 'data-app-mode-home-hero');
        own(title, 'data-app-mode-home-title');
        own(composer, 'data-app-mode-home-composer');
        for (let node = layout.parentElement; node && node !== form.closest('main'); node = node.parentElement) {
          if (getComputedStyle(node).scrollbarGutter !== 'auto') { own(node, 'data-app-mode-home-scroll'); break; }
        }
        own(group, 'data-app-mode-home-group');
        if (group) for (let node = group.parentElement; node && node !== composer; node = node.parentElement) own(node, 'data-app-mode-home-composer-path');
        if (group) for (const child of group.children) {
          if (!child.contains(form) && child.querySelector('button, a[href]')) own(child, 'data-app-mode-home-suggestions');
        }
        own(form, 'data-app-mode-home-form');
        let grid = editor.parentElement;
        while (grid && grid !== form && getComputedStyle(grid).display !== 'grid') grid = grid.parentElement;
        if (grid && grid !== form) {
          own(grid, 'data-app-mode-home-editor-grid');
          own(grid.parentElement, 'data-app-mode-home-card');
          const cell = [...grid.children].find(child => child.contains(editor));
          const controls = [...grid.children].filter(child => child !== cell && child.querySelector('button') && getComputedStyle(child).position !== 'absolute');
          if (cell && controls.length === 2) {
            own(cell, 'data-app-mode-home-editor-cell');
            own(controls[0], 'data-app-mode-home-leading');
            own(controls[1], 'data-app-mode-home-trailing');
            for (let node = editor.parentElement; node && node !== cell; node = node.parentElement) {
              if (getComputedStyle(node).display === 'flow-root') own(node, 'data-app-mode-home-editor-flow');
            }
            if (!editor.parentElement.querySelector('button')) own(editor.parentElement, 'data-app-mode-home-editor-line');
          }
        }
      }
    }
    for (const [element, attributes] of homeLayoutController.owned) {
      for (const attribute of attributes) if (!next.get(element)?.has(attribute)) element.removeAttribute(attribute);
    }
    homeLayoutController.owned = next;
  }

  function actionGroupOf(element, header) {
    // Buttons in the site's action strip may each sit in their own wrapper
    // (tooltip/slot containers). Treat one wrapper level as the same group.
    if (!element?.parentElement || element.parentElement === header) return element;
    return element.parentElement;
  }

  function sameActionGroup(a, b, header) {
    if (!a || !b) return false;
    if (a.parentElement === b.parentElement) return true;
    const groupA = actionGroupOf(a, header);
    const groupB = actionGroupOf(b, header);
    return groupA === groupB || groupA?.parentElement === groupB || groupB?.parentElement === groupA ||
      (groupA?.parentElement === groupB?.parentElement && groupA?.parentElement !== header);
  }

  function hasTestId(element, ids) {
    for (let node = element; node && node.getAttribute; node = node.parentElement) {
      const value = node.getAttribute('data-testid');
      if (value && ids.some(id => value === id || value.startsWith(`${id}-`))) return true;
    }
    return false;
  }

  function accessibleName(element) {
    return (element.getAttribute('aria-label') || element.getAttribute('title') || '').trim();
  }

  function looksLikeOverflow(element) {
    // An unlabeled trigger must still look like an ellipsis/kebab control:
    // icon-only content or explicit dots, never a named unrelated button.
    const text = element.textContent.trim();
    return !text || /^[.\u00b7\u2026\u22ef\u22ee]{1,5}$/.test(text);
  }

  function ensureShareMenu() {
    const header = findVisiblePageElement('#page-header, #conversation-header, header, [role="banner"], [data-testid="page-header"]');
    // Site assumptions: the conversation's own Share and options controls are
    // header actions with these accessible names/test IDs. The testid may sit
    // on the control or on a wrapper; the control itself may be a button, a
    // link, or a role=button element. Unknown markup keeps the original Share.
    // No visibility filter: once Share carries the hide attribute it reports
    // no boxes, and excluding it would toggle the attribute forever.
    const controls = header ? [...header.querySelectorAll('button, [role="button"], a[href]')]
      .filter(element => !element.closest('[role="menu"], [role="dialog"], [aria-hidden="true"], [inert]')) : [];
    const share = controls.find(element => hasTestId(element, ['share-chat-button', 'share-conversation-button', 'share-button']) ||
      /^share( (chat|conversation))?$/i.test(accessibleName(element)) || /^share$/i.test(element.textContent.trim()));
    // Some site versions expose this as a popover/dialog, or omit haspopup.
    // Identify the named conversation control independently of that ARIA hint.
    let trigger = controls.find(element => element !== share &&
      (hasTestId(element, ['conversation-options-button', 'chat-options-button', 'more-options-button']) ||
      /^(?:(?:open )?(?:conversation|chat|thread) (?:options|menu|actions|settings)|more( options| actions)?|options)$/i.test(accessibleName(element))));
    // The site's unlabeled ellipsis popup sits next to Share in the same
    // action group. Require that adjacency, wrapper-level grouping, popup or
    // ellipsis semantics; never select a settings, sidebar, or history menu.
    if (!trigger && share) {
      const index = controls.indexOf(share);
      trigger = [index - 1, index + 1].map(i => controls[i]).find(candidate =>
        candidate && sameActionGroup(candidate, share, header) && !accessibleName(candidate) && looksLikeOverflow(candidate) &&
        (candidate.matches('[aria-haspopup="menu"], [aria-haspopup="dialog"]') ||
          /^(menu|dialog|listbox|true)$/.test(candidate.getAttribute('aria-haspopup') || '') ||
          candidate.getAttribute('aria-expanded') !== null || candidate.id && document.querySelector(`[aria-labelledby~="${candidate.id}"]`)));
    }
    if (relocatedShare && (relocatedShare !== share || !trigger)) relocatedShare.removeAttribute('data-app-mode-relocated-share');
    relocatedShare = trigger && share ? share : null;
    shareMenuTrigger = relocatedShare ? trigger : null;
    if (relocatedShare && !relocatedShare.hasAttribute('data-app-mode-relocated-share')) relocatedShare.setAttribute('data-app-mode-relocated-share', '');
    const menus = [...document.querySelectorAll('[role="menu"]')].filter(menu => {
      const box = menu.getBoundingClientRect();
      return box.width && box.height && getComputedStyle(menu).visibility !== 'hidden' && !menu.closest('[aria-hidden="true"], [inert]');
    });
    // Correlate the visible menu with this trigger via ARIA wiring; a Radix
    // portal wrapper between them is fine. With exactly one visible menu an
    // expanded/open trigger is sufficient evidence it belongs to it.
    const menu = relocatedShare && menus.find(menu =>
      menu.id === trigger.getAttribute('aria-controls') ||
      (trigger.id && menu.getAttribute('aria-labelledby')?.split(/\s+/).includes(trigger.id)) ||
      (menus.length === 1 && (trigger.getAttribute('aria-expanded') === 'true' || trigger.getAttribute('data-state') === 'open')));
    for (const item of document.querySelectorAll('[data-app-mode-share-menu-item]')) {
      if (item.closest('[role="menu"]') !== menu) item.remove();
    }
    if (!menu) return;
    const menuItems = role => [...menu.querySelectorAll(`[role="${role}"]`)];
    const nativeShare = ['menuitem', 'menuitemcheckbox', 'menuitemradio'].some(role => menuItems(role).some(item =>
      !item.hasAttribute('data-app-mode-share-menu-item') &&
      (/^share( conversation)?$/i.test(item.textContent.trim()) || /^share( (chat|conversation))?$/i.test(item.getAttribute('aria-label')?.trim() || ''))));
    let item = menu.querySelector('[data-app-mode-share-menu-item]');
    if (nativeShare) { item?.remove(); return; }
    const sibling = menu.querySelector('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]');
    if (!item) {
      item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.tabIndex = -1;
      item.setAttribute('data-app-mode-share-menu-item', '');
      // Inherit the site's own menu-item classes so the entry renders like a
      // native row across themes instead of depending on our fallback rules.
      if (sibling?.getAttribute('class')) item.setAttribute('class', sibling.getAttribute('class'));
      item.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 16V3m-4 4 4-4 4 4M5 13v7h14v-7"/></svg><span>Share</span>';
      if (sibling) sibling.before(item); else menu.prepend(item);
    }
    const disabled = share.disabled || share.getAttribute('aria-disabled') === 'true';
    if (item.getAttribute('aria-disabled') !== String(disabled)) item.setAttribute('aria-disabled', String(disabled));
  }

  function markBody() {
    if (document.body && !document.body.classList.contains(markerClass)) {
      document.body.classList.add(markerClass);
    }
  }

  async function reportScrollActivity(event) {
    // Report only a transient activity pulse, never targets, text, coordinates, or wheel deltas.
    if (!event.isTrusted || !windowHandle || !windowProcessId || activityPending || performance.now() < activityRetryAt) return;
    const button = document.getElementById(pinButtonId);
    if (button?.getAttribute("aria-pressed") !== "true") return;
    activityPending = true;
    activityRetryAt = performance.now() + 250;
    try {
      await postJson(controlUrl, `action=activity&handle=${encodeURIComponent(windowHandle)}&processId=${windowProcessId}`);
    } catch {
      // No UI interruption or retry loop when the optional control server is offline.
      activityRetryAt = performance.now() + 3000;
    } finally {
      activityPending = false;
    }
  }

  function setTitle() {
    if (document.title !== cleanTitle) {
      document.title = cleanTitle;
    }
  }

  function init() {
    markBody();
    reportCurrentSession();
    setTitle();
    ensurePinButton();
    ensureShareMenu();
    ensureCompactSidebar();
    ensureHomeLayout();
  }

  function getCurrentChatId() {
    const match = window.location.pathname.match(/\/c\/([A-Za-z0-9-]+)/);
    return match ? match[1] : "";
  }

  function isRestorableChatGptPage() {
    const { hostname, pathname, protocol } = window.location;

    if (protocol !== "https:" || !["chatgpt.com", "chat.openai.com"].includes(hostname)) {
      return false;
    }

    return (
      pathname === "/" ||
      /^\/c\/[A-Za-z0-9-]+\/?$/.test(pathname) ||
      /^\/g\/[^/]+\/?$/.test(pathname) ||
      /^\/g\/[^/]+\/c\/[A-Za-z0-9-]+\/?$/.test(pathname)
    );
  }

  function cleanChatTitle(text) {
    if (!text) {
      return "";
    }

    return text
      .replace(/\s+/g, " ")
      .replace(/\s*[-|]\s*ChatGPT\s*$/i, "")
      .trim();
  }

  function getCurrentChatTitle() {
    const chatId = getCurrentChatId();
    if (!chatId) {
      return cleanChatTitle(document.title);
    }

    const selectors = [
      `a[aria-current="page"][href*="/c/${chatId}"]`,
      `a[href*="/c/${chatId}"]`,
      `[data-testid="history-item-${chatId}"]`,
      `nav a[href*="${chatId}"]`
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const title = cleanChatTitle(
        element?.getAttribute("aria-label") ||
        element?.getAttribute("title") ||
        element?.textContent
      );

      if (title && title !== "ChatGPT") {
        return title;
      }
    }

    return cleanChatTitle(document.title);
  }

  async function postJson(url, body) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      signal: controller.signal,
      body
      });
      if (!response.ok) {
        const error = new Error("App Mode control unavailable");
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function callTopMostControl(action) {
    // Bind only while this document is focused. Each background window keeps
    // its own validated HWND/PID instead of adopting another foreground window.
    const binding = action === "status" && document.hasFocus() ? "" : windowHandle;
    const result = await postJson(controlUrl,
      `action=${encodeURIComponent(action)}&handle=${encodeURIComponent(binding)}&processId=${windowProcessId}`);
    return result;
  }

  function applyTopMostBinding(result) {
    windowHandle = result.handle || "";
    windowProcessId = result.processId || 0;
  }

  function setPinState(button, enabled) {
    button.classList.toggle("is-active", enabled);
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    button.title = enabled ? "Always on top is on" : "Always on top is off";
    button.title += " (Alt+Shift+P)";
    button.classList.remove("is-unavailable");
    button.removeAttribute("data-unavailable");
  }

  function showPinError(button, error) {
    button.classList.add("is-unavailable");
    button.dataset.unavailable = "true";
    const focusError = error.status === 409;
    button.title = focusError
      ? "Activate this App Mode window, then click the pin again"
      : "Cannot reach App Mode control. Allow local-network access for ChatGPT if prompted, or restart the control server from Settings";
  }

  async function togglePin(button) {
    if (pinPending) return;
    pinPending = true;
    const revision = ++pinRevision;
    button.disabled = true;
    try {
      // Recover the current HWND/PID and native state on every user click.
      // Explicit on/off avoids a second toggle if a response is delayed/lost.
      const current = await callTopMostControl("status");
      if (revision !== pinRevision) return;
      applyTopMostBinding(current);
      const result = await callTopMostControl(current.enabled ? "off" : "on");
      if (revision !== pinRevision) return;
      applyTopMostBinding(result);
      setPinState(document.getElementById(pinButtonId) || button, Boolean(result.enabled));
    } catch (error) {
      showPinError(document.getElementById(pinButtonId) || button, error);
    } finally {
      pinPending = false;
      button.disabled = false;
      const currentButton = document.getElementById(pinButtonId);
      if (currentButton) currentButton.disabled = false;
    }
  }

  async function refreshPinState(button) {
    if (pinPending || (!document.hasFocus() && !windowHandle)) return;
    const revision = ++pinRevision;
    try {
      const result = await callTopMostControl("status");
      if (revision !== pinRevision) return;
      applyTopMostBinding(result);
      setPinState(button, Boolean(result.enabled));
    } catch (error) {
      if (revision !== pinRevision) return;
      showPinError(button, error);
    }
  }

  function findVisiblePageElement(selector) {
    return [...document.querySelectorAll(selector)].find(element => {
      if (element.closest('aside, nav, [role="dialog"], [aria-hidden="true"], [inert]')) return false;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.visibility !== "collapse";
    });
  }

  function ensurePinButton() {
    if (!document.body) return;
    // ChatGPT selectors are best-effort. A dedicated flow toolbar is used if
    // the site removes or renames its header; never float over conversation text.
    // Client navigation can keep previous pages mounted but hidden. Never
    // attach to their headers or leave a fallback inside their main element.
    const header = findVisiblePageElement('#page-header, #conversation-header, header, [role="banner"], [data-testid="page-header"]');
    const existing = document.getElementById(pinButtonId);
    if (existing) {
      const toolbar = existing.parentElement;
      const heldHeader = toolbar.parentElement;
      const modal = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!header && modal?.getBoundingClientRect().width > 0 && heldHeader?.matches('[data-app-mode-header-layout]') && heldHeader.closest('[aria-hidden="true"]') && heldHeader.getBoundingClientRect().width > 0 && getComputedStyle(heldHeader).visibility !== 'hidden') return;
      if (header && toolbar.parentElement !== header) {
        header.appendChild(toolbar);
        document.getElementById("chatgpt-app-mode-toolbar-fallback")?.remove();
      }
      if (!header) mountFallback(toolbar);
      return;
    }

    const toolbar = document.createElement("span");
    toolbar.className = "chatgpt-app-mode-toolbar";

    const button = document.createElement("button");
    button.id = pinButtonId;
    button.type = "button";
    button.className = "chatgpt-app-mode-pin-button";
    button.setAttribute("aria-label", "Toggle always on top");
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-keyshortcuts", "Alt+Shift+P");
    button.title = "Always on top is off";
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M8.2 3.5h7.6l-1.05 6.35 3.85 4.05v1.95H13.1L12 22l-1.1-6.15H5.4V13.9l3.85-4.05L8.2 3.5Z" />
      </svg>
    `;

    toolbar.appendChild(button);
    if (header) header.appendChild(toolbar);
    else mountFallback(toolbar);
    refreshPinState(button);
  }

  function mountFallback(toolbar) {
    const fallback = document.getElementById("chatgpt-app-mode-toolbar-fallback") || document.createElement("div");
    // Writing a filtered attribute unconditionally retriggers our own
    // MutationObserver forever; only assign when the value differs.
    if (fallback.id !== "chatgpt-app-mode-toolbar-fallback") fallback.id = "chatgpt-app-mode-toolbar-fallback";
    if (!fallback.hasAttribute("role")) {
      fallback.setAttribute("role", "toolbar");
      fallback.setAttribute("aria-label", "App Mode controls");
    }
    if (toolbar.parentElement !== fallback) fallback.appendChild(toolbar);
    // The app shell may fill and clip the viewport. Keep the fallback inside
    // its main flow rather than prepending an off-screen sibling to that shell.
    const host = findVisiblePageElement('main, [role="main"]') || document.body;
    if (fallback.parentElement !== host) host.prepend(fallback);
  }

  async function reportCurrentSession() {
    if (!isRestorableChatGptPage()) {
      return;
    }

    if (sessionPending || Date.now() < sessionRetryAt || !document.hasFocus()) return;
    // Persist only an approved route, never query/hash values.
    const currentUrl = window.location.origin + window.location.pathname;
    const currentTitle = getCurrentChatTitle();

    if (currentUrl === lastReportedUrl && currentTitle === lastReportedTitle) {
      return;
    }

    sessionPending = true;
    try {
      const result = await postJson(sessionUrl, `url=${encodeURIComponent(currentUrl)}&title=${encodeURIComponent(currentTitle)}`);
      if (!result.saved) throw new Error("Session not saved");
      lastReportedUrl = currentUrl;
      lastReportedTitle = currentTitle;
      retryDelay = 3000;
      sessionRetryAt = 0;
    } catch {
      sessionRetryAt = Date.now() + retryDelay;
      retryDelay = Math.min(retryDelay * 2, 30000);
    } finally {
      sessionPending = false;
    }
  }

  // Delegate in the capture phase: React may clone/replace the header nodes,
  // discarding per-button listeners, or handle bubbled header clicks itself.
  document.addEventListener("click", (event) => {
    const shareItem = event.target instanceof Element ? event.target.closest('[data-app-mode-share-menu-item]') : null;
    if (shareItem) {
      event.preventDefault();
      event.stopPropagation();
      const original = relocatedShare;
      const trigger = shareMenuTrigger;
      if (shareItem.getAttribute('aria-disabled') === 'true' || !original?.isConnected || !trigger?.isConnected) return;
      // Let the site's trigger dismiss its own menu before opening its original
      // Share dialog. Never recreate sharing, read conversation data, or publish.
      trigger.click();
      requestAnimationFrame(() => {
        if (original.isConnected && relocatedShare === original && !original.disabled && original.getAttribute('aria-disabled') !== 'true') original.click();
      });
      return;
    }
    const button = event.target instanceof Element ? event.target.closest(`#${pinButtonId}`) : null;
    const sidebarAction = event.target instanceof Element ? event.target.closest('[data-app-mode-sidebar-action], #app-mode-compact-sidebar') : null;
    if (sidebarAction) {
      event.preventDefault(); event.stopPropagation();
      const label = sidebarAction.id === 'app-mode-compact-sidebar' ? /^(open|show|hide|close) sidebar$/i :
        new RegExp(`^${sidebarAction.getAttribute('aria-label')}$`, 'i');
      if (sidebarAction.getAttribute('aria-busy') !== 'true') {
        sidebarAction.setAttribute('aria-busy', 'true');
        const action = sidebarAction.id === 'app-mode-compact-sidebar' ? navigationAdapter.toggle() : navigationAdapter.activate(label);
        action.finally(() => sidebarAction.removeAttribute('aria-busy'));
      }
      return;
    }
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    togglePin(button);
  }, true);

  // Include the added entry in the site's menu keyboard navigation without
  // relying on a framework's private roving-focus registry.
  document.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const menu = event.target instanceof Element ? event.target.closest('[role="menu"]') : null;
    if (!menu?.querySelector('[data-app-mode-share-menu-item]')) return;
    const items = [...menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')].filter(item =>
      item.closest('[role="menu"]') === menu && item.getAttribute('aria-disabled') !== 'true' && !item.disabled && item.getClientRects().length);
    if (!items.length) return;
    const current = items.findIndex(item => item === document.activeElement || item.contains(document.activeElement));
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
      (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    event.preventDefault(); event.stopPropagation(); items[index].focus();
  }, true);

  // Delegation survives ChatGPT navigation and replaced scroll containers.
  document.addEventListener("wheel", reportScrollActivity, { passive: true, capture: true });

  init();

  const observer = new MutationObserver(() => {
    markBody();
    ensurePinButton();
    ensureShareMenu();
    navigationController.schedule();
    reportCurrentSession();
    setTitle();
  });

  observer.observe(document.documentElement, {
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden", "inert", "aria-expanded", "aria-label", "aria-controls", "aria-haspopup", "data-testid", "id", "data-state", "disabled", "aria-disabled", "data-app-shell-responsive-sidebar", "data-app-shell-sidebar-open"],
    subtree: true
  });

  const titleElement = document.querySelector("title");
  if (titleElement) {
    new MutationObserver(setTitle).observe(titleElement, {
      childList: true
    });
  }

  window.setInterval(reportCurrentSession, 3000);
  window.setInterval(() => {
    setTitle();
    ensurePinButton();
    navigationController.schedule();
  }, 1000);
  window.setInterval(() => {
    const button = document.getElementById(pinButtonId);
    if (button && document.hasFocus()) refreshPinState(button);
  }, 5000);
  window.addEventListener("focus", () => {
    sessionRetryAt = 0;
    reportCurrentSession();
    const button = document.getElementById(pinButtonId);
    if (button) refreshPinState(button);
  });
  window.addEventListener("keydown", (event) => {
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyP" && !event.repeat) {
      event.preventDefault();
      document.getElementById(pinButtonId)?.click();
    }
  });
  window.addEventListener("popstate", init);
  window.addEventListener("hashchange", init);
  window.addEventListener("resize", () => navigationController.schedule());
})();
