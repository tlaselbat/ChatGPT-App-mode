const fs = require('node:fs');
const path = require('node:path');
const { readConfig } = require('./config.cjs');

// Capture and restore in Electron screen DIPs, including its hidden-frame
// convention. Win32 WINDOWPLACEMENT includes different nonclient margins.
function installPlacement(win, root, requested) {
  const filename = path.join(root, 'logs/window-state.json');
  const temporary = `${filename}.${process.pid}-${win.id}.tmp`;
  let pending;
  let initialApplied;
  win.once('show', () => { initialApplied = win.getNormalBounds(); });
  function save() {
    if (win.isDestroyed() || !win.isVisible() || win.isMinimized() || win.isFullScreen()) return;
    if (readConfig(path.join(root, 'config.json')).rememberWindowPlacement === false) return;
    let bounds = win.getNormalBounds();
    // Fractional Windows DPI may round the native frame on first show. That
    // is not a user resize: do not feed its rounded result into the next launch.
    // Once normal geometry changes, capture the user's actual new rectangle.
    if (requested && initialApplied && Object.keys(requested).every(key => bounds[key] === initialApplied[key])) bounds = requested;
    if (!Object.values(bounds).every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return;
    const json = JSON.stringify({ ...bounds, maximized: win.isMaximized(), coordinateSpace: 'electron-dip' });
    try {
      if (fs.existsSync(filename) && fs.readFileSync(filename, 'utf8') === json) return;
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(temporary, json);
      fs.renameSync(temporary, filename);
    } catch {
      try { fs.unlinkSync(temporary); } catch {}
      console.warn('WINDOW_STATE_WRITE_FAILED');
    }
  }
  const schedule = () => {
    clearTimeout(pending);
    pending = setTimeout(() => { if (win.isFocused()) save(); }, 250);
  };
  for (const event of ['show', 'move', 'resize', 'maximize', 'unmaximize', 'restore', 'leave-full-screen']) win.on(event, schedule);
  // Retain the foreground sampling cadence for abrupt-exit recovery, and
  // flush on normal close so a fast final move is not lost.
  const interval = setInterval(() => { if (win.isFocused()) save(); }, 3000);
  win.on('close', save);
  win.once('closed', () => { clearInterval(interval); clearTimeout(pending); });
}

module.exports = { installPlacement };
