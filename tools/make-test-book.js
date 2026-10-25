// Makes test/pages/book-1.jpg and book-2.jpg, two pages of a stand-in for a Solesmes book: three chants engraved by
// exsurge (MIT), each opening with a large initial and its first staff set in for it, one under another, the second
// running on from the foot of the first page to the head of the second; on uneven paper, blurred, speckled, as JPEGs.
// And book.json: for each page, each staff's four lines ([x0, y0, x1, y1], in its pixels) and whether a chant begins
// on it; and the chants' GABC. Needs playwright and exsurge from npm.
// usage: node tools/make-test-book.js <folder holding exsurge.js (npm pack exsurge)> <output folder>
const { chromium } = require('playwright');
const fs = require('fs');
const S = process.argv[2], OUT = process.argv[3] || S;
const chants = [
  'name: Gloria Patri;\n%%\n(c4) Gló(f)ri(gh)a(h) Pa(h)tri,(h.) (:) et(h) Fí(h)li(g)o,(f.) (;) et(f) Spi(gh)rí(h)tu(h)i(h) San(g)cto.(f.) (::) Sic(f)ut(g) e(h)rat(h) in(g) prin(f)ci(gh)pi(h)o,(h.) (:) et(h) nunc(h) et(g) sem(f)per,(f.) (;) et(f) in(g) sǽ(h)cu(h)la(g) sæ(f)cu(gh)ló(h)rum.(f.) A(g)men.(f.) (::)',
  'name: Kyrie;\n%%\n(c3) Ky(e)ri(fg)e(g) e(h)lé(g)i(fe)son.(f.) (::) Chri(f)ste(gh) e(h)lé(g)i(h)son.(g.) (::) Ky(h)ri(i)e(h) e(g)lé(f)i(e)son.(f.) (::) Ky(f)ri(g)e(h) *(,) e(i)lé(h)i(g)son.(f.) (::) Chri(f)ste(gh) e(h)lé(g)i(h)son.(g.) (::) Ky(h)ri(i)e(h) e(g)lé(f)i(e)son.(f.) (::)',
  'name: Salve Regina;\n%%\n(c4) Sal(h)ve,(g) Re(h)gí(ixhi)na,(h) (;) ma(g)ter(h) mi(f)se(g)ri(e)cór(f)di(g)ae:(g.) (:) vi(f)ta,(g) dul(h)cé(g)do,(f) et(e) spes(f) no(g)stra,(f.) sal(e)ve.(d.) (::) Ad(d) te(f) cla(g)má(h)mus,(g.) (;) éx(f)su(g)les,(h) fí(g)li(f)i(e) He(f)vae.(f.) (::)'
];
// (each chant's body twice over, to run to several lines)
for (let k = 0; k < chants.length; k++) { const i = chants[k].indexOf('%%') + 2; chants[k] = chants[k].slice(0, i) + chants[k].slice(i) + ' ' + chants[k].slice(i).replace(/^\s*\([cf]b?\d\)/, ''); }
const W = 1200, H = 1000, TOP = 90;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: 3600 } });
  await p.setContent('<body style="margin:0;background:#fff"><div id="out" style="position:absolute;left:90px;top:0"></div></body>');
  await p.addScriptTag({ path: `${S}/exsurge.js` });
  // engraved in one long column; its staves, each with the chant it belongs to
  const staves = await p.evaluate(async chants => {
    const out = document.getElementById('out'), found = [];
    for (const [k, g] of chants.entries()) {
      const ctxt = new exsurge.ChantContext();
      ctxt.glyphScaling = 0.13;
      if (ctxt.setGlyphScaling) ctxt.setGlyphScaling(0.13);
      const score = exsurge.Gabc.loadChantScore(ctxt, g.slice(g.indexOf('%%') + 2), true);
      await new Promise(r => score.performLayout(ctxt, () => score.layoutChantLines(ctxt, 1000, r)));
      const d = document.createElement('div'); d.style.marginBottom = '40px'; d.innerHTML = score.createDrawable(ctxt); out.appendChild(d);
      const ls = [...d.querySelectorAll('line')].map(l => { const r = l.getBoundingClientRect(); return [r.left, (r.top + r.bottom) / 2, r.right]; }).filter(v => v[2] - v[0] > 150);
      ls.sort((a, b) => a[1] - b[1]);
      const mine = [];
      for (const l of ls) { const s = mine[mine.length - 1]; if (s && s.length < 4 && l[1] - s[s.length - 1][1] < 40) s.push(l); else mine.push([l]); }
      mine.forEach((lines, i) => found.push({ chant: k, begins: i === 0, lines }));
    }
    return found;
  }, chants);
  const column = await p.screenshot({ fullPage: false, clip: { x: 0, y: 0, width: W, height: 3600 } });
  // two pages: the first from the column's top, the second from the gap between two staves of the second chant
  const second = staves.findIndex(v => v.chant === 1 && !v.begins && v.lines[3][1] + TOP > H * 0.55);
  // just above the next staff's clef (which stands above its top line)
  const g = (staves[second].lines[3][1] - staves[second].lines[0][1]) / 3, cut = staves[second].lines[0][1] - 1.6 * g;
  const pages = [{ from: -TOP, till: cut, staves: staves.slice(0, second) }, { from: cut - TOP, till: null, staves: staves.slice(second) }];
  const book = { chants, pages: [] };
  for (const [k, pg] of pages.entries()) {
    const jpg = await p.evaluate(async ({ png, from, till, top, W, H, seed }) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.fillStyle = '#efe6d2'; x.fillRect(0, 0, W, H);
      x.filter = 'blur(0.8px)'; x.globalCompositeOperation = 'multiply';
      x.drawImage(img, 0, -from);
      x.filter = 'none'; x.globalCompositeOperation = 'source-over';
      x.fillStyle = '#efe6d2';   // nothing below the cut: that goes on the next page
      if (till !== null) x.fillRect(0, till - from, W, H);
      if (top !== null) x.fillRect(0, 0, W, top);   // nor above it: that was the page before
      const d = x.getImageData(0, 0, W, H), a = d.data;
      let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < a.length; i += 4) {
        const px = (i / 4) % W, py = Math.floor(i / 4 / W);
        const light = 0.9 + 0.08 * Math.sin(px / 350) * Math.cos(py / 500), n = (rnd() - 0.5) * 36;
        for (let q = 0; q < 3; q++) a[i + q] = Math.max(0, Math.min(255, a[i + q] * light + n));
        if (rnd() < 0.001) a[i] = a[i + 1] = a[i + 2] = 50;
      }
      x.putImageData(d, 0, 0);
      return c.toDataURL('image/jpeg', 0.82).split(',')[1];
    }, { png: column.toString('base64'), from: pg.from, till: pg.till, top: k ? TOP : null, W, H, seed: 11 + k });
    fs.writeFileSync(`${OUT}/book-${k + 1}.jpg`, Buffer.from(jpg, 'base64'));
    // the staves wholly on the page (the column's foot is cut below the last)
    const on = pg.staves.filter(v => v.lines[3][1] - pg.from < H - 20);
    book.pages.push({ staves: on.map(v => ({ begins: v.begins, chant: v.chant, lines: v.lines.map(l => [l[0], l[1] - pg.from, l[2], l[1] - pg.from].map(n => Math.round(n * 10) / 10)) })) });
  }
  fs.writeFileSync(`${OUT}/book.json`, JSON.stringify(book));
  console.log(book.pages.map((pg, k) => `page ${k + 1}: ` + pg.staves.map(v => `${v.chant}${v.begins ? '*' : ''}@${Math.round(v.lines[0][1])}(${Math.round(v.lines[0][0])})`).join(' ')).join('\n'));
  await b.close();
})();
