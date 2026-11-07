/* App Mode lifecycle and event coordinator. Load after the ordered feature scripts. */
(() => {
  const c = window.__APP_MODE_CONTEXT__;
  if (!c) return;
  if (c.reinjection) { c.reinjection = false; return; }
  if (!c.initialized || c.installed) return;
  with (c) {
  // Delegate in the capture phase: React may clone/replace the header nodes,
  // discarding per-button listeners, or handle bubbled header clicks itself.
  document.addEventListener("click", (event) => {
    const nativeSidebarToggle = event.target.closest?.('button, a, [role="button"]');
    if (nativeSidebarToggle && /^(open|show|hide|close) sidebar$/i.test(accessibleName(nativeSidebarToggle))) navigationController.captureGeometry();
    if (c.shareOverflow?.menu && !c.shareOverflow.menu.contains(event.target) && !c.shareOverflow.button.contains(event.target)) closeShareOverflow();
    const flyout = navigationController.flyout;
    if (flyout?.kind === 'native') {
      if (event.isTrusted && flyout.openedDisclosure?.contains(event.target)) flyout.openedDisclosure = null;
      if (flyout.element && (!flyout.element.contains(event.target) || event.target.closest?.('[data-app-mode-modal-sidebar-toggle]'))) navigationController.closeFlyout(true, true);
    } else if (flyout && !flyout.element.contains(event.target) && !event.target.closest?.('[data-app-mode-rail-section]')) navigationController.closeFlyout();
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
    const disclosure = event.target instanceof Element ? event.target.closest('[data-app-mode-nav-disclosure]') : null;
    if (disclosure) {
      event.preventDefault(); event.stopPropagation();
      navigationController.toggleSection(disclosure);
      return;
    }
    const button = event.target instanceof Element ? event.target.closest(`#${pinButtonId}`) : null;
    const sidebarAction = event.target instanceof Element ? event.target.closest('[data-app-mode-sidebar-action], #app-mode-compact-sidebar') : null;
    if (sidebarAction) {
      event.preventDefault(); event.stopPropagation();
      const label = sidebarAction.id === 'app-mode-compact-sidebar' ? /^(open|show|hide|close) sidebar$/i :
        new RegExp(`^${(sidebarAction.getAttribute('aria-label') || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      if (sidebarAction.getAttribute('aria-busy') !== 'true') {
        sidebarAction.setAttribute('aria-busy', 'true');
        const section = sidebarAction.getAttribute('data-app-mode-rail-section');
        const action = section ? navigationController.openSection(section, sidebarAction) :
          sidebarAction.id === 'app-mode-compact-sidebar' ? navigationAdapter.toggle() : navigationAdapter.activate(label);
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
    if (c.shareOverflow?.menu && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeShareOverflow(true); return;
    }
    if (c.shareOverflow?.menu && event.key === 'Tab') closeShareOverflow(true);
    if (c.shareOverflow?.menu?.contains(event.target) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); c.shareOverflow.menu.querySelector('button').focus(); return;
    }
    const flyout = navigationController.flyout;
    if (flyout?.kind === 'native' && event.key === 'Escape') {
      if (event.target instanceof Element && event.target.closest('[role="menu"], [role="listbox"]')) return;
      if (navigationAdapter.read().blocked) { navigationController.closeFlyout(false, true); return; }
      event.preventDefault(); event.stopPropagation(); navigationController.closeFlyout(true); return;
    }
    if (flyout && flyout.kind !== 'native' && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); navigationController.closeFlyout(true); return;
    }
    if (flyout && flyout.kind !== 'native' && flyout.element.contains(event.target) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const items = [...flyout.element.querySelectorAll('button')];
      const current = items.indexOf(document.activeElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
        (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      event.preventDefault(); event.stopPropagation(); items[index].focus(); return;
    }
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

  let reconciliationQueued = false;
  observer = new MutationObserver(records => {
    if (records.every(record => record.target?.closest?.('[data-app-mode-theme-probe]') ||
        (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(node => node.nodeType === 1 && node.hasAttribute('data-app-mode-theme-probe'))))) return;
    // Reconcile native layout in the next paint, not a second nested frame.
    navigationController.schedule();
    if (reconciliationQueued) return;
    reconciliationQueued = true;
    requestAnimationFrame(() => {
      reconciliationQueued = false;
      markBody();
      const header = findVisiblePageElement('#page-header, #conversation-header, header, [role="banner"], [data-testid="page-header"]');
      ensurePinButton(header);
      ensureShareMenu(header);
      reportCurrentSession();
      setTitle();
      c.checkReady?.();
    });
  });

  observer.observe(document.documentElement, {
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "href", "aria-hidden", "inert", "aria-current", "aria-selected", "aria-expanded", "aria-label", "aria-controls", "aria-haspopup", "data-testid", "id", "data-state", "disabled", "aria-disabled", "data-app-shell-responsive-sidebar", "data-app-shell-sidebar-open"],
    subtree: true
  });

  titleElement = document.querySelector("title");
  if (titleElement) {
    new MutationObserver(setTitle).observe(titleElement, {
      childList: true
    });
  }

  window.setInterval(reportCurrentSession, 3000);
  window.setInterval(() => {
    setTitle();
    if (!document.getElementById(pinButtonId)) { ensurePinButton(); navigationController.schedule(); }
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
  // Includes pushState/replaceState even when a SPA keeps the same DOM.
  window.navigation?.addEventListener('currententrychange', () => navigationController.schedule());
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => navigationController.cancelGeometry());
  window.addEventListener("resize", () => { closeShareOverflow(); ensureShareMenu(); navigationController.schedule(); });

    installed = true;
  }
})();
