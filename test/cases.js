// The test cases. Each is a unit test: unit() returns what is wrong, as a list of sentences (empty when it passes).
// Run them in a browser (test/index.html) or with Node (node test/node.js). A case marked browser: true needs the
// page and runs only in the browser.
(function (global) {
  'use strict';
  const C = () => global.CGChant;
  const GLORIA = "name: Gloria Patri;\n%%\n(c4) Gló(f)ri(gh)a(h) Pa(h)tri,(h.) (:) et(h) Fí(h)li(g)o,(f.) (;) et(f) Spi(gh)rí(h)tu(h)i(h) San(g)cto.(f.) (::)";
  const same = (what, got, want) => JSON.stringify(got) === JSON.stringify(want) ? [] : [`${what}: ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`];
  const body = gabc => gabc.slice(gabc.indexOf('%%') + 2).trim();
  // a document holding one GABC chant, its staves on page 1
  function docOf(src) {
    const r = C().fromGabc(src), doc = C().newDocument({ name: 'test', type: 'images', sizes: [[1000, 1400]] });
    doc.pages[0].staves = r.staves.map((s, i) => Object.assign({ id: 'p1s' + (i + 1) }, s));
    doc.chants = [{ headers: r.headers, staves: doc.pages[0].staves.map(s => s.id) }];
    return doc;
  }

  global.CASES = [
    // ---- the kind of a GABC group
    { name: 'kind: clefs, bars, custos, breaks, accidentals, neumes', unit: () => {
      const want = { c4: 'clef', cb3: 'clef', f3: 'clef', ',': 'bar', ';': 'bar', ';3': 'bar', ':': 'bar', '::': 'bar', '`': 'bar',
        'g+': 'custos', z: 'break', 'z-': 'break', Z: 'break', ix: 'accidental', iy: 'accidental', f: 'neume', fgh: 'neume', 'f/gh': 'neume', ivHG: 'neume', 'c': 'neume' };
      return Object.entries(want).flatMap(([g, k]) => same(`kind of "${g}"`, C().kind(g), k));
    } },

    // ---- pitch from the clef
    { name: 'pitch: C and F clefs on each line', unit: () => [].concat(
      same('j under c4', C().pitch('j', 'c4'), { step: 'C', octave: 4 }),
      same('h under c4', C().pitch('h', 'c4'), { step: 'A', octave: 3 }),
      same('h under c3', C().pitch('h', 'c3'), { step: 'C', octave: 4 }),
      same('d under c1', C().pitch('d', 'c1'), { step: 'C', octave: 4 }),
      same('h under f3', C().pitch('h', 'f3'), { step: 'F', octave: 3 }),
      same('k under f3', C().pitch('k', 'f3'), { step: 'B', octave: 3 }),
      same('h under cb3 (flat clef)', C().pitch('h', 'cb3'), { step: 'C', octave: 4 }),
      same('no clef', C().pitch('h', null), null)) },

    // ---- notes of neume material
    { name: 'notes: shapes, signs and accidentals', unit: () => [].concat(
      same('torculus', C().notes('fgh').map(n => n.p).join(''), 'fgh'),
      same('virga and inclinata', C().notes('ivHG').map(n => n.shape), ['virga', 'inclinatum', 'inclinatum']),
      same('quilisma, episema, liquescent', C().notes('gwh_i~').map(n => [n.shape, n.signs, !!n.liquescent]), [['quilisma', 'w', false], ['punctum', '_', false], ['punctum', '~', true]]),
      same('flat before a note', C().notes('ixhi').map(n => n.acc || n.p), ['x', 'h', 'i']),
      same('attributes skipped', C().notes('f[ob:1;6mm]g').map(n => n.p).join(''), 'fg'),
      same('mora stops at a bar', C().notes('f.;').map(n => n.signs), ['.'])) },

    // ---- GABC in
    { name: 'gabc in: headers, syllables, words, bars', unit: () => {
      const r = C().fromGabc(GLORIA), syl = r.staves[0].syllables;
      return [].concat(
        same('headers', r.headers, { name: 'Gloria Patri' }),
        same('staves', r.staves.length, 1),
        same('first syllable is the clef', syl[0], { text: '', items: [{ g: 'c4' }] }),
        same('words', syl.filter(s => s.text).map(s => (s.join ? '-' : ' ') + s.text).join('').trim(), 'Gló-ri-a Pa-tri, et Fí-li-o, et Spi-rí-tu-i San-cto.'),
        same('bars', syl.flatMap(s => s.items).filter(i => C().kind(i.g) === 'bar').map(i => i.g), [':', ';', '::']));
    } },
    { name: 'gabc in: line breaks make staves; a bar after notes is split off', unit: () => {
      const r = C().fromGabc('(c3) A(f.;)men(fg gf) (z) (c4) Ky(g)ri(h)e(h) (::)');
      return [].concat(
        same('staves', r.staves.length, 2),
        same('first staff', r.staves[0].syllables.map(s => s.items.map(i => i.g)), [['c3'], ['f.', ';'], ['fg gf']]),
        same('second staff starts with its clef', r.staves[1].syllables[0].items[0].g, 'c4'));
    } },
    { name: 'gabc in: comments, Windows line ends, no header', unit: () => {
      const r = C().fromGabc('name: X; % a comment\r\n%%\r\n(c4) A(f)% another\r\nmen(g) (::)');
      return [].concat(same('headers', r.headers, { name: 'X' }), same('syllables', r.staves[0].syllables.map(s => s.text), ['', 'A', 'men', '']),
        same('no header', C().fromGabc('(c4) A(f)').headers, {}));
    } },
    { name: 'gabc in: no chant is an error', unit: () => {
      try { C().fromGabc('just words'); return ['Did not throw']; } catch (e) { return /No chant found/.test(e.message) ? [] : ['Threw: ' + e.message]; }
    } },

    // ---- GABC out
    { name: 'gabc out: the chant comes back as it went in', unit: () => same('body', body(C().toGabc(docOf(GLORIA))), body(GLORIA)) },
    { name: 'gabc out: line breaks kept on request; custos left out', unit: () => {
      const doc = docOf('(c3) A(f)men(g) (z) (c4) Ky(g+)ri(h)e(h) (::)');
      return [].concat(
        same('with lines', body(C().toGabc(doc, { lines: true })), '(c3) A(f)men(g) (z) (c4) Ky()ri(h)e(h) (::)'),
        same('without', body(C().toGabc(doc)), '(c3) A(f)men(g) (c4) Ky()ri(h)e(h) (::)'));
    } },
    { name: 'gabc out: a word running over a line stays one word', unit: () => {
      const doc = docOf('(c4) Glo(f)ri(g) (z) a(h) Pa(h)tri(h) (::)');
      doc.pages[0].staves[1].syllables[0].join = true;
      return same('body', body(C().toGabc(doc)), '(c4) Glo(f)ri(g)a(h) Pa(h)tri(h) (::)');
    } },

    // ---- documents
    { name: 'document: a new one is empty and passes its checks', unit: () => {
      const doc = C().newDocument({ name: 'Graduale.pdf', type: 'pdf', sizes: [[612, 792], [612, 792]] });
      return [].concat(same('pages', doc.pages.map(p => [p.n, p.size]), [[1, [612, 792]], [2, [612, 792]]]), same('checks', C().check(doc), []));
    } },
    { name: 'document: clefs in force through a staff', unit: () => {
      const st = C().fromGabc('(c4) A(f) (;) B(c3) C(g) (::)').staves[0];
      return same('clefs', C().withClefs(st, 'f3').map(i => i.g + '@' + i.clef), ['c4@c4', 'f@c4', ';@c4', 'c3@c3', 'g@c3', '::@c3']);
    } },
    { name: 'document: the checks find what is wrong', unit: () => {
      const doc = docOf(GLORIA), st = doc.pages[0].staves[0];
      st.box = [10, 10, 2000, 100];
      st.lines = [[0, 0, 1, 1]];
      st.syllables[1].items[0].conf = 1.5;
      st.syllables[2].items.push({ g: '(f)' });
      doc.pages[0].staves.push({ id: 'p1s1', syllables: [] });
      doc.chants.push({ headers: { name: 'Lost' }, staves: ['p9s1'] });
      const bad = C().check(doc), want = [/box is not on the page/, /four lines/, /confidence/, /parentheses/, /used twice/, /isn't there: p9s1/];
      return want.filter(re => !bad.some(b => re.test(b))).map(re => `No complaint matching ${re}; got: ${bad.join(' | ')}`)
        .concat(bad.length === want.length ? [] : [`${bad.length} complaints, expected ${want.length}: ${bad.join(' | ')}`]);
    } },
    { name: 'document: not a document', unit: () => same('checks', C().check({ pages: [] }), ['Not a ChantGPT document.']) },

    // ---- the app, in the browser: each loads index.html with test scans in the frame (run.js gives app())
    { name: 'app: opens a PDF and turns its pages', browser: true, unit: async app => {
      const { w, shown } = await app('test/pages/two-pages.pdf');
      const bad = [].concat(
        same('pages', w.CGApp.state.src.count, 2),
        same('page size in points (A5, 420 × 595)', w.CGApp.state.doc.pages[0].size.map(v => Math.abs(v - 420) < 2 ? 420 : Math.abs(v - 595) < 2 ? 595 : v), [420, 595]),
        same('the document is a new one', w.CGChant.check(w.CGApp.state.doc), []));
      if (!inked(w.document.getElementById('canvas'))) bad.push('The first page is blank.');
      w.document.getElementById('next').click();
      await shown(1);
      return bad.concat(same('page number', w.document.getElementById('pageNo').value, '2'), same('next is off on the last page', w.document.getElementById('next').disabled, true));
    } },
    { name: 'app: opens images as pages, in page order', browser: true, unit: async app => {
      const { w } = await app('test/pages/page10.png', 'test/pages/page2.png');
      const s = w.CGApp.state.src;
      return [].concat(same('pages', s.count, 2), same('order', s.names, ['page2.png', 'page10.png']), same('size in pixels', s.sizes[0], [420, 595]))
        .concat(inked(w.document.getElementById('canvas')) ? [] : ['The first page is blank.']);
    } },
    { name: 'app: the overlay is drawn in page units, at any zoom', browser: true, unit: async app => {
      const { w, shown } = await app('test/pages/page2.png');
      const st = { id: 'p1s1', box: [30, 50, 360, 50], lines: [[30, 60, 390, 60], [30, 72, 390, 72], [30, 84, 390, 84], [30, 96, 390, 96]],
        syllables: [{ text: '', items: [{ g: 'c4', box: [32, 55, 12, 40], conf: 0.99 }] }, { text: 'A', items: [{ g: 'f', box: [70, 80, 10, 10], conf: 0.4 }] }] };
      w.CGApp.state.doc.pages[0].staves.push(st);
      w.document.getElementById('zoomIn').click();
      await shown(0);
      const svg = w.document.getElementById('overlay'), page = w.document.getElementById('page');
      return [].concat(
        same('viewBox', svg.getAttribute('viewBox'), '0 0 420 595'),
        same('lines', svg.querySelectorAll('line').length, 4),
        same('boxes', svg.querySelectorAll('rect.item').length, 2),
        same('doubtful', svg.querySelectorAll('rect.doubt').length, 1),
        same('overlay covers the page', [svg.getBoundingClientRect().width, svg.getBoundingClientRect().height].map(Math.round), [page.clientWidth, page.clientHeight]));
    } },
    { name: 'app: a file it cannot read is explained', browser: true, unit: async app => {
      const { w } = await app();
      await w.CGApp.open([new w.File(['x'], 'scan.tif', { type: 'image/tiff' })]);
      return /TIFF/.test(w.document.getElementById('status').textContent) ? [] : ['No word about TIFF: ' + w.document.getElementById('status').textContent];
    } }
  ];

  // has anything dark been drawn in the middle of the canvas?
  function inked(canvas) {
    const ctx = canvas.getContext('2d'), d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < d.length; i += 4 * 7) if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80) return true;
    return false;
  }
})(typeof window !== 'undefined' ? window : globalThis);
