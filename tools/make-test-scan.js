// Makes test/pages/engraved.jpg, a stand-in for a scan: chant engraved by exsurge (MIT), then turned 0.7 degrees,
// blurred, on uneven paper, with specks, as a JPEG; and engraved-lines.json, each staff's four lines as they truly lie
// in it, [x0, y0, x1, y1], in its pixels. And warped.jpg, the same page as if it couldn't be scanned flat: curling
// up towards the binding on the left and sagging a little across, with warped-lines.json, each line as points along
// it every 8 pixels, [x0, y0, x1, y1, …]. Needs playwright and exsurge from npm.
const { chromium } = require('playwright');
const fs = require('fs');
// usage: node tools/make-test-scan.js <folder holding exsurge.js (npm pack exsurge)> <output folder>
const S = process.argv[2], OUT = process.argv[3] || S;
const chants = [
  "(c4) KY(f)ri(gh)e(h) *(,) e(hjh)lé(gh)i(g)son.(f.) (::)",
  "(c3) A(e)ve(fg) Ma(g)rí(h)a,(g.) (;) grá(h)ti(i)a(h) ple(g)na,(f.) (:) Dó(f)mi(e)nus(g) te(h)cum.(g.) (::)",
  "(c4) Sal(h)ve,(g) Re(h)gí(ixhi)na,(h) (;) ma(g)ter(h) mi(f)se(g)ri(e)cór(f)di(g)ae:(g.) (:)",
  "(f3) Al(f)le(gh)lú(hj)ia.(h.) (::) Al(f)le(fg)lú(hih)ia,(g.) (;) al(f)le(fe)lú(gh)ia.(g.) (::)",
  "(c4) Gló(f)ri(gh)a(h) Pa(h)tri,(h.) (:) et(h) Fí(h)li(g)o,(f.) (;) et(f) Spi(gh)rí(h)tu(h)i(h) San(g)cto.(f.) (::)"
];
(async () => {
  const b = await require('playwright').chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 1600 } });
  await p.setContent('<body style="margin:0;background:#fff"><div id="out" style="position:absolute;left:90px;top:120px"></div></body>');
  await p.addScriptTag({ path: `${S}/exsurge.js` });
  const lines = await p.evaluate(async chants => {
    const out = document.getElementById('out');
    for (const g of chants) {
      const ctxt = new exsurge.ChantContext();
      ctxt.glyphScaling = 0.11;
      if (ctxt.setGlyphScaling) ctxt.setGlyphScaling(0.11);
      const score = exsurge.Gabc.loadChantScore(ctxt, g, true);
      await new Promise(r => score.performLayout(ctxt, () => score.layoutChantLines(ctxt, 1000, r)));
      const d = document.createElement('div'); d.style.marginBottom = '24px'; d.innerHTML = score.createDrawable(ctxt); out.appendChild(d);
    }
    // staff lines: exsurge draws each as a <line>; group by staff
    const ls = [...document.querySelectorAll('line')].map(l => { const r = l.getBoundingClientRect(); return [r.left, (r.top + r.bottom) / 2, r.right]; }).filter(v => v[2] - v[0] > 300);
    ls.sort((a, b) => a[1] - b[1]);
    const staves = [];
    for (const l of ls) { const s = staves[staves.length - 1]; if (s && s.length < 4 && l[1] - s[s.length - 1][1] < 40) s.push(l); else staves.push([l]); }
    return staves;
  }, chants);
  await p.screenshot({ path: `${OUT}/clean.png` });
  // degrade in the page: turn by 0.7 degrees about the centre, blur, paper, speckle
  const angle = 0.7 * Math.PI / 180;
  const png = fs.readFileSync(`${OUT}/clean.png`).toString('base64');
  const WARP = '40 * Math.max(0, (450 - x) / 450) ** 2 + 6 * Math.sin(Math.PI * x / 1200)';   // pixels down at column x
  const degrade = ({ png, angle, warp }) => p.evaluate(async ({ png, angle, warp }) => {
    let img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
    if (warp) {
      // each column of the page moved down by the warp, before the blur
      const off = new Function('x', 'return ' + warp), wc = document.createElement('canvas');
      wc.width = 1200; wc.height = 1600;
      const wx = wc.getContext('2d');
      wx.fillStyle = '#fff'; wx.fillRect(0, 0, 1200, 1600);
      for (let col = 0; col < 1200; col++) wx.drawImage(img, col, 0, 1, 1600, col, off(col + 0.5), 1, 1600);
      img = wc;
    }
    const c = document.createElement('canvas'); c.width = 1200; c.height = 1600;
    const x = c.getContext('2d');
    x.fillStyle = '#efe6d2'; x.fillRect(0, 0, 1200, 1600);
    x.translate(600, 800); x.rotate(angle); x.translate(-600, -800);
    x.filter = 'blur(0.9px)';
    x.globalCompositeOperation = 'multiply';
    x.drawImage(img, 0, 0);
    x.setTransform(1, 0, 0, 1, 0, 0); x.filter = 'none';
    const d = x.getImageData(0, 0, 1200, 1600), a = d.data;
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < a.length; i += 4) {
      const px = (i / 4) % 1200, py = Math.floor(i / 4 / 1200);
      const light = 0.88 + 0.12 * Math.sin(px / 400) * Math.cos(py / 600) - 0.1 * (px / 1200);   // uneven paper and a shadow at the gutter
      const n = (rnd() - 0.5) * 40;
      for (let k = 0; k < 3; k++) a[i + k] = Math.max(0, Math.min(255, a[i + k] * light + n));
      if (rnd() < 0.0015) { a[i] = a[i + 1] = a[i + 2] = 40; }   // specks
    }
    x.putImageData(d, 0, 0);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  }, { png, angle, warp });
  const jpg = await degrade({ png, angle });
  fs.writeFileSync(`${OUT}/engraved.jpg`, Buffer.from(jpg, 'base64'));
  const rot = ([px, py]) => { const dx = px - 600, dy = py - 800; return [600 + dx * Math.cos(angle) - dy * Math.sin(angle), 800 + dx * Math.sin(angle) + dy * Math.cos(angle)]; };
  const truth = lines.map(st => st.map(l => [...rot([l[0], l[1]]), ...rot([l[2], l[1]])].map(v => Math.round(v * 10) / 10)));
  fs.writeFileSync(`${OUT}/engraved-lines.json`, JSON.stringify(truth));
  console.log(truth.length, 'staves', JSON.stringify(truth[0]));
  // the warped page: not turned, so the warp alone bends the lines
  fs.writeFileSync(`${OUT}/warped.jpg`, Buffer.from(await degrade({ png, angle: 0, warp: WARP }), 'base64'));
  const off = new Function('x', 'return ' + WARP);
  const bent = lines.map(st => st.map(l => {
    const pts = [];
    for (let x = l[0]; x < l[2]; x += 8) pts.push(x, l[1] + off(x));
    pts.push(l[2], l[1] + off(l[2]));
    return pts.map(v => Math.round(v * 10) / 10);
  }));
  fs.writeFileSync(`${OUT}/warped-lines.json`, JSON.stringify(bent));
  fs.unlinkSync(`${OUT}/clean.png`);
  await b.close();
})();
