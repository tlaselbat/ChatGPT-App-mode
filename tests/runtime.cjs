const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const scratchRoot = path.join(root, 'test-results', 'runs', 'runtime-tests');
fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'run-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('PowerShell profile, installer, history and taskbar regressions', { timeout: 60000 }, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'Runtime.Tests.ps1'), '-Scratch', path.join(scratch, 'safety')], { encoding: 'utf8', windowsHide: true, timeout: 55000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  console.log(result.stdout.trim());
});

test('native opacity applies to whole synthetic windows and restores safely', { timeout: 15000 }, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'Opacity.Native.Tests.ps1')], { encoding: 'utf8', windowsHide: true, timeout: 12000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  console.log(result.stdout.trim());
});

test('tray menu actions and profile safety in an isolated configuration', { timeout: 15000 }, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'Tray.Tests.ps1'), '-Scratch', path.join(scratch, 'tray')], { encoding: 'utf8', windowsHide: true, timeout: 12000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  console.log(result.stdout.trim());
});

test('isolated server rejects untrusted traffic, bounds reads and preserves allowed origins', { timeout: 60000 }, async () => {
  const temporaryListener = net.createServer();
  await new Promise(resolve => temporaryListener.listen(0, '127.0.0.1', resolve));
  const port = temporaryListener.address().port;
  await new Promise(resolve => temporaryListener.close(resolve));
  const appRoot = path.join(scratch, 'server'); fs.mkdirSync(appRoot, { recursive: true });
  const config = { chromiumPortableRoot: path.join(appRoot, 'Browser', 'ChromiumPortable'), appProfileDir: path.join(appRoot, 'Browser', 'Profile'), privacy: { retentionDays: 7, showChatTitles: false, trackRecentChats: true, saveLastSession: true }, rememberWindowPlacement: false };
  fs.writeFileSync(path.join(appRoot, 'config.json'), JSON.stringify(config));
  let diagnostics = '';
  const startServer = () => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'Start-ChatGPT-TopMostServer.ps1'), '-AppRoot', appRoot, '-Port', String(port)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', data => diagnostics += data);
    return child;
  };
  let server = startServer();
  let mutexHolder;
  const stop = async child => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  };
  function raw(request, end = false) {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1'); let data = '';
      socket.setTimeout(6500, () => socket.destroy(Error('Response timeout')));
      // Windows may reset a rejected connection with unread oversized data.
      socket.on('error', error => { if (data || error.code === 'ECONNRESET') resolve(data || 'CONNECTION_CLOSED'); else reject(error); });
      socket.on('connect', () => { socket.write(request); if (end) socket.end(); });
      socket.on('data', bytes => data += bytes);
      socket.on('end', () => resolve(data));
    });
  }
  function request({ origin = 'https://chatgpt.com', host = `127.0.0.1:${port}`, method = 'POST', endpoint = '/session', body = 'url=https%3A%2F%2Fchatgpt.com%2Fc%2Fsynthetic-server-id&title=Synthetic', headers = '' } = {}) {
    return raw(`${method} ${endpoint} HTTP/1.1\r\nHost: ${host}\r\n${origin === null ? '' : `Origin: ${origin}\r\n`}Content-Type: text/plain;charset=UTF-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n${headers}\r\n${body}`);
  }
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw Error(diagnostics || 'Server exited');
      try { const response = await request(); assert.match(response, /200 Response/); ready = true; break; } catch { await delay(100); }
    }
    assert.ok(ready, diagnostics || 'Server did not start');
    // Keep the named object alive across termination, reproducing both an
    // abandoned owner and an existing object that is not newly created.
    const holderScript = path.join(appRoot, 'hold-mutex.ps1');
    const marker = path.join(appRoot, 'mutex-ready');
    fs.writeFileSync(holderScript, `param($Name, $Marker)\n$m = [Threading.Mutex]::OpenExisting($Name)\ntry { [IO.File]::WriteAllText($Marker, 'ready'); Start-Sleep -Seconds 40 } finally { $m.Dispose() }`);
    mutexHolder = spawn('powershell.exe', ['-NoProfile', '-File', holderScript, '-Name', `Local\\ChatGPTAppModeTopMostServer-${port}`, '-Marker', marker], { windowsHide: true, stdio: 'ignore' });
    for (let i = 0; i < 50 && !fs.existsSync(marker); ++i) await delay(100);
    assert.ok(fs.existsSync(marker), 'Mutex retention helper did not start');
    const duplicate = startServer();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { duplicate.kill(); reject(Error('Duplicate server did not exit')); }, 5000);
      duplicate.once('exit', code => { clearTimeout(timeout); assert.equal(code, 0); resolve(); });
    });
    assert.match(await request(), /200 Response/);
    await stop(server);
    server = startServer();
    ready = false;
    for (let i = 0; i < 100; ++i) {
      if (server.exitCode !== null) throw Error(diagnostics || 'Replacement server exited');
      try { assert.match(await request(), /200 Response/); ready = true; break; } catch { await delay(100); }
    }
    assert.ok(ready, 'Replacement server failed to acquire abandoned mutex');
    await stop(mutexHolder);
    for (const origin of ['https://chatgpt.com', 'https://chat.openai.com']) {
      const response = await request({ origin });
      assert.match(response, /200 Response/); assert.ok(response.includes(`Access-Control-Allow-Origin: ${origin}\r\n`));
      assert.ok(!response.includes('Allow-Private-Network'));
    }
    for (const origin of [null, 'null', 'https://evil.test', 'https://chatgpt.com.evil.test', 'http://chatgpt.com', 'https://chatgpt.com:444']) {
      const response = await request({ origin }); assert.match(response, /403 Response/); assert.ok(!response.includes('Access-Control-Allow-Origin'));
    }
    assert.match(await request({ host: `evil.test:${port}` }), /403 Response/);
    const preflight = await request({ method: 'OPTIONS', body: '', headers: 'Access-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: content-type\r\nAccess-Control-Request-Private-Network: true\r\n' });
    assert.match(preflight, /200 Response/); assert.match(preflight, /Access-Control-Allow-Private-Network: true/);
    assert.match(await request({ method: 'OPTIONS', body: '', headers: 'Access-Control-Request-Method: DELETE\r\n' }), /403 Response/);
    assert.match(await request({ method: 'OPTIONS', origin: 'https://evil.test', body: '', headers: 'Access-Control-Request-Method: POST\r\nAccess-Control-Request-Private-Network: true\r\n' }), /403 Response/);
    assert.match(await request({ body: 'url=https%3A%2F%2Fchatgpt.com%2Fc%2Fsynthetic%3Fsecret%3Dsynthetic' }), /"saved":false/);
    const items = JSON.parse(fs.readFileSync(path.join(appRoot, 'logs', 'recent-chats.json')));
    assert.ok(Array.isArray(items)); assert.equal(items.length, 1); assert.equal(items[0].title, null);
    assert.match(await request({ endpoint: '/topmost', body: 'action=toggle&handle=123&processId=999999' }), /409 Response/);
    assert.match(await request({ endpoint: '/topmost', body: 'action=bogus' }), /400 Response/);
    assert.match(await request({ endpoint: '/topmost', body: 'action=activity' }), /409 Response/);
    assert.match(await request({ endpoint: '/topmost', body: 'action=activity&handle=123&processId=999999' }), /409 Response/);
    assert.match(await request({ endpoint: '/topmost', body: 'action=activity&handle=123&processId=999999', origin: 'https://evil.test' }), /403 Response/);
    assert.match(await request({ headers: 'Content-Length: 0\r\n' }), /400 Response|CONNECTION_CLOSED/);
    assert.match(await request({ body: 'x'.repeat(17000) }), /400 Response|CONNECTION_CLOSED/);
    assert.match(await raw(`POST /session HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nX-Fill: ${'x'.repeat(9000)}`), /400 Response|CONNECTION_CLOSED/);
    const start = Date.now();
    assert.match(await raw('POST /session HTTP/1.1\r\n'), /400 Response/);
    assert.ok(Date.now() - start < 5000, 'Slow client blocked server beyond deadline');
    assert.match(await request(), /200 Response/);
    config.privacy.trackRecentChats = false; config.privacy.saveLastSession = false;
    fs.writeFileSync(path.join(appRoot, 'config.json'), JSON.stringify(config));
    assert.match(await request(), /"saved":true/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(appRoot, 'logs', 'recent-chats.json'))), []);
    assert.equal(fs.existsSync(path.join(appRoot, 'logs', 'last-session.json')), false);
    const log = fs.readFileSync(path.join(appRoot, 'logs', 'topmost-server.log'), 'utf8');
    assert.ok(!log.includes('synthetic-server-id') && !log.includes('Synthetic'));
  } finally {
    await stop(server);
    await stop(mutexHolder);
  }
});
