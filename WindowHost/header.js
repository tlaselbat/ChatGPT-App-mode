// Normalize header layout without reading or saving page labels or data.
(() => {
  if (window.__appModeHeaderLayoutInstalled) return;
  window.__appModeHeaderLayoutInstalled = true;
  let queued = false;
  let marked = new Set();
  const excluded = '[role="dialog"], [role="menu"], [role="listbox"], [aria-hidden="true"], [inert]';
  const visible = element => !element.closest(excluded) && element.getBoundingClientRect().width > 0;
  function layout() {
    queued = false;
    const header = document.querySelector('.chatgpt-app-mode-toolbar')?.parentElement;
    const next = new Set();
    if (header) {
      header.setAttribute('data-app-mode-header-layout', '');
      next.add(header);
      let tabs = [...header.querySelectorAll('[role="tablist"], [role="radiogroup"], [data-app-mode-header-tabs]')].find(visible);
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
        if (!element.querySelector('button, a, [role="button"]')) continue;
        element.setAttribute('data-app-mode-header-strip', '');
        next.add(element);
      }
      // Nested rows inside the managed bar are handled purely in CSS via
      // :has() so re-renders stay capped; per-node tagging leaves a frame
      // where the replaced node renders at the site's taller height.
      if (tabs) {
        tabs.setAttribute('data-app-mode-header-tabs', '');
        next.add(tabs);
        for (let element = tabs; element && element !== header; element = element.parentElement) {
          element.setAttribute('data-app-mode-header-tab-path', '');
          next.add(element);
        }
        let branch = tabs;
        while (branch.parentElement !== header) branch = branch.parentElement;
        branch.setAttribute('data-app-mode-header-mode-branch', '');
        next.add(branch);
        for (const child of header.children) {
          if (child === branch || child.classList.contains('chatgpt-app-mode-toolbar')) continue;
          const controls = [...child.querySelectorAll('button,a,[role="button"]')].filter(visible);
          if (!controls.length) continue;
          child.setAttribute('data-app-mode-header-control-branch', child === header.firstElementChild ? 'leading' : 'actions');
          next.add(child);
          for (const control of controls) {
            if (control.matches('button') && control.querySelector('svg') && !control.textContent.trim()) {
              control.setAttribute('data-app-mode-header-icon', '');
              next.add(control);
            }
            for (let node = control.parentElement; node && header.contains(node); node = node.parentElement) {
              if (getComputedStyle(node).display !== 'contents') {
                node.setAttribute('data-app-mode-header-icon-path', ''); next.add(node);
              }
              if (node === child) break;
            }
          }
        }
      }
    }
    for (const element of marked) {
      if (next.has(element)) continue;
      for (const attribute of ['data-app-mode-header-layout', 'data-app-mode-header-tabs', 'data-app-mode-header-tab-path', 'data-app-mode-header-mode-branch', 'data-app-mode-header-control-branch', 'data-app-mode-header-icon-path', 'data-app-mode-header-icon', 'data-app-mode-header-strip']) element.removeAttribute(attribute);
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
  navigator.windowControlsOverlay?.addEventListener('geometrychange', schedule);
  layout();
})();
