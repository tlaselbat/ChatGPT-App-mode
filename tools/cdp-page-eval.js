// Raw CDP client over the page target websocket (Node >=22 built-in WebSocket).
// Usage: node tools/cdp-page-eval.js <expression-file|expression>
const http = require('node:http');
const fs = require('node:fs');

const expr = process.argv[2]
  ? (fs.existsSync(process.argv[2]) ? fs.readFileSync(process.argv[2], 'utf8') : process.argv[2])
  : 'location.pathname';

http.get('http://127.0.0.1:9223/json', res => {
  let data = '';
  res.on('data', c => { data += c; });
  res.on('end', () => {
    const page = JSON.parse(data).find(t => t.type === 'page' && t.url.startsWith('https://chatgpt.com'));
    if (!page) { console.error('no chatgpt page'); process.exit(1); }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const send = (method, params) => new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('cdp timeout')); } }, 15000);
    });
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
    };
    ws.onopen = async () => {
      try {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 1));
      } catch (error) { console.error('eval failed:', error.message); }
      ws.close();
      process.exit(0);
    };
    ws.onerror = () => { console.error('ws error'); process.exit(1); };
    setTimeout(() => { console.error('open timeout'); process.exit(1); }, 15000);
  });
});
