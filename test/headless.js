// The browser tests (test/index.html) in headless Chromium, the repository served on localhost: NODE_PATH=<node_modules with playwright> node test/headless.js
// Serves the repository and runs test/index.html in headless Chromium; prints the report.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.pdf': 'application/pdf' };
const server = http.createServer((q, r) => {
  const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8765, async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  await pg.goto('http://localhost:8765/test/index.html');
  await pg.waitForFunction(() => /^(PASS|FAIL)/.test(document.title), null, { timeout: 600000 });
  console.log(await pg.title());
  const fails = await pg.$$eval('#report li', ls => ls.map(l => l.className + ' ' + l.textContent).filter(t => !t.startsWith('ok')));
  console.log(fails.slice(0, 20).join('\n'));
  await b.close(); server.close();
});
