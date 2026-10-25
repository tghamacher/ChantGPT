// Synthetic training pages from the GregoBase corpus: chants drawn in square notation by the app's own layout and
// Gregorio's font, on uneven paper, blurred and speckled, as JPEGs; each with its answers, a ChantGPT document
// (staves, syllables, neumes, each with its box) and the glyphs drawn (name, pitch, box).
// usage: node training/render.js [--pages 100] [--from 0] [--out training/data/synth] [--corpus training/data/gregobase.jsonl]
// Needs playwright (pre-installed here; elsewhere npm install playwright and npx playwright install chromium).
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PAGES = +arg('pages', 100), FROM = +arg('from', 0);
const OUT = path.resolve(arg('out', path.join(__dirname, 'data', 'synth')));
const CORPUS = path.resolve(arg('corpus', path.join(__dirname, 'data', 'gregobase.jsonl')));

// the chants to draw: with GABC, not marked copyrighted, not a duplicate; shuffled the same way every time
function corpus() {
  const rows = fs.readFileSync(CORPUS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(c => c.gabc && c.gabc.length && !c.copyrighted && !c.duplicateof);
  let s = 12345; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  return rows;
}

// the repository served to the page (fonts and scripts load over http, not file://)
function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf', '.css': 'text/css' };
  const srv = http.createServer((q, s) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

(async () => {
  const chants = corpus();
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve(), b = await chromium.launch(), p = await b.newPage();
  await p.goto(`http://127.0.0.1:${srv.address().port}/training/render.html`);
  const W = 1240, H = 1754;   // A4 at 150 dpi
  let at = 0, skipped = [], staves = 0, glyphs = 0;
  for (let n = FROM; n < FROM + PAGES; n++) {
    // enough chants for a page, taken in turn round the corpus; a page uses what fits
    const offer = [];
    for (let i = 0; i < 12; i++) { const c = chants[(at + i) % chants.length]; offer.push({ id: c.id, gabc: c.gabc[0], incipit: c.incipit, mode: c.mode, part: c.office_part }); }
    const res = await p.evaluate(spec => window.render(spec), { chants: offer, seed: 1000 + n, W, H });
    at += Math.max(1, res.used.length + res.skipped.length);
    skipped.push(...res.skipped);
    const name = `synth-${String(n).padStart(6, '0')}`;
    fs.writeFileSync(path.join(OUT, name + '.jpg'), Buffer.from(res.jpeg, 'base64'));
    fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify({ doc: res.doc, glyphs: res.glyphs, spacing: res.spacing }));
    staves += res.doc.pages[0].staves.length; glyphs += res.glyphs.length;
    if ((n - FROM + 1) % 25 === 0) console.error(`${n - FROM + 1} pages`);
  }
  fs.writeFileSync(path.join(OUT, 'skipped.json'), JSON.stringify(skipped, null, 0));
  console.log(`${PAGES} pages, ${staves} staves, ${glyphs} glyphs -> ${OUT}; ${skipped.length} chants skipped`);
  await b.close(); srv.close();
})();
