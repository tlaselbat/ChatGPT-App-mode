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

  observer = new MutationObserver(() => {
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

  titleElement = document.querySelector("title");
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

    installed = true;
  }
})();
