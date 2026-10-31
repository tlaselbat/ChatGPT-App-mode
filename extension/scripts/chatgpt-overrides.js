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
  let detectedTrigger = null;

  // Desktop-only presentation: the site switches to tablet/mobile shells
  // (slideover sidebar, alternate header controls) whenever the narrow app
  // window makes its width media queries false. Spoof matchMedia so width
  // queries always evaluate against a fixed desktop width; the site re-reads
  // it on every render, so components pick the desktop branch without a
  // reload. Non-width queries fall through to the real implementation.
  const DESKTOP_WIDTH = 1280;
  const nativeMatchMedia = window.matchMedia.bind(window);
  function evaluateWidthQuery(query) {
    const feature = /^\(\s*(min|max)?-?width\s*:\s*([\d.]+)px\s*\)$/i;
    const evalPart = part => {
      const match = feature.exec(part.trim());
      if (!match) return null;
      const value = Number(match[2]);
      const kind = (match[1] || '').toLowerCase();
      if (kind === 'min') return DESKTOP_WIDTH >= value;
      if (kind === 'max') return DESKTOP_WIDTH <= value;
      return DESKTOP_WIDTH === value;
    };
    let sawUnknown = false;
    const matched = query.split(',').some(orPart =>
      orPart.split(/\band\b/i).every(andPart => {
        const result = evalPart(andPart);
        if (result === null) sawUnknown = true;
        return result === true;
      }));
    return sawUnknown ? null : matched;
  }
  function fakeMediaQueryList(query, matches) {
    return {
      matches, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
      dispatchEvent() { return false; }
    };
  }
  try {
    window.matchMedia = query => {
      const result = /\bwidth\b/i.test(query) ? evaluateWidthQuery(query) : null;
      return result === null ? nativeMatchMedia(query) : fakeMediaQueryList(query, result);
    };
  } catch { /* Keep the native matchMedia if the page blocks the override. */ }

  // Same treatment for the site's own stylesheets: a desktop-only app window
  // should never evaluate mobile/tablet media rules. Any @media rule whose
  // condition contains a width feature is evaluated against the fixed
  // desktop viewport and deleted when it would not match — width-driven
  // variants then cannot apply at any window size. Non-width media rules
  // (reduced motion, color scheme, print) are left untouched.
  const widthFeature = /\((?:min-|max-)?width\b|\((?:min|max)-width\s*:/i;
  function mediaMatchesDesktop(mediaText) {
    const featureRe = /\(([^)]+)\)/g;
    return mediaText.split(',').some(orPart => {
      let m;
      let result = true;
      while ((m = featureRe.exec(orPart)) !== null) {
        const feature = m[1].trim();
        if (/^(min|max)?-?width|^(min|max)-(device-)?width/i.test(feature) || /^\bwidth\s*:/i.test(feature)) {
          const ev = evaluateWidthQuery(`(${feature})`);
          if (ev === null) return false;
          result = result && ev;
        } else {
          // Defer non-width features to the real matcher (single-feature
          // queries like "(prefers-reduced-motion: reduce)").
          result = result && nativeMatchMedia(`(${feature})`).matches;
        }
        featureRe.lastIndex = m.index + m[0].length;
      }
      if (/\bnot\b/i.test(orPart)) result = !result;
      return result;
    });
  }
  const mediaRuleCheckpoints = new WeakMap();
  function sweepMediaRules(parent) {
    let rules;
    try { rules = parent.cssRules; } catch { return; }
    for (let i = rules.length - 1; i >= 0; i -= 1) {
      const rule = rules[i];
      if (rule instanceof CSSMediaRule) {
        if (widthFeature.test(rule.media.mediaText)) {
          try { if (!mediaMatchesDesktop(rule.media.mediaText)) { parent.deleteRule(i); continue; } } catch { /* keep */ }
        }
        sweepMediaRules(rule);
      } else if (rule.cssRules) {
        sweepMediaRules(rule);
      }
    }
  }
  function neutralizeResponsiveMedia() {
    const sheets = [...document.styleSheets, ...(document.adoptedStyleSheets || [])];
    for (const sheet of sheets) {
      let count;
      try { count = sheet.cssRules.length; } catch { continue; }
      if (mediaRuleCheckpoints.get(sheet) === count) continue;
      sweepMediaRules(sheet);
      try { mediaRuleCheckpoints.set(sheet, sheet.cssRules.length); } catch { /* read-only */ }
    }
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
    detectedTrigger = trigger || null;
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

  // Two-row header: conversation actions and New Chat render in a compact
  // right-aligned band below the header. The original nodes stay in the site
  // tree and are only visually moved with fixed positioning, so React-owned
  // handlers and menu anchoring keep working. The transparent spacer row only
  // reserves clearance; controls themselves never get reparented.
  function clearSecondaryMarks() {
    for (const element of document.querySelectorAll('[data-app-mode-secondary-actions]')) {
      element.removeAttribute('data-app-mode-secondary-actions');
      element.style.removeProperty('--app-mode-secondary-dx');
      element.style.removeProperty('--app-mode-secondary-dy');
    }
    for (const node of document.querySelectorAll('[data-app-mode-secondary-clip]')) {
      node.removeAttribute('data-app-mode-secondary-clip');
      node.style.removeProperty('contain');
      node.style.removeProperty('overflow');
    }
    for (const node of document.querySelectorAll('[data-app-mode-secondary-slot]')) {
      node.removeAttribute('data-app-mode-secondary-slot');
    }
  }

  function ensureSecondaryRow() {
    const header = findVisiblePageElement('#page-header, #conversation-header, header, [role="banner"], [data-testid="page-header"]');
    let row = document.getElementById('chatgpt-app-mode-secondary-row');
    if (!header) {
      row?.remove();
      clearSecondaryMarks();
      return;
    }
    const controls = [...header.querySelectorAll('button, [role="button"], a[href]')]
      .filter(element => !element.closest('[role="menu"], [role="dialog"], [aria-hidden="true"], [inert]'));
    const ourToolbar = header.querySelector('.chatgpt-app-mode-toolbar');
    const sidebar = controls.find(element => element !== shareMenuTrigger &&
      (hasTestId(element, ['open-sidebar-button', 'close-sidebar-button']) || /sidebar/i.test(accessibleName(element))));
    // The second row holds the header's right-side action cluster: the options
    // trigger, any sibling controls (list view, etc.) and New Chat. Find the
    // deepest shared ancestor seeded from New Chat (or the detected options
    // trigger) that wraps the cluster without swallowing the sidebar control
    // or our injected toolbar. Seeding does not depend on a Share button being
    // present, so the cluster also moves on pages without sharing.
    const isNewChat = element => element !== shareMenuTrigger && element !== sidebar &&
      (hasTestId(element, ['create-new-chat-button', 'new-chat-button']) || /^new (chat|conversation)$/i.test(accessibleName(element)) ||
        /^new (chat|conversation)$/i.test(element.textContent.trim()));
    const newChats = controls.filter(isNewChat);
    const newChat = newChats[0] || null;
    // Right-half controls make up the actions cluster; every New Chat button
    // joins it wherever the site places it. A centered mode-switch strip
    // spans the midpoint and stays put for header.js.
    const headerBox = header.getBoundingClientRect();
    const headerMid = headerBox.left + headerBox.width / 2;
    // The centered mode-switch strip (Chat/Work tabs) collides with the
    // right-side caption zone whenever the expanded sidebar squeezes the
    // header, so it also qualifies the row on its own. Its children must be
    // excluded from the cluster — the container moves as one piece.
    const modeStrip = header.querySelector('[data-app-mode-header-tabs], [role="tablist"], [role="radiogroup"], [role="group"][aria-label*="mode" i]');
    const secondary = controls.filter(element => element !== sidebar &&
      (isNewChat(element) || element.getBoundingClientRect().left > headerMid) &&
      !element.hasAttribute('data-app-mode-relocated-share') &&
      !element.closest('[role="tablist"], [role="radiogroup"], [data-app-mode-header-tabs], [data-app-mode-header-mode-branch]') &&
      !(modeStrip && modeStrip.contains(element)) &&
      !(ourToolbar && ourToolbar.contains(element)));
    let group = null;
    const seed = (newChat?.isConnected && newChat) || (detectedTrigger?.isConnected && detectedTrigger) || null;
    // Without a conversation-actions anchor (options trigger, New Chat, or
    // the mode-switch strip), other headers keep their native layout.
    if (!seed && !modeStrip) {
      row?.remove();
      clearSecondaryMarks();
      return;
    }
    for (let node = seed?.parentElement; node && node !== header && header.contains(node); node = node.parentElement) {
      if (sidebar && node.contains(sidebar)) break;
      if (ourToolbar && node.contains(ourToolbar)) break;
      if (secondary.filter(element => node.contains(element)).length >= Math.min(2, secondary.length)) group = node;
    }
    const marked = new Set(group ? [group] : secondary);
    // The strip container joins the cluster as the leftmost item; its child
    // tabs stay excluded above so they are never marked separately. Skip it
    // when the moved group already carries it.
    if (modeStrip && ![...marked].some(element => element === modeStrip || element.contains(modeStrip))) marked.add(modeStrip);
    for (const element of document.querySelectorAll('[data-app-mode-secondary-actions]')) {
      if (!marked.has(element)) element.removeAttribute('data-app-mode-secondary-actions');
    }
    if (!marked.size) { row?.remove(); return; }
    if (!row) {
      row = document.createElement('div');
      row.id = 'chatgpt-app-mode-secondary-row';
    }
    if (row.parentElement !== header.parentElement || row.previousElementSibling !== header) header.after(row);
    // Right-align the cluster under the caption-controls inset. New Chat
    // controls stay rightmost; other controls keep their visual left-to-right
    // order. Some site ancestors create a fixed-position containing block
    // (transform/filter), so each element's containing-block origin is
    // measured from its rendered rect and left/top are written as deltas.
    const byLeft = (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left;
    const items = [...marked].filter(element => !isNewChat(element)).sort(byLeft)
      .concat([...marked].filter(isNewChat).sort(byLeft));
    // Keep the strip leftmost regardless of its centered original position.
    if (modeStrip && marked.has(modeStrip)) {
      const stripIndex = items.indexOf(modeStrip);
      if (stripIndex > 0) items.unshift(items.splice(stripIndex, 1)[0]);
    }
    if (!items.length) items.push(...marked);
    const rowTop = Math.round(headerBox.bottom) + 6;
    let nextRight = innerWidth - 10;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const element = items[index];
      if (!element.hasAttribute('data-app-mode-secondary-actions')) element.setAttribute('data-app-mode-secondary-actions', '');
      // Site wrappers may paint-clip their subtree (contain: paint or
      // overflow: hidden); a translated element would be cut off below the
      // header. Downgrade only those ancestors, keeping layout containment.
      for (let node = element.parentElement; node && node !== header; node = node.parentElement) {
        const nodeStyle = getComputedStyle(node);
        let clipped = false;
        if (/(^| )paint( |$)|^strict$|^content$/.test(nodeStyle.contain) && node.style.contain !== 'layout') {
          node.style.setProperty('contain', 'layout', 'important');
          clipped = true;
        }
        if (nodeStyle.overflow === 'hidden' && node.style.overflow !== 'visible') {
          node.style.setProperty('overflow', 'visible', 'important');
          clipped = true;
        }
        if (clipped && !node.hasAttribute('data-app-mode-secondary-clip')) node.setAttribute('data-app-mode-secondary-clip', '');
      }
      const rect = element.getBoundingClientRect();
      // Measure the untransformed position so the delta converges instead of
      // snapping back to the origin on every observer pass.
      const matrix = /matrix\(([^)]+)\)/.exec(getComputedStyle(element).transform);
      const parts = matrix ? matrix[1].split(',').map(Number) : [];
      const naturalLeft = rect.left - (parts[4] || 0);
      const naturalTop = rect.top - (parts[5] || 0);
      const dxValue = `${Math.round(nextRight - naturalLeft - rect.width)}px`;
      const dyValue = `${Math.round(rowTop - naturalTop)}px`;
      if (element.style.getPropertyValue('--app-mode-secondary-dx') !== dxValue)
        element.style.setProperty('--app-mode-secondary-dx', dxValue);
      if (element.style.getPropertyValue('--app-mode-secondary-dy') !== dyValue)
        element.style.setProperty('--app-mode-secondary-dy', dyValue);
      nextRight -= rect.width + 6;
    }
    // Transforms keep the original boxes in layout, so vacated wrapper shells
    // still paint empty pills where the buttons used to sit. Hide each shell
    // whose visible interactive descendants all relocated (or are hidden);
    // the moved controls keep visibility:visible through the row CSS.
    const isMoved = element => element.closest('[data-app-mode-secondary-actions]') ||
      element.hasAttribute('data-app-mode-relocated-share') ||
      element.getBoundingClientRect().width === 0;
    const slots = new Set();
    for (const element of items) {
      for (let node = element.parentElement; node && node !== header; node = node.parentElement) {
        const stranded = [...node.querySelectorAll('button, [role="button"], a[href]')]
          .some(control => !control.closest('[aria-hidden="true"], [inert]') && !isMoved(control));
        if (stranded) break;
        slots.add(node);
      }
    }
    for (const element of document.querySelectorAll('[data-app-mode-secondary-slot]')) {
      if (!slots.has(element)) element.removeAttribute('data-app-mode-secondary-slot');
    }
    for (const element of slots) {
      if (!element.hasAttribute('data-app-mode-secondary-slot')) element.setAttribute('data-app-mode-secondary-slot', '');
    }
    const bottom = `${Math.round(header.getBoundingClientRect().bottom)}px`;
    if (document.body.style.getPropertyValue('--app-mode-header-bottom') !== bottom)
      document.body.style.setProperty('--app-mode-header-bottom', bottom);
  }

  // The mobile CSS branch sets --app-shell-left-panel-width: 0, which hides
  // the desktop left panel the matchMedia override renders. Only fill the
  // var while the site's value is ~0; once a real width exists the site owns
  // it again (open/close and drag-resize keep working).
  function ensureSidebarPanel() {
    const panel = document.querySelector('.app-shell-left-panel');
    if (!panel) return;
    // The site defines its shell vars on the Layout ancestor (rail width,
    // menu height) and consumes --app-shell-left-panel-width both on the
    // panel and on a sibling layout spacer, so the fallback must live on
    // that same element — a user resize then replaces it naturally.
    let host = panel;
    for (let el = panel.parentElement; el; el = el.parentElement) {
      if ((el.getAttribute('style') || '').includes('--app-shell-')) { host = el; break; }
    }
    const open = !!document.querySelector('[aria-controls="app-shell-sidebar"][aria-expanded="true"]');
    const target = open ? `${Math.min(340, Math.round(innerWidth * 0.62))}px` : '52px';
    const current = parseFloat(getComputedStyle(panel).getPropertyValue('--app-shell-left-panel-width')) || 0;
    // Any real width — ours, the site's, or a user resize — is left alone:
    // inline writes all land in the same property slot, so once the site or
    // the user writes a value it simply replaces the fallback.
    if (current > 10) return;
    const ours = host.style.getPropertyValue('--app-shell-left-panel-width');
    if (ours !== target) host.style.setProperty('--app-shell-left-panel-width', target);
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
    ensureSecondaryRow();
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
    neutralizeResponsiveMedia();
    ensurePinButton();
    ensureShareMenu();
    ensureSecondaryRow();
    ensureSidebarPanel();
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
})();
