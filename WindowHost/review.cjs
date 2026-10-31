// Development-only, fixed-command diagnostics for manual sign-in review.
// No browser automation/debugging launch flags or renderer-facing bridge.
const fs = require('node:fs');
const path = require('node:path');
function install(win, reviewRoot, sourceRoot) {
  const input = path.join(reviewRoot, 'review-command.json');
  const outputRoot = path.join(sourceRoot, 'test-results/live-audits/native-header-review');
  fs.mkdirSync(outputRoot, { recursive: true });
  let lastId, busy = false;
  const timer = setInterval(async () => {
    if (busy || win.isDestroyed() || !fs.existsSync(input)) return;
    busy = true;
    try {
      const request = JSON.parse(fs.readFileSync(input, 'utf8'));
      if (typeof request.id !== 'number' || request.id === lastId) return;
      lastId = request.id;
      // The remote page runs in its own view below the app title bar.
      const chat = win.contentView.children.find(child => child.webContents?.getURL().startsWith('https://chatgpt.com'))?.webContents || win.webContents;
      const url = new URL(chat.getURL());
      let result = { status: 'select-blank-home' };
      // Blank home route or a plain /c/<id> conversation; never query/hash.
      const standardRoute = url.pathname === '/' || /^\/c\/[^/]+$/.test(url.pathname);
      if (url.origin === 'https://chatgpt.com' && standardRoute && !url.search && !url.hash) {
        const actionsPath = path.join(__dirname, 'review-actions.cjs');
        delete require.cache[require.resolve(actionsPath)];
        result = await require(actionsPath).run(win, request, sourceRoot, outputRoot);
        result.route = url.pathname === '/' ? 'home' : 'conversation';
      }
      fs.writeFileSync(path.join(outputRoot, 'measurements.json'), JSON.stringify({ requestId: lastId, ...result }, null, 2));
    } catch { /* Never write URLs, labels, errors containing page data, or DOM. */ }
    finally { busy = false; }
  }, 300);
  win.on('closed', () => clearInterval(timer));
}
module.exports = { install };
