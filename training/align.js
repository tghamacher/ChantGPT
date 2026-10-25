// Real staves with answers, from a scanned book GregoBase has indexed: the app is driven over the book (in Chromium,
// through Playwright), page by page: its staves found, where chants begin marked, the chants GregoBase lists for the
// page placed on them, their lines broken where the page breaks them (as "Place this page's chants" does). The staves
// of chants whose every custos, as read on the page, agrees with the next line's first note (a sign the breaks are
// right) are kept: each straightened as training/staffdata.py does, with its GABC. Not checked by hand: what
// GregoBase has and what the page prints can differ, and the breaks can still be wrong where no custos says.
// usage: node training/align.js --pdf training/data/scans/gr1908.pdf --book training/data/gregobase-1.book.json
//          --at 25 --label 1 [--from 25] [--to 948] [--out training/data/real]
// (--at, --label: scan page 25, from 1, is the book's page "1", as the book numbers it.) Writes <out>/<page>-<staff>.png and
// <out>/labels.jsonl ({file, items, page, chant, staff}).
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PDF = path.resolve(arg('pdf')), BOOK = path.resolve(arg('book')), AT = +arg('at'), LABEL = arg('label');
const FROM = +arg('from', AT), TO = +arg('to', 1e9), OUT = path.resolve(arg('out', path.join(__dirname, 'data', 'real')));

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
  const srv = await serve(), b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  p.on('pageerror', e => console.error('page error:', e.message));
  await p.goto(`http://127.0.0.1:${srv.address().port}/`);
  await p.setInputFiles('#file', [PDF, BOOK]);
  await p.waitForFunction(() => window.CGApp.state.src && window.CGApp.state.book, null, { timeout: 300000 });
  const count = await p.evaluate(() => CGApp.state.src.count);
  await p.evaluate(n => CGApp.show(n - 1), AT);
  await p.fill('#bookPage', LABEL);
  await p.click('#setBookPage');
  const labels = fs.createWriteStream(path.join(OUT, 'labels.jsonl'), { flags: 'a' });
  let kept = 0, dropped = 0;
  for (let n = FROM; n <= Math.min(TO, count); n++) {
    await p.evaluate(n => CGApp.show(n - 1), n);
    const res = await p.evaluate(async () => {
      const E = CGEditor, S = CGStaves, N = CGNeumes, C = CGChant, doc = CGApp.state.doc, pg = CGApp.state.page;
      const bp = E.bookPage();
      if (!bp || !bp.chants.length) return { staves: [], note: 'no chants' };
      await E.placePage();
      const status = document.getElementById('status').textContent;
      // the chants placed from this page (they may run onto the next)
      const ids = new Set(bp.chants.map(c => String(c.id)));
      const placed = doc.chants.filter(c => ids.has(String(c.headers.gregobase)));
      const order = doc.pages.flatMap((p, k) => p.staves.map(staff => ({ staff, page: k })));
      const meta = { height: 64, space: 8, top: 20, left: 0.6, right: 0.4 };
      const out = [];
      for (const ch of placed) {
        const list = ch.staves.map(id => order.find(v => v.staff.id === id)).filter(Boolean);
        let agree = true;
        const seen = [];
        for (const v of list) {
          const px = await CGApp.state.src.pixels(v.page);
          const L = v.staff.lines.map(l => l.map(u => u * px.scale));
          const c = S.carries(px.gray, px.w, px.h, L);
          const items = v.staff.syllables.flatMap(y => y.items.map(it => it.g));
          const last = items[items.length - 1];
          if (last && C.kind(last) === 'custos' && c && c.custos !== null && c.custos !== last.charCodeAt(0) - 97) agree = false;
          const st = CGRecognizer.straighten(px.gray, px.w, px.h, L, meta);
          const cv = document.createElement('canvas'); cv.width = st.W; cv.height = meta.height;
          const x = cv.getContext('2d'), im = x.createImageData(st.W, meta.height);
          for (let i = 0; i < st.data.length; i++) { const g = Math.round((1 - st.data[i]) * 255); im.data[4 * i] = im.data[4 * i + 1] = im.data[4 * i + 2] = g; im.data[4 * i + 3] = 255; }
          x.putImageData(im, 0, 0);
          seen.push({ staff: v.staff.id, page: v.page + 1, items, png: cv.toDataURL('image/png').split(',')[1] });
        }
        if (agree) out.push(...seen.map(s => Object.assign(s, { chant: ch.headers.gregobase })));
        else out.push({ dropped: seen.length });
      }
      return { staves: out, note: status };
    });
    for (const s of res.staves) {
      if (s.dropped) { dropped += s.dropped; continue; }
      const file = `p${String(s.page).padStart(4, '0')}-${s.staff}.png`;
      fs.writeFileSync(path.join(OUT, file), Buffer.from(s.png, 'base64'));
      labels.write(JSON.stringify({ file, items: s.items, page: s.page, chant: s.chant, staff: s.staff }) + '\n');
      kept++;
    }
    console.error(`page ${n}: ${res.staves.filter(s => !s.dropped).length} staves kept; ${kept} kept, ${dropped} dropped so far. ${res.note || ''}`.slice(0, 300));
  }
  labels.end();
  console.log(`${kept} staves kept, ${dropped} dropped -> ${OUT}`);
  await b.close(); srv.close();
})();
