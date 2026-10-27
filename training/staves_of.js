// The staves on a folder of page images, as the app finds them: each page opened in the app (in Chromium, through
// Playwright), its staves found (column by column, in reading order), and each straightened as training/staffdata.py
// does. No answers: cantus.py labels pairs them with a manuscript's lines.
// usage: node training/staves_of.js --pages training/data/scans/123631 [--out training/data/ms-123631] [--only 011r,015r]
// Writes <out>/<page>-<k>.png (k from 1, in reading order) and <out>/staves.jsonl ({file, page, k, lines (in the
// image's pixels), spacing}); a page already done is skipped.
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PAGES = path.resolve(arg('pages')), OUT = path.resolve(arg('out', path.join(__dirname, 'data', 'ms-' + path.basename(PAGES))));
const ONLY = arg('only') ? new Set(arg('only').split(',')) : null;

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ttf': 'font/ttf', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };
  const srv = http.createServer((q, s) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const index = path.join(OUT, 'staves.jsonl');
  const done = new Set(fs.existsSync(index) ? fs.readFileSync(index, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).page) : []);
  const pages = fs.readdirSync(PAGES).filter(f => /\.(jpe?g|png)$/i.test(f)).sort()
    .filter(f => !done.has(f.replace(/\.\w+$/, '')) && (!ONLY || ONLY.has(f.replace(/\.\w+$/, ''))));
  const srv = await serve(), b = await chromium.launch();
  let p = null, n = 0, total = 0;
  const out = fs.createWriteStream(index, { flags: 'a' });
  for (const f of pages) {
    // (a fresh tab now and then: a page's pixels are large)
    if (!p || n % 20 === 0) {
      if (p) await p.close();
      p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
      p.on('pageerror', e => console.error('page error:', e.message));
      p.on('dialog', d => d.accept());                   // ("the staves you have marked aren't saved": they are, here)
      await p.goto(`http://127.0.0.1:${srv.address().port}/`);
    }
    const name = f.replace(/\.\w+$/, '');
    await p.setInputFiles('#file', path.join(PAGES, f));
    await p.waitForFunction(n => window.CGApp.state.src && window.CGApp.state.src.names && window.CGApp.state.src.names[0] === n, f, { timeout: 120000 });
    const res = await p.evaluate(async () => {
      const E = CGEditor, doc = CGApp.state.doc;
      await E.findHere();
      const px = await CGApp.state.src.pixels(0), meta = { height: 64, space: 8, top: 20, left: 0.6, right: 0.4 };
      const out = [];
      for (const st of doc.pages[0].staves) {
        const L = st.lines.map(l => l.map(u => u * px.scale));
        const s = CGRecognizer.straighten(px.gray, px.w, px.h, L, meta);
        const cv = document.createElement('canvas'); cv.width = s.W; cv.height = meta.height;
        const x = cv.getContext('2d'), im = x.createImageData(s.W, meta.height);
        for (let i = 0; i < s.data.length; i++) { const g = Math.round((1 - s.data[i]) * 255); im.data[4 * i] = im.data[4 * i + 1] = im.data[4 * i + 2] = g; im.data[4 * i + 3] = 255; }
        x.putImageData(im, 0, 0);
        out.push({ lines: st.lines, spacing: CGStaves.spacing(st.lines), png: cv.toDataURL('image/png').split(',')[1] });
      }
      E.reset();
      return out;
    });
    res.forEach((s, k) => {
      const file = `${name}-${k + 1}.png`;
      fs.writeFileSync(path.join(OUT, file), Buffer.from(s.png, 'base64'));
      out.write(JSON.stringify({ file, page: name, k: k + 1, lines: s.lines, spacing: Math.round(s.spacing * 100) / 100 }) + '\n');
    });
    if (!res.length) out.write(JSON.stringify({ file: null, page: name, k: 0 }) + '\n');
    n++; total += res.length;
    console.error(`${name}: ${res.length} staves (${n} of ${pages.length} pages, ${total} staves)`);
  }
  out.end();
  await b.close(); srv.close();
})();
