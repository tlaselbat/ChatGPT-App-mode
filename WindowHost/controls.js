(() => {
  const bridge = window.appModeControls;
  const maximizeButton = document.querySelector('[data-action="maximize"]');
  let maximized = false;

  for (const button of document.querySelectorAll('button[data-action]')) {
    button.addEventListener('click', () => {
      const action = button.dataset.action === 'maximize' && maximized ? 'restore' : button.dataset.action;
      const navigation = ['toggle-sidebar', 'open-search'].includes(action);
      if (navigation && button.disabled) return;
      if (navigation) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
      Promise.resolve(bridge.action(action)).catch(() => {}).finally(() => {
        if (navigation) { button.disabled = false; button.removeAttribute('aria-busy'); }
      });
    });
  }

  bridge.onState((state) => {
    if (!state || typeof state !== 'object') return;
    document.body.dataset.compact = String(Boolean(state.compact));
    const navigation = state.navigation || {};
    const toggle = document.querySelector('[data-action="toggle-sidebar"]');
    toggle.hidden = !navigation.toggle;
    document.querySelector('[data-action="open-search"]').hidden = !navigation.search;
    document.querySelector('.brand').hidden = navigation.identity === true;
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
