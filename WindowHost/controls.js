(() => {
  const bridge = window.appModeControls;
  const maximizeButton = document.querySelector('[data-action="maximize"]');
  let maximized = false;
  let navigationState = {};
  const pendingNavigation = new Set();
  window.addEventListener('focus', () => {
    if (document.body.dataset.presentation === 'recovery') document.querySelector('[data-action="reload"]')?.focus();
  });
  function syncNavigationButtons() {
    for (const action of ['toggle-sidebar', 'open-search']) {
      const button = document.querySelector(`[data-action="${action}"]`);
      button.disabled = navigationState.blocked === true || pendingNavigation.has(action);
    }
  }

  for (const button of document.querySelectorAll('button[data-action]')) {
    button.addEventListener('click', () => {
      const action = button.dataset.action === 'maximize' && maximized ? 'restore' : button.dataset.action;
      const navigation = ['toggle-sidebar', 'open-search'].includes(action);
      if (navigation && button.disabled) return;
      if (navigation) { pendingNavigation.add(action); syncNavigationButtons(); button.setAttribute('aria-busy', 'true'); }
      Promise.resolve(bridge.action(action)).catch(() => {}).finally(() => {
        if (navigation) { pendingNavigation.delete(action); syncNavigationButtons(); button.removeAttribute('aria-busy'); }
      });
    });
  }

  bridge.onState((state) => {
    if (!state || typeof state !== 'object') return;
    const presentation = ['loading', 'ready', 'recovery'].includes(state.presentation) ? state.presentation : 'ready';
    document.body.dataset.presentation = presentation;
    document.body.dataset.fullscreen = String(state.fullscreen === true);
    document.querySelector('.loading-surface').setAttribute('aria-busy', String(presentation === 'loading'));
    document.querySelector('#loading-message').textContent = presentation === 'recovery' ? 'ChatGPT could not load.' : 'Loading ChatGPT…';
    const reload = document.querySelector('[data-action="reload"]');
    const recovering = presentation === 'recovery' && reload.hidden;
    reload.hidden = presentation !== 'recovery';
    if (recovering && document.hasFocus()) reload.focus();
    const navigation = state.navigation || {};
    navigationState = navigation;
    const toggle = document.querySelector('[data-action="toggle-sidebar"]');
    toggle.hidden = !navigation.toggle;
    const search = document.querySelector('[data-action="open-search"]');
    // Search stays in the sidebar; only its toggle belongs in the title bar.
    search.hidden = true;
    // A modal makes activation impossible; blocked controls stay in place but
    // inert, so the bar's layout is stable and neither can steal modal focus.
    syncNavigationButtons();
    search.toggleAttribute('data-active', navigation.searchActive === true);
    const expanded = navigation.state === 'docked' || navigation.state === 'drawer';
    toggle.setAttribute('aria-expanded', String(expanded));
    const sidebarLabel = expanded ? 'Close sidebar' : 'Open sidebar';
    toggle.setAttribute('aria-label', sidebarLabel);
    toggle.title = sidebarLabel;
    document.querySelector('[data-action="pin"]')?.setAttribute('aria-pressed', String(Boolean(state.pinned)));
    maximized = Boolean(state.maximized);
    maximizeButton.dataset.restored = String(maximized);
    const label = maximized ? 'Restore' : 'Maximize';
    maximizeButton.setAttribute('aria-label', label);
    maximizeButton.title = label;
    const theme = state.theme || {};
    for (const [key, property] of Object.entries({
      color: '--app-mode-control-color',
      border: '--app-mode-control-border',
      background: '--app-mode-control-bg',
      hover: '--app-mode-control-hover',
      hoverBorder: '--app-mode-control-hover-border',
      pressed: '--app-mode-control-pressed',
      accent: '--app-mode-accent',
    })) {
      if (typeof theme[key] === 'string' && theme[key]) document.documentElement.style.setProperty(property, theme[key]);
    }
  });
})();
