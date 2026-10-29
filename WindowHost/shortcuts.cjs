// Browser accelerators belong to the host after removing Electron's menu.
// Handle trusted native input here; no renderer bridge or global hotkeys.
function installBrowserShortcuts(contents) {
  const levels = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  function zoom(direction) {
    const current = contents.getZoomFactor();
    const next = direction === 'in'
      ? levels.find(value => value > current + 0.001) || 5
      : [...levels].reverse().find(value => value < current - 0.001) || 0.25;
    contents.setZoomFactor(next);
  }
  // Isolated zoom scales the rendered page without changing other windows.
  // Electron's manual mode changes the stored factor without applying it to
  // layout, so checking getZoomFactor alone is insufficient verification.
  contents.setZoomMode('isolated');
  contents.on('zoom-changed', (_event, direction) => zoom(direction));
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt || input.meta || input.isComposing) return;
    const key = input.key.toLowerCase();
    const f5 = key === 'f5' || input.code === 'F5';
    const reload = f5 || (input.control && key === 'r');
    if (reload) {
      event.preventDefault();
      if ((f5 && input.control) || input.shift) contents.reloadIgnoringCache();
      else contents.reload();
    } else if (key === 'f12' || input.code === 'F12' || (input.control && input.shift && key === 'i')) {
      event.preventDefault();
      if (!input.isAutoRepeat) contents.toggleDevTools();
    } else if (input.control && (['+', '=', '-', '0'].includes(key) || ['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract', 'Digit0', 'Numpad0'].includes(input.code))) {
      event.preventDefault();
      if (key === '0' || ['Digit0', 'Numpad0'].includes(input.code)) contents.setZoomFactor(1);
      else zoom(['+', '='].includes(key) || ['Equal', 'NumpadAdd'].includes(input.code) ? 'in' : 'out');
    }
  });
}

module.exports = { installBrowserShortcuts };
