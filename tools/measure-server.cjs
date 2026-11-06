const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const revision = process.argv[2];
const requestedShell = process.env.APP_MODE_MEASURE_SHELL || 'powershell.exe';
const serverShell = requestedShell === 'powershell.exe' ? requestedShell : execFileSync(requestedShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '[Console]::Write([IO.Path]::Combine($PSHOME, "pwsh.exe"))'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  fs.mkdirSync(path.join(root, 'test-results/runs'), { recursive: true });
  const scratch = fs.mkdtempSync(path.join(root, 'test-results/runs/server-measure-'));
  const config = { installRoot: scratch, rememberWindowPlacement: false, privacy: { saveLastSession: false, trackRecentChats: false }, pinnedWindow: { fadeWhenInactive: false } };
  fs.writeFileSync(path.join(scratch, 'config.json'), JSON.stringify(config));
  let scriptRoot = root;
  if (revision) {
    scriptRoot = path.join(scratch, 'source');
    for (const file of ['Start-ChatGPT-TopMostServer.ps1', 'tools/ChatGPT-AppMode.Helpers.ps1', 'tools/AppMode.Windows.ps1', 'tools/AppMode.State.ps1']) {
      const target = path.join(scriptRoot, file); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, execFileSync('git', ['show', `${revision}:${file}`], { cwd: root }));
    }
  }
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const server = spawn(serverShell, ['-NoProfile', '-File', path.join(scriptRoot, 'Start-ChatGPT-TopMostServer.ps1'), '-AppRoot', scratch, '-Port', String(port)], { windowsHide: true, stdio: 'ignore' });
  const request = (topmost = false) => new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1'); let result = '';
    socket.on('error', reject); socket.on('data', bytes => result += bytes); socket.on('end', () => resolve(result));
    socket.on('connect', () => socket.write(topmost ? `POST /topmost HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: https://chatgpt.com\r\nContent-Type: text/plain\r\nContent-Length: 13\r\n\r\naction=status` : `OPTIONS /session HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: https://chatgpt.com\r\nAccess-Control-Request-Method: POST\r\n\r\n`));
  });
  const cpu = () => Number(spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${server.pid}).TotalProcessorTime.TotalMilliseconds`], { windowsHide: true, encoding: 'utf8' }).stdout.trim());
  try {
    for (let i = 0; i < 100; i++) { try { await request(); break; } catch { await delay(100); } }
    // Exclude first-use Add-Type/JIT and initial window discovery.
    await delay(2500);
    const before = cpu(), start = Date.now(); await delay(4000); const after = cpu();
    const idle = { elapsedMs: Date.now() - start, cpuMs: after - before };
    const slow = net.connect(port, '127.0.0.1'); slow.on('error', () => {}); slow.on('data', () => {});
    await new Promise(resolve => slow.on('connect', resolve)); slow.write('POST /session HTTP/1.1\r\n');
    await delay(150); const normalStart = Date.now(); await request(); const normalRequestBehindSlowMs = Date.now() - normalStart;
    slow.destroy();
    config.pinnedWindow.fadeWhenInactive = true;
    fs.writeFileSync(path.join(scratch, 'config.json'), JSON.stringify(config)); await delay(1200);
    const enabledBefore = cpu(), enabledStart = Date.now(); await delay(4000); const enabledAfter = cpu();
    const enabledNoWindows = { elapsedMs: Date.now() - enabledStart, cpuMs: enabledAfter - enabledBefore };
    const frequentStart = Date.now();
    for (let i = 0; i < 20; i++) await request(true);
    console.log(JSON.stringify({ revision: revision || 'working-tree', shell: path.basename(serverShell), idle, enabledNoWindows, normalRequestBehindSlowMs, topmost20RequestsMs: Date.now() - frequentStart }, null, 2));
  } finally { server.kill(); }
})();
