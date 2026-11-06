/* Shared App Mode content-script context; classic script, ordered by manifest and Electron host. */
(() => {
  const c = window.__APP_MODE_CONTEXT__;
  if (!c || !c.initialized || c.reinjection) return;
  with (c) {
  c.actionGroupOf = function actionGroupOf(element, header) {
    // Buttons in the site's action strip may each sit in their own wrapper
    // (tooltip/slot containers). Treat one wrapper level as the same group.
    if (!element?.parentElement || element.parentElement === header) return element;
    return element.parentElement;
  }

  c.sameActionGroup = function sameActionGroup(a, b, header) {
    if (!a || !b) return false;
    if (a.parentElement === b.parentElement) return true;
    const groupA = actionGroupOf(a, header);
    const groupB = actionGroupOf(b, header);
    return groupA === groupB || groupA?.parentElement === groupB || groupB?.parentElement === groupA ||
      (groupA?.parentElement === groupB?.parentElement && groupA?.parentElement !== header);
  }

  c.hasTestId = function hasTestId(element, ids) {
    for (let node = element; node && node.getAttribute; node = node.parentElement) {
      const value = node.getAttribute('data-testid');
      if (value && ids.some(id => value === id || value.startsWith(`${id}-`))) return true;
    }
    return false;
  }

  c.accessibleName = function accessibleName(element) {
    return (element.getAttribute('aria-label') || element.getAttribute('title') || '').trim();
  }

  c.looksLikeOverflow = function looksLikeOverflow(element) {
    // An unlabeled trigger must still look like an ellipsis/kebab control:
    // icon-only content or explicit dots, never a named unrelated button.
    const text = element.textContent.trim();
    return !text || /^[.\u00b7\u2026\u22ef\u22ee]{1,5}$/.test(text);
  }

  c.ensureShareMenu = function ensureShareMenu(resolvedHeader) {
    const header = resolvedHeader === undefined ? findVisiblePageElement('#page-header, #conversation-header, header, [role="banner"], [data-testid="page-header"]') : resolvedHeader;
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
    setCompatibility('share', relocatedShare ? 'ready' : 'unsupported');
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


  }
})();
