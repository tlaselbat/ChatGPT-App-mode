const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

function measure(revision) {
  const counters = { bounds: 0, zoom: 0, publications: 0 };
  const screen = new EventEmitter();
  class Contents extends EventEmitter {
    constructor() { super(); this.ipc = { handle() {}, removeHandler() {} }; this.mainFrame = { executeJavaScript: async () => true }; }
    isDestroyed() { return false; }
    getURL() { return this.url || 'https://chatgpt.com/'; }
    setZoomMode() {}
    getZoomFactor() { return 1; }
    setZoomFactor() { counters.zoom++; }
    send() { counters.publications++; }
    setWindowOpenHandler() {}
    loadURL(url) { this.url = url; return Promise.resolve(); }
    executeJavaScriptInIsolatedWorld() { return new Promise(() => {}); }
  }
  class View {
    constructor() { this.webContents = new Contents(); }
    setBackgroundColor() {}
    setBounds() { counters.bounds++; }
    setVisible() {}
  }
  const win = new EventEmitter();
  let width = 1000, pinned = false;
  Object.assign(win, { isDestroyed: () => false, isFullScreen: () => false, isMaximized: () => false,
    isAlwaysOnTop: () => pinned, getContentBounds: () => ({ width, height: 700 }),
    contentView: { children: [], addChildView(view) { this.children.push(view); } } });
  const file = 'WindowHost/controls-host.cjs';
  const source = revision ? execFileSync('git', ['show', `${revision}:${file}`], { encoding: 'utf8' }) : fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(source, { module, __dirname: path.join(__dirname, '../WindowHost'), setImmediate, setTimeout, clearTimeout,
    require: name => name === 'electron' ? { BrowserWindow: {}, WebContentsView: View, screen,
      session: { fromPartition: () => ({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } }) } } : require(name) });
  const chat = new View(); win.contentView.addChildView(chat);
  const controls = module.exports.installWindowControls(win, chat, { isChatGptUrl: () => true });
  controls.view.webContents.emit('did-finish-load');
  const initial = { ...counters };
  for (let i = 0; i < 100; i++) win.emit('move');
  const unchanged = Object.fromEntries(Object.keys(counters).map(key => [key, counters[key] - initial[key]]));
  pinned = true; win.emit('always-on-top-changed');
  width = 1200; win.emit('resize');
  return { unchanged100Events: unchanged, changedTotals: Object.fromEntries(Object.keys(counters).map(key => [key, counters[key] - initial[key] - unchanged[key]])) };
}
module.exports = { measure };
if (require.main === module) console.log(JSON.stringify(measure(process.argv[2]), null, 2));
