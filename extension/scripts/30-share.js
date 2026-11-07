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

  c.closeShareOverflow = function closeShareOverflow(restore = false) {
    const state = c.shareOverflow;
    if (!state) return;
    state.menu?.remove(); state.menu = null;
    if (state.button.getAttribute('aria-expanded') !== 'false') state.button.setAttribute('aria-expanded', 'false');
    if (restore && state.button.isConnected) state.button.focus({ preventScroll: true });
  }

  c.ensureShareOverflow = function ensureShareOverflow(header, share, nativeTrigger) {
    let state = c.shareOverflow;
    if (state && (state.header !== header || state.share !== share || !state.button.isConnected || nativeTrigger)) {
      closeShareOverflow(); state.cancelFocus?.(); state.button.remove(); c.shareOverflow = state = null;
    }
    for (const stale of document.querySelectorAll('[data-app-mode-overflow]')) if (stale !== state?.button) stale.remove();
    if (!header || !share || nativeTrigger || c.failedShareActions?.has(share)) return nativeTrigger;
    if (!state) {
      const button = document.createElement('button');
      button.type = 'button'; button.setAttribute('data-app-mode-overflow', '');
      button.setAttribute('aria-label', 'Conversation options');
      button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', 'app-mode-share-overflow');
      button.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="13" cy="8" r="1.25"/></svg>';
      share.parentElement.append(button);
      c.shareOverflow = state = { header, share, button, menu: null, route: location.href };
      button.addEventListener('click', () => {
        if (c.shareOverflow !== state) return;
        if (state.menu) { closeShareOverflow(true); return; }
        if (!share.isConnected || share.disabled || share.getAttribute('aria-disabled') === 'true' || share.closest('[inert], [aria-hidden="true"]')) return;
        const menu = document.createElement('div');
        menu.id = 'app-mode-share-overflow'; menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Conversation options'); menu.setAttribute('data-app-mode-overflow-menu', '');
        const item = document.createElement('button'); item.type = 'button'; item.setAttribute('role', 'menuitem'); item.textContent = 'Share';
        item.addEventListener('click', () => {
          if (c.shareOverflow !== state || !share.isConnected || share.disabled || share.getAttribute('aria-disabled') === 'true' || share.closest('[inert], [aria-hidden="true"]')) return;
          closeShareOverflow(true);
          const existing = new Set(document.querySelectorAll('[role="dialog"]'));
          share.click();
          // Native dialogs may try to restore focus to the suppressed Share.
          // Follow only this invocation's new dialog and stop on replacement.
          state.cancelFocus?.();
          let dialog, timer;
          const stop = () => { observer.disconnect(); clearTimeout(timer); state.cancelFocus = null; };
          const check = () => {
            if (c.shareOverflow !== state || !button.isConnected || state.route !== location.href) { stop(); return; }
            if (!dialog) {
              dialog = [...document.querySelectorAll('[role="dialog"]')].find(node => !existing.has(node) && node.getClientRects().length);
              if (dialog) clearTimeout(timer);
              return;
            }
            if (dialog.isConnected && dialog.getClientRects().length && !dialog.closest('[aria-hidden="true"], [inert]')) return;
            stop();
            const active = document.activeElement;
            if (!button.closest('[inert], [aria-hidden="true"]') && (active === document.body || !active?.getClientRects().length)) button.focus({ preventScroll: true });
          };
          const observer = new MutationObserver(check);
          state.cancelFocus = stop;
          timer = setTimeout(() => {
            stop();
            if (c.shareOverflow !== state || !share.isConnected) return;
            // A callable node is not proof that its native action worked.
            // Restore the original entry point when delegation gives no UI.
            c.failedShareActions ||= new WeakSet(); c.failedShareActions.add(share);
            closeShareOverflow(); button.remove(); c.shareOverflow = null;
            share.removeAttribute('data-app-mode-relocated-share'); ensureShareMenu();
            if (document.activeElement === document.body) share.focus({ preventScroll: true });
          }, 3000);
          observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'aria-hidden', 'inert'] });
          check();
        });
        menu.append(item); document.body.append(menu); state.menu = menu;
        const box = button.getBoundingClientRect();
        menu.style.top = `${Math.min(box.bottom + 4, innerHeight - menu.offsetHeight - 8)}px`;
        menu.style.right = `${Math.max(8, innerWidth - box.right)}px`;
        button.setAttribute('aria-expanded', 'true'); item.focus();
      });
      button.addEventListener('keydown', event => {
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); if (!state.menu) button.click(); state.menu?.querySelector('button').focus(); }
      });
    }
    if (state.route !== location.href) { closeShareOverflow(); state.route = location.href; }
    const disabled = !!share.disabled || share.getAttribute('aria-disabled') === 'true';
    if (state.button.disabled !== disabled) state.button.disabled = disabled;
    if (state.button.disabled) closeShareOverflow();
    return state.button;
  }

  c.ensureShareMenu = function ensureShareMenu(resolvedHeader) {
    if (c.shareActionRoute !== location.href) { c.shareActionRoute = location.href; c.failedShareActions = new WeakSet(); }
    const header = resolvedHeader === undefined ? findVisiblePageElement('#page-header, #conversation-header, header, [role="banner"], [data-testid="page-header"]') : resolvedHeader;
    const retainedHeader = c.shareOverflow?.header || relocatedShare?.closest('#page-header, #conversation-header, header, [role="banner"], [data-testid="page-header"]');
    if (!header && retainedHeader?.isConnected && retainedHeader.getClientRects().length &&
        retainedHeader.closest('[inert], [aria-hidden="true"]') &&
        [...document.querySelectorAll('[role="dialog"]')].some(dialog => dialog.getClientRects().length && getComputedStyle(dialog).visibility !== 'hidden')) return;
    // Site assumptions: the conversation's own Share and options controls are
    // header actions with these accessible names/test IDs. The testid may sit
    // on the control or on a wrapper; the control itself may be a button, a
    // link, or a role=button element. Unknown markup keeps the original Share.
    // No visibility filter: once Share carries the hide attribute it reports
    // no boxes, and excluding it would toggle the attribute forever.
    const controls = header ? [...header.querySelectorAll('button, [role="button"], a[href]')]
      .filter(element => !element.closest('[role="menu"], [role="dialog"], [aria-hidden="true"], [inert], [data-app-mode-overflow]')) : [];
    const shares = controls.filter(element => hasTestId(element, ['share-chat-button', 'share-conversation-button', 'share-button']) ||
      /^share( (chat|conversation))?$/i.test(accessibleName(element)) || /^share$/i.test(element.textContent.trim()));
    // Prefer the current rendered Share over retained desktop/mobile copies.
    // Only our own suppressed source can use wrapper geometry for recovery.
    const share = shares.find(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden') ||
      shares.find(element => element.hasAttribute('data-app-mode-relocated-share') && !element.hidden &&
        element.parentElement.getClientRects().length && getComputedStyle(element.parentElement).visibility !== 'hidden');
    // Some site versions expose this as a popover/dialog, or omit haspopup.
    // Identify the named conversation control independently of that ARIA hint.
    const available = element => {
      const box = element.getBoundingClientRect();
      return !element.disabled && element.getAttribute('aria-disabled') !== 'true' && box.width > 0 && box.height > 0 &&
        box.right > 0 && box.left < innerWidth && getComputedStyle(element).visibility !== 'hidden';
    };
    let trigger = controls.find(element => element !== share && available(element) &&
      (hasTestId(element, ['conversation-options-button', 'chat-options-button', 'more-options-button']) ||
      /^(?:(?:open )?(?:conversation|chat|thread) (?:options|menu|actions|settings)|more( options| actions)?|options)$/i.test(accessibleName(element))));
    // The site's unlabeled ellipsis popup sits next to Share in the same
    // action group. Require that adjacency, wrapper-level grouping, popup or
    // ellipsis semantics; never select a settings, sidebar, or history menu.
    if (!trigger && share) {
      const index = controls.indexOf(share);
      trigger = [index - 1, index + 1].map(i => controls[i]).find(candidate =>
        candidate && available(candidate) && sameActionGroup(candidate, share, header) && !accessibleName(candidate) && looksLikeOverflow(candidate) &&
        (candidate.matches('[aria-haspopup="menu"], [aria-haspopup="dialog"]') ||
          /^(menu|dialog|listbox|true)$/.test(candidate.getAttribute('aria-haspopup') || '') ||
          candidate.getAttribute('aria-expanded') !== null || candidate.id && document.querySelector(`[aria-labelledby~="${candidate.id}"]`)));
    }
    // A breakpoint-hidden source must not leave a visible replacement for an
    // action in a different native header. Owned suppression is reversible.
    const shareSource = share && (share.hasAttribute('data-app-mode-relocated-share') ? share.parentElement : share);
    const usableShare = shareSource && shareSource.getClientRects().length && getComputedStyle(shareSource).visibility !== 'hidden' ? share : null;
    trigger = ensureShareOverflow(header, usableShare, trigger);
    if (relocatedShare && (relocatedShare !== share || !trigger)) relocatedShare.removeAttribute('data-app-mode-relocated-share');
    relocatedShare = trigger && share && !c.failedShareActions?.has(share) ? share : null;
    shareMenuTrigger = relocatedShare ? trigger : null;
    setCompatibility('share', relocatedShare ? 'ready' : share && c.failedShareActions?.has(share) ? 'degraded' : 'unsupported');
    if (relocatedShare && !relocatedShare.hasAttribute('data-app-mode-relocated-share')) relocatedShare.setAttribute('data-app-mode-relocated-share', '');
    if (trigger?.hasAttribute('data-app-mode-overflow')) {
      for (const item of document.querySelectorAll('[data-app-mode-share-menu-item]')) item.remove();
      return;
    }
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
