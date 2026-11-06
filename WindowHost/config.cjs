const fs = require('node:fs');

// Diagnostics are fixed codes; never include config values or parser messages.
function readConfig(filename, diagnose = console.warn) {
  try {
    const value = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch { diagnose('CONFIG_READ_INVALID'); return {}; }
}

function safeBounds(args, config, screen, diagnose = console.warn) {
  const pair = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3).split(',');
  const size = pair('window-size');
  const pos = pair('window-position');
  const number = (value, fallback, min, max) => {
    if (value === undefined) return fallback;
    const parsed = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      diagnose('CONFIG_GEOMETRY_NORMALIZED');
      return Number.isFinite(parsed) ? Math.round(Math.max(min, Math.min(max, parsed))) : fallback;
    }
    return Math.round(parsed);
  };
  const candidate = {
    x: number(pos?.[0], 80, -100000, 100000), y: number(pos?.[1], 40, -100000, 100000),
    width: number(size?.[0] ?? config.window?.width, 1280, 390, 4096),
    height: number(size?.[1] ?? config.window?.height, 900, 300, 4096),
  };
  const area = screen.getDisplayMatching(candidate).workArea;
  candidate.width = Math.min(candidate.width, area.width);
  candidate.height = Math.min(candidate.height, area.height);
  candidate.x = Math.max(area.x, Math.min(candidate.x, area.x + area.width - candidate.width));
  candidate.y = Math.max(area.y, Math.min(candidate.y, area.y + area.height - candidate.height));
  return candidate;
}

module.exports = { readConfig, safeBounds };
