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
    const header = document.querySelector('.chatgpt-app-mode-toolbar')?.parentElement;
    const next = new Map();
    function mark(element, attribute, value = '') {
      element.setAttribute(attribute, value);
      if (!next.has(element)) next.set(element, new Set());
      next.get(element).add(attribute);
    }
    if (header) {
      mark(header, 'data-app-mode-header-layout');
      let tabs = [...header.querySelectorAll('[role="tablist"], [role="radiogroup"], [data-app-mode-header-tabs]')].find(isModeSwitch);
      // The signed-in site's mode switch is a relative two-button grid inside
      // a fixed, full-window layer, rather than an ARIA tablist or an absolute
      // two-button group. Match its control structure without reading labels.
      if (!tabs) {
        const bounds = header.getBoundingClientRect();
        tabs = [...header.querySelectorAll('div')].find(element => {
          if (!visible(element)) return false;
          const buttons = [...element.children].filter(child => child.matches('button'));
          const box = element.getBoundingClientRect();
          const pressed = buttons.map(button => button.getAttribute('aria-pressed'));
          let fixedLayer = false;
          for (let node = element.parentElement; node && node !== header; node = node.parentElement) {
            const layer = node.getBoundingClientRect();
            if (getComputedStyle(node).position === 'fixed' && layer.width >= innerWidth * 0.8 && layer.top >= -2 && layer.bottom <= 64) fixedLayer = true;
          }
          return buttons.length === 2 && element.querySelectorAll('button').length === 2 &&
            pressed.includes('true') && pressed.includes('false') && fixedLayer &&
            getComputedStyle(element).display === 'grid' && box.top >= bounds.top - 2 && box.bottom <= bounds.bottom + 8;
        });
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
      // slightly taller than the 48px caption overlay, drifting their buttons
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
  navigator.windowControlsOverlay?.addEventListener('geometrychange', schedule);
  layout();
})();
