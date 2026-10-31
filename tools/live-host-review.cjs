// Manual isolated review. Never launch authentication through browser automation.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const reviewRoot = path.join(root, 'test-results/live-review-profile/native-host');
async function start() {
  fs.mkdirSync(reviewRoot, { recursive: true });
  fs.writeFileSync(path.join(reviewRoot, 'config.json'), JSON.stringify({
    installRoot: reviewRoot, url: 'https://chatgpt.com/',
    appProfileDir: path.join(reviewRoot, 'UnusedChromiumProfile'),
    window: { width: 680, height: 850 }, rememberWindowPlacement: false,
    privacy: { saveLastSession: false, trackRecentChats: false, showChatTitles: false },
  }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[path.join(root,'WindowHost/main.cjs'),`--app-mode-root=${reviewRoot}`,
    `--user-data-dir=${path.join(reviewRoot,'Browser/AppModeHostProfile')}`,'--live-review',
    '--remote-debugging-address=127.0.0.1','--remote-debugging-port=9223'],
    {env,detached:true,stdio:'ignore',windowsHide:false});
  child.on('error',()=>console.error('Manual review window could not launch.'));
  child.unref();
  console.log('Manual native review launched. Sign in there and use the blank home page. Production control calls are blocked.');
}
start().catch(() => { console.error('Isolated review could not start; no page data logged.'); process.exitCode = 1; });
