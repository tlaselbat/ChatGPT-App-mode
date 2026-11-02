/* Shared App Mode content-script context; classic script, ordered by manifest and Electron host. */
(() => {
  const c = window.__APP_MODE_CONTEXT__;
  if (!c || !c.initialized || c.reinjection) return;
  with (c) {
  homeLayoutController = { owned: new Map(), activity: null, disclosure: null, expanded: false };

  c.ensureHomeLayout = function ensureHomeLayout() {
    const next = new Map();
    const own = (element, attribute) => {
      if (!element) return;
      if (!next.has(element)) next.set(element, new Set());
      next.get(element).add(attribute);
      if (!element.hasAttribute(attribute)) element.setAttribute(attribute, '');
    };
    // Only the blank home route has a centered welcome/editor composition.
    // Keep every native node and handler; conversations retain native layout.
    if (location.pathname !== '/') setCompatibility('home-layout', 'disabled');
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
        setCompatibility('home-layout', 'ready');
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
      if (!next.size) setCompatibility('home-layout', 'unsupported');
    }
    const activity = [...next.keys()].filter(element => next.get(element).has('data-app-mode-home-suggestions'))
      .flatMap(element => [...element.children]).find(element => element.matches('section') && element.classList.contains('group/home-suggestions'));
    if (homeLayoutController.activity !== activity || !homeLayoutController.disclosure?.isConnected) {
      homeLayoutController.disclosure?.remove();
      homeLayoutController.activity = activity;
      homeLayoutController.disclosure = null;
      if (activity) {
        const disclosure = document.createElement('button');
        disclosure.type = 'button';
        disclosure.textContent = 'Recent activity';
        disclosure.setAttribute('data-app-mode-home-disclosure', '');
        disclosure.addEventListener('click', () => {
          homeLayoutController.expanded = !homeLayoutController.expanded;
          ensureHomeLayout();
        });
        activity.before(disclosure);
        homeLayoutController.disclosure = disclosure;
      }
    }
    if (activity) {
      const expanded = String(homeLayoutController.expanded);
      if (homeLayoutController.disclosure.getAttribute('aria-expanded') !== expanded) homeLayoutController.disclosure.setAttribute('aria-expanded', expanded);
      if (!homeLayoutController.expanded) own(activity, 'data-app-mode-home-activity-collapsed');
    }
    for (const [element, attributes] of homeLayoutController.owned) {
      for (const attribute of attributes) if (!next.get(element)?.has(attribute)) element.removeAttribute(attribute);
    }
    homeLayoutController.owned = next;
  }


  }
})();
