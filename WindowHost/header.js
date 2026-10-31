// Normalize header layout without reading or saving page labels or data.
(() => {
  if (window.__appModeHeaderLayoutInstalled) return;
  window.__appModeHeaderLayoutInstalled = true;
  let queued = false;
  let marked = new Map();
  const legacyModeButtons = new WeakMap();
  const excluded = '[role="dialog"], [role="menu"], [role="listbox"], [aria-hidden="true"], [inert]';
  const visible = element => {
    if (element.closest(excluded)) return false;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.visibility !== 'collapse';
  };
  const isModeSwitch = element => {
    if (!visible(element)) return false;
    const buttons = [...element.querySelectorAll('button')].filter(visible);
    if (buttons.length !== 2) return false;
    if (buttons.some(button => ['aria-pressed', 'aria-selected', 'aria-checked'].some(attribute => button.hasAttribute(attribute)))) return true;
    const remembered = legacyModeButtons.get(element);
    return remembered?.length === 2 && buttons[0] === remembered[0] && buttons[1] === remembered[1] && element.querySelectorAll('button').length === 2;
  };
  function layout() {
    queued = false;
    // The app-owned title bar lives in a separate native view above the page;
    // this pass only normalizes the site's own header into the standard
    // secondary action row. The toolbar fallback mounts outside any header;
    // never treat its fallback host as the row.
    const toolbarHost = document.querySelector('.chatgpt-app-mode-toolbar')?.parentElement;
    const header = (toolbarHost && toolbarHost.id !== 'chatgpt-app-mode-toolbar-fallback' ? toolbarHost : null) ||
      [...document.querySelectorAll('#page-header, #conversation-header, header, [role="banner"], [data-testid="page-header"]')]
        .find(element => visible(element) && !element.closest('aside, nav'));
    const next = new Map();
    function mark(element, attribute, value = '') {
      element.setAttribute(attribute, value);
      if (!next.has(element)) next.set(element, new Set());
      next.get(element).add(attribute);
    }
    if (header && visible(header)) {
      mark(header, 'data-app-mode-header-layout');
      let tabs = [...header.querySelectorAll('[role="tablist"], [role="radiogroup"], [data-app-mode-header-tabs]')].find(isModeSwitch);
      // The signed-in site's mode switch is a relative two-button grid inside
      // a fixed, full-window layer, rather than an ARIA tablist or an absolute
      // two-button group. Match its control structure without reading labels.
      // A two-state switch is exactly two controls with one selected state.
      // Accept the site's current pressed/selected/data-state vocabulary and
      // buttons nested inside per-tab wrapper elements.
      const isSwitchControl = element => element.matches('button, [role="tab"], [role="radio"], [role="button"], a[href]');
      const switchState = element => ['aria-pressed', 'aria-selected', 'aria-checked']
        .map(attribute => element.getAttribute(attribute)).find(value => value === 'true' || value === 'false') ||
        (element.getAttribute('data-state') === 'active' || element.getAttribute('data-state') === 'inactive' ? element.getAttribute('data-state') : null);
      const switchButtons = element => [...element.querySelectorAll('button, [role="tab"], [role="radio"], a[href]')].filter(visible);
      if (!tabs) {
        const bounds = header.getBoundingClientRect();
        const candidates = [...header.querySelectorAll('div')].filter(element => {
          if (!visible(element)) return false;
          const buttons = switchButtons(element);
          if (buttons.length !== 2 || !buttons.every(isSwitchControl)) return false;
          const states = buttons.map(switchState);
          const box = element.getBoundingClientRect();
          let fixedLayer = false;
          for (let node = element.parentElement; node && node !== header; node = node.parentElement) {
            const layer = node.getBoundingClientRect();
            if (getComputedStyle(node).position === 'fixed' && layer.width >= innerWidth * 0.8 && layer.top >= -2 && layer.bottom <= 64) fixedLayer = true;
          }
          // One control selected, one not; stay inside the header's band.
          return (states.includes('true') || states.includes('active')) &&
            (states.includes('false') || states.includes('inactive')) && fixedLayer &&
            box.width <= bounds.width * 0.6 && box.top >= bounds.top - 2 && box.bottom <= bounds.bottom + 8;
        });
        // The switch is the tightest matching ancestor of both controls —
        // wrapper elements around it must not claim the marker.
        tabs = candidates.find(element => !candidates.some(other => other !== element && element.contains(other)));
      }
      if (!tabs) {
        // Older site versions omit roles. Match only an absolute two-button
        // group within the header's bounds; never normalize an open menu.
        const bounds = header.getBoundingClientRect();
        const positioned = [...header.querySelectorAll('div, span')].find(element => {
          if (!visible(element) || element.querySelectorAll('button').length !== 2) return false;
          const box = element.getBoundingClientRect();
          return getComputedStyle(element).position === 'absolute' &&
            box.width >= 80 && box.width >= box.height * 2 && Math.abs(box.x + box.width / 2 - bounds.x - bounds.width / 2) <= 8 &&
            box.top >= bounds.top - 2 && box.bottom <= bounds.bottom + 2;
        });
        if (positioned) {
          const buttons = [...positioned.querySelectorAll('button')];
          tabs = buttons[0].parentElement;
          while (tabs !== positioned && !tabs.contains(buttons[1])) tabs = tabs.parentElement;
          legacyModeButtons.set(tabs, [...tabs.querySelectorAll('button')]);
        }
      }
      // The site's own top rows (sidebar strip, conversation header) render
      // slightly taller than the 48px header strip, drifting their buttons
      // off the shared centerline. Cap every control-bearing row in the band.
      const probes = new Set();
      for (let x = 24; x < innerWidth; x += 96) for (const element of document.elementsFromPoint(x, 2)) probes.add(element);
      for (const element of probes) {
        const box = element.getBoundingClientRect();
        if (box.top > 1 || box.height < 40 || box.height > 64) continue;
        if (!visible(element) || !element.querySelector('button, a, [role="button"]')) continue;
        mark(element, 'data-app-mode-header-strip');
      }
      // Nested rows inside the managed bar are handled purely in CSS via
      // :has() so re-renders stay capped; per-node tagging leaves a frame
      // where the replaced node renders at the site's taller height.
      if (tabs) {
        mark(tabs, 'data-app-mode-header-tabs');
        for (let element = tabs; element && element !== header; element = element.parentElement) {
          mark(element, 'data-app-mode-header-tab-path');
        }
        let branch = tabs;
        while (branch.parentElement !== header) branch = branch.parentElement;
        mark(branch, 'data-app-mode-header-mode-branch');
        for (const child of header.children) {
          if (child === branch || child.classList.contains('chatgpt-app-mode-toolbar')) continue;
          const controls = [...child.querySelectorAll('button,a,[role="button"]')].filter(visible);
          if (!controls.length) continue;
          mark(child, 'data-app-mode-header-control-branch', child === header.firstElementChild ? 'leading' : 'actions');
          for (const control of controls) {
            if (control.matches('button') && control.querySelector('svg') && !control.textContent.trim()) {
              mark(control, 'data-app-mode-header-icon');
            }
            for (let node = control.parentElement; node && header.contains(node); node = node.parentElement) {
              if (getComputedStyle(node).display !== 'contents') {
                mark(node, 'data-app-mode-header-icon-path');
              }
              if (node === child) break;
            }
          }
        }
      }
      // Fallback containment: a fixed/absolute layer mounted directly inside
      // the managed header participates in the row — but only when its
      // interactive descendants are exactly the recognized two-state switch.
      // A layer that also carries other header actions must stay fully
      // native: marking it centered would displace them, and alternating
      // between marking the layer and an inner grid is what made the layout
      // unstable across reconciler passes.
      for (const child of header.children) {
        if (child.hasAttribute('data-app-mode-header-tab-path') || child.classList.contains('chatgpt-app-mode-toolbar')) continue;
        const style = getComputedStyle(child);
        if (!['fixed', 'absolute'].includes(style.position)) continue;
        const candidates = switchButtons(child).filter(isSwitchControl);
        const interactive = [...child.querySelectorAll('button, a[href], [role="button"], [role="tab"], [role="radio"]')].filter(visible);
        if (!tabs && interactive.length === 2 && candidates.length === 2) {
          const states = candidates.map(switchState);
          if ((states.includes('true') || states.includes('active')) && (states.includes('false') || states.includes('inactive'))) {
            mark(child, 'data-app-mode-header-tabs');
            mark(child, 'data-app-mode-header-tab-path');
            mark(child, 'data-app-mode-header-mode-branch');
          }
        }
      }
    }
    for (const [element, attributes] of marked) {
      const retained = next.get(element) || new Set();
      for (const attribute of attributes) {
        if (!retained.has(attribute)) element.removeAttribute(attribute);
      }
    }
    marked = next;
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(layout);
  }
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'inert'],
  });
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  layout();
})();
