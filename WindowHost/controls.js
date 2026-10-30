(() => {
  const bridge = window.appModeControls;
  const maximizeButton = document.querySelector('[data-action="maximize"]');
  let maximized = false;

  for (const button of document.querySelectorAll('button[data-action]')) {
    button.addEventListener('click', () => {
      const action = button.dataset.action === 'maximize' && maximized ? 'restore' : button.dataset.action;
      bridge.action(action);
    });
  }

  bridge.onState((state) => {
    if (!state || typeof state !== 'object') return;
    document.body.dataset.compact = String(Boolean(state.compact));
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
    })) {
      if (typeof theme[key] === 'string' && theme[key]) document.documentElement.style.setProperty(property, theme[key]);
    }
  });
})();
