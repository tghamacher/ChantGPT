// The test cases. Each is a unit test: unit() returns what is wrong, as a list of sentences (empty when it passes).
// Run them in a browser (test/index.html) or with Node (node test/node.js). A case marked browser: true needs the
// page and runs only in the browser.
(function (global) {
  'use strict';
  const C = () => global.CGChant, S = () => global.CGStaves;
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

    // ---- moving GABC up and down, as a drag does
    { name: 'gabc: moved up and down by steps, all of it or one note', unit: () => [].concat(
      same('a torculus up a step', C().transpose('fgf', 1), 'ghg'),
      same('a climacus down, inclinata kept', C().transpose('ivHG', -1), 'hvGF'),
      same('its flat goes with it', C().transpose('ixhi', 1), 'jxij'),
      same('one note only (the second)', C().transpose('ixhi', 2, 1), 'ixhk'),
      same('attributes untouched', C().transpose('f[ob:1;6mm]g', 1), 'g[ob:1;6mm]h'),
      same('a custos', C().transpose('g+', 2), 'i+'),
      same('a clef by whole lines', [C().transpose('c4', -2), C().transpose('c4', -1), C().transpose('c3', 3)], ['c3', 'c4', 'c4']),
      same('off the staff', [C().transpose('m', 1), C().transpose('a', -1), C().transpose('c4', 2), C().transpose('c1', -2)], [null, null, null, null]),
      same('a bar stays', C().transpose(';', 3), ';')) },

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
      st.syllables[3].items[0].checked = 'maybe';
      doc.pages[0].staves.push({ id: 'p1s1', syllables: [] });
      doc.chants.push({ headers: { name: 'Lost' }, staves: ['p9s1'] });
      const bad = C().check(doc), want = [/box is not on the page/, /four lines/, /confidence/, /parentheses/, /checked as "maybe"/, /used twice/, /isn't there: p9s1/];
      return want.filter(re => !bad.some(b => re.test(b))).map(re => `No complaint matching ${re}; got: ${bad.join(' | ')}`)
        .concat(bad.length === want.length ? [] : [`${bad.length} complaints, expected ${want.length}: ${bad.join(' | ')}`]);
    } },
    { name: 'document: not a document', unit: () => same('checks', C().check({ pages: [] }), ['Not a ChantGPT document.']) },

    // ---- staves: geometry, and finding lines in the ink
    { name: 'staves: even lines, spacing, tilt, box', unit: () => {
      const l = S().even([100, 200, 800, 48]);
      return [].concat(
        same('even', l.map(v => v[1]), [200, 216, 232, 248]),
        same('spacing', S().spacing(l), 16),
        same('tilt', S().tilt([[0, 0, 100, 1], [0, 10, 100, 11], [0, 20, 100, 21], [0, 30, 100, 31]]).toFixed(3), '0.573'),
        same('height along a bent line, and beyond its ends', [0, 50, 100, 150, 200, 250].map(x => S().yAt([0, 10, 100, 20, 200, 10], x)), [10, 15, 20, 15, 10, 5]),
        same('spacing of a bent staff', S().spacing([[0, 0, 50, 5, 100, 0], [0, 10, 50, 15, 100, 10], [0, 20, 50, 25, 100, 20], [0, 30, 50, 35, 100, 30]]), 10),
        same('how far it bends, in spaces', S().bend([[0, 0, 50, 5, 100, 0], [0, 10, 50, 15, 100, 10], [0, 20, 50, 25, 100, 20], [0, 30, 50, 35, 100, 30]]), 0.5),
        same('box: a space and a half above and below, kept on the page', S().box(l, [1000, 1000]), [100, 176, 800, 96]),
        same('box at the top of the page', S().box(S().even([0, 10, 50, 30]), [1000, 1000]), [0, 0, 50, 55]),
        same('a bend added, then taken away', S().removeBend(S().addBend(l, 300), 1), l),
        same('a bend added where it is', S().addBend(l, 300).map(v => v.length), [6, 6, 6, 6]),
        same('no bend beyond the ends', S().addBend(l, 950), l),
        same('simplified: a straight run loses its middle point', S().simplify([[0, 0, 50, 0.1, 100, 0], [0, 10, 50, 10.1, 100, 10], [0, 20, 50, 20.1, 100, 20], [0, 30, 50, 30.1, 100, 30]], 0.5).map(v => v.length), [4, 4, 4, 4]),
        same('box of a bent staff', S().box([[0, 0, 50, 5, 100, 0], [0, 10, 50, 15, 100, 10], [0, 20, 50, 25, 100, 20], [0, 30, 50, 35, 100, 30]]), [0, -15, 100, 65]),
        same('space evenly', S().spaceEvenly([[0, 0, 90, 3], [0, 14, 90, 5], [0, 17, 90, 26], [0, 30, 90, 33]]).map(v => [v[1], v[3]]), [[0, 3], [10, 13], [20, 23], [30, 33]]));
    } },
    { name: 'staves: lines found in the ink, level and tilted, among notes and words', unit: () => {
      const bad = [];
      for (const [slope, words] of [[0, false], [0.02, true], [-0.035, true]]) {
        const { g, w, h } = page(slope, words), r = S().fit(g, w, h, [60, 150, 900, 180]);
        if (!r) { bad.push(`slope ${slope}: nothing found`); continue; }
        const want = [0, 1, 2, 3].map(i => [100, 200.5 + 16 * i + slope * -400, 900, 200.5 + 16 * i + slope * 400]);
        const off = Math.max(...r.lines.flatMap((l, i) => l.map((v, j) => Math.abs(v - want[i][j]))));
        if (off > 1.5) bad.push(`slope ${slope}: ${JSON.stringify(S().roundLines(r.lines))} is ${off.toFixed(1)} px off`);
      }
      return bad;
    } },
    { name: 'staves: a bent staff followed end to end, a straight one kept straight', unit: () => {
      const bad = [];
      // [bow, slope, a line of words]: at a bow of three spaces the staff would run into the words, so none there
      for (const [bow, slope, words] of [[0, 0, true], [0, -0.045, true], [10, 0, true], [24, 0, true], [-20, 0.01, true], [36, 0, true], [50, 0, false]]) {
        const { g, w, h } = page(slope, words, bow), r = S().fitStaff(g, w, h, [60, 60, 900, 400]);
        if (!r) { bad.push(`bow ${bow}: nothing found`); continue; }
        const l = r.lines, xs = S().xsOf(l[0]), truth = (i, x) => 200.5 + 16 * i + bow * Math.sin(Math.PI * (x - 100) / 800) + slope * (x - 500);
        let off = 0;
        for (let x = xs[0]; x <= xs[xs.length - 1]; x += 5) for (let i = 0; i < 4; i++) off = Math.max(off, Math.abs(S().yAt(l[i], x) - truth(i, x)));
        if (off > 2) bad.push(`bow ${bow}, slope ${slope}: up to ${off.toFixed(1)} px off`);
        if (Math.abs(xs[0] - 100) > 4 || Math.abs(xs[xs.length - 1] - 900) > 4) bad.push(`bow ${bow}: runs ${xs[0]}–${xs[xs.length - 1]}`);
        if ((S().count(l[0]) > 2) !== (bow !== 0)) bad.push(`bow ${bow}: ${S().count(l[0])} points`);
      }
      return bad;
    } },
    { name: 'staves: nothing is found where there is no staff', unit: () => {
      const w = 600, h = 300, g = new Uint8Array(w * h).fill(240);
      for (let x = 50; x < 550; x++) for (let y = 100; y < 102; y++) g[y * w + x] = 10;   // one line alone
      return [].concat(same('blank', S().fit(new Uint8Array(w * h).fill(240), w, h, [0, 0, w, h]), null), same('one line', S().fit(g, w, h, [0, 50, w, 100]), null));
    } },

    // ---- square notation: glyphs as Gregorio gathers and names them, placed along a staff
    { name: 'neumes: notes gathered into glyphs and named as in Gregorio', unit: () => {
      const N = global.CGNeumes, want = {
        f: 'Punctum', fg: 'PesOneNothing', gf: 'FlexusOneNothing', hf: 'FlexusLongqueueTwoNothing', fgf: 'TorculusOneOneNothing',
        gfg: 'PorrectusOneOneNothing', fgh: 'ScandicusOneOneNothing', fgfg: 'TorculusResupinusOneOneOneNothing', hjg: 'TorculusTwoThreeNothing',
        'f/gh': 'Punctum PesOneNothing', 'hgf': 'FlexusLongqueueOneNothing Punctum', ivHG: 'Virga DescendensPunctumInclinatum DescendensPunctumInclinatum',
        gwh: 'QuilismaPesOneNothing', 'gwhi': 'QuilismaPesOneNothing Punctum', 'h~': 'PunctumDeminutus', 'fg~': 'PesOneDeminutus', '-fg': 'PesOneInitioDebilis',
        hv: 'VirgaLongqueue', gv: 'Virga', hV: 'VirgaReversaLongqueue', gss: 'Stropha Stropha', 'fgf.': 'TorculusOneOneNothing AuctumMora', ixhi: 'Flat PesOneNothing',
        'f!gh': 'Punctum PesOneNothing', ff: 'Punctum Punctum'
      };
      return Object.entries(want).flatMap(([g, w]) => same(g, N.shapes(g).list.map(v => v.name).join(' '), w))
        .concat(Object.keys(want).flatMap(g => N.shapes(g).list.filter(v => !global.CGGreciliae.glyphs[v.name]).map(v => `${g}: ${v.name} is not in the font`)));
    } },
    { name: 'neumes: clefs, bars, custos set at their pitches', unit: () => {
      const N = global.CGNeumes, at = g => N.itemShapes(g, true).list.map(v => v.name + '@' + v.p).join(' ');
      return [].concat(same('c4', at('c4'), 'CClef@8'), same('c3', at('c3'), 'CClef@6'), same('f3', at('f3'), 'FClef@6'), same('cb3', at('cb3'), 'CClef@6 Flat@6'),
        same('a clef later on', N.itemShapes('c3', false).list[0].name, 'CClefChange'),
        same('bars', [',', ';', ':', '::', '`'].map(at), ['DivisioMinimaFour@6', 'DivisioMinorFour@6', 'DivisioMaiorFour@6', 'DivisioMaiorFour@6 DivisioMaiorFour@6', 'VirgulaFour@6']),
        same('custos', [at('d+'), at('j+')], ['CustosUpShort@3', 'CustosDownShort@9']));
    } },
    { name: 'neumes: a staff\'s chant laid along it, each note at its pitch', unit: () => {
      const N = global.CGNeumes, st = { lines: S().even([100, 200, 800, 48]), syllables: C().fromGabc(GLORIA).staves[0].syllables };
      const placed = N.place(st), L = N.layout(st), bad = [];
      if (placed.length !== 20) bad.push(`${placed.length} items placed, expected 20`);
      const xs = st.syllables.flatMap(s => s.items.map(i => i.box[0]));
      if (xs.some((x, k) => k && x <= xs[k - 1])) bad.push('items out of order');
      if (xs[0] < 100 || xs[xs.length - 1] > 900 || xs[xs.length - 1] < 800) bad.push(`items run ${xs[0]}–${xs[xs.length - 1]}, not across the staff`);
      // a note's middle is MIDDLE font units above the baseline: the punctum of Gló (f, the second line) is at 232
      const f = L.glyphs.find(v => v.name === 'Punctum'), sc = N.scaleOf(st.lines);
      bad.push(...same('Gló on the second line', Math.round((f.y - N.MIDDLE * sc) * 100) / 100, 232));
      bad.push(...same('font size: a step is half a space', Math.round(L.size * N.STEP / 1000 * 100) / 100, 8));
      bad.push(...same('words', L.texts.map(t => t.text).join(' '), 'Gló ri a Pa tri, et Fí li o, et Spi rí tu i San cto.'));
      if (L.texts.some(t => t.y < 248)) bad.push('words above the bottom line');
      return bad;
    } },
    { name: 'neumes: on a bent staff the notes follow the bend', unit: () => {
      const N = global.CGNeumes, lines = [0, 1, 2, 3].map(i => [100, 200 + 16 * i, 500, 230 + 16 * i, 900, 200 + 16 * i]);
      const st = { lines, syllables: C().fromGabc('(c4) A(f)a(f)a(f)a(f)a(f)').staves[0].syllables };
      N.place(st);
      const sc = N.scaleOf(lines);
      return N.layout(st).glyphs.filter(v => v.name === 'Punctum').flatMap(v => {
        const want = N.yOf(lines, v.x + 83 * sc, 5), got = v.y - N.MIDDLE * sc;
        return Math.abs(got - want) < 0.5 ? [] : [`a note at x ${v.x.toFixed(0)} is at ${got.toFixed(1)}, its line at ${want.toFixed(1)}`];
      });
    } },

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
        same('lines', svg.querySelectorAll('polyline').length, 4),
        same('glyphs (the clef and a punctum)', svg.querySelectorAll('.glyph').length, 2),
        same('doubtful', svg.querySelectorAll('.glyph.doubt').length, 1),
        same('overlay covers the page', [svg.getBoundingClientRect().width, svg.getBoundingClientRect().height].map(Math.round), [page.clientWidth, page.clientHeight]));
    } },
    { name: 'app: dragging a box round a staff finds its lines', browser: true, unit: async app => {
      const { w } = await app('test/pages/page2.png');
      await drag(w, [20, 45], [400, 110]);
      const st = await until(() => w.CGApp.state.doc.pages[0].staves[0]);
      const want = [0, 1, 2, 3].map(i => 60 + 12 * i);
      const off = Math.max(...st.lines.map((l, i) => Math.max(Math.abs(l[1] - want[i]), Math.abs(l[3] - want[i]))));
      return [].concat(
        off <= 1.5 ? [] : [`lines at ${st.lines.map(l => l[1]).join(', ')}, expected ${want.join(', ')}`],
        Math.abs(st.lines[0][0] - 30) <= 2 && Math.abs(st.lines[0][2] - 390) <= 2 ? [] : [`lines run from ${st.lines[0][0]} to ${st.lines[0][2]}, expected 30 to 390`],
        same('id', st.id, 'p1s1'), same('selected', w.CGEditor.selected, 'p1s1'),
        same('handles', w.document.querySelectorAll('#overlay .handle').length, 8),
        same('checks', w.CGChant.check(w.CGApp.state.doc), []));
    } },
    { name: 'app: staves move, tilt and stretch by their handles, and undo', browser: true, unit: async app => {
      const { w } = await app('test/pages/page2.png');
      await drag(w, [20, 155], [400, 220]);
      const st = await until(() => w.CGApp.state.doc.pages[0].staves[0]), first = JSON.stringify(st.lines), bad = [];
      const near = (a, b, what) => { if (Math.abs(a - b) > 1) bad.push(`${what}: ${a.toFixed(1)}, expected ${b}`); };
      const y0 = st.lines[0][1], x0 = st.lines[0][0], x1 = st.lines[0][2], st0 = i => JSON.parse(first)[i][3];
      await drag(w, [200, st.lines[1][1] + 6], [210, st.lines[1][1] + 26]);           // the body: moves it all
      let s = w.CGApp.state.doc.pages[0].staves[0];
      near(s.lines[0][1], y0 + 20, 'moved down'); near(s.lines[0][0], x0 + 10, 'moved right');
      await drag(w, [s.lines[2][2], s.lines[2][3]], [s.lines[2][2], s.lines[2][3] + 8]); // one line's right end
      s = w.CGApp.state.doc.pages[0].staves[0];
      near(s.lines[2][3], st0(2) + 20 + 8, 'one end moved'); near(s.lines[1][3], st0(1) + 20, 'the line above stayed');
      const bar = [s.lines[0][2], (s.lines[0][3] + s.lines[3][3]) / 2];
      await drag(w, bar, [bar[0] - 30, bar[1] - 8]);                                     // the right end: tilt and shorten
      s = w.CGApp.state.doc.pages[0].staves[0];
      near(s.lines[0][2], x1 + 10 - 30, 'shortened'); near(s.lines[0][3], st0(0) + 20 - 8, 'tilted');
      if (!(w.CGStaves.tilt(s.lines) < -0.5)) bad.push(`tilt ${w.CGStaves.tilt(s.lines)}`);
      if (!w.CGApp.state.dirty) bad.push('Not marked as changed.');
      for (let i = 0; i < 4; i++) w.CGEditor.undo();
      if (w.CGApp.state.doc.pages[0].staves.length) bad.push('Undo did not take the staff away.');
      for (let i = 0; i < 4; i++) w.CGEditor.redo();
      s = w.CGApp.state.doc.pages[0].staves[0];
      near(s.lines[0][2], x1 + 10 - 30, 'redone');
      w.CGEditor.selected = s.id;
      const tilted = JSON.stringify(s.lines);
      w.CGEditor.refit();
      await until(() => JSON.stringify(w.CGApp.state.doc.pages[0].staves[0].lines) !== tilted);
      near(w.CGApp.state.doc.pages[0].staves[0].lines[0][1], JSON.parse(first)[0][1], 'found again');
      return bad;
    } },
    { name: 'app: staves are kept in reading order; keys nudge and delete', browser: true, unit: async app => {
      const { w } = await app('test/pages/page2.png');
      await drag(w, [20, 265], [400, 330]);
      await until(() => w.CGApp.state.doc.pages[0].staves.length === 1);
      await drag(w, [20, 45], [400, 110]);
      await until(() => w.CGApp.state.doc.pages[0].staves.length === 2);
      const list = () => w.CGApp.state.doc.pages[0].staves;
      const bad = same('order', list().map(s => s.id), ['p1s2', 'p1s1']);
      const key = (k, o = {}) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o)));
      const y = list()[0].lines[0][1];
      key('ArrowDown', { shiftKey: true });
      if (!(list()[0].lines[0][1] > y)) bad.push('Shift+Down did not move the staff down.');
      key('Delete');
      bad.push(...same('after delete', list().map(s => s.id), ['p1s1']));
      key('z', { ctrlKey: true });
      bad.push(...same('after undo', list().map(s => s.id), ['p1s2', 'p1s1']));
      key('ArrowRight');
      bad.push(...same('arrow turns the page with nothing selected', w.CGApp.state.page, 0));   // one page only
      return bad;
    } },
    { name: 'app: lines found on an engraved page made to look like a scan', browser: true, unit: async app => {
      const { w } = await app('test/pages/engraved.jpg');
      const truth = await (await w.fetch('test/pages/engraved-lines.json')).json(), bad = [];
      // rough boxes, as a person might drag them: from left of the drop cap to past the end, well above and below
      const rough = [[-30, 18, 20], [-10, 26, 8], [-40, 12, 30], [0, 22, 14], [-20, 30, 25]];
      for (const [k, t] of truth.entries()) {
        const top = Math.min(t[0][1], t[0][3]), bot = Math.max(t[3][1], t[3][3]), r = rough[k];
        await w.CGEditor.addStaff([90 + r[0], top - r[1], 1050, bot - top + r[1] + r[2]]);
      }
      const staves = w.CGApp.state.doc.pages[0].staves;
      if (staves.length !== truth.length) return [`${staves.length} staves, expected ${truth.length}`];
      const yAt = (l, x) => l[1] + (l[3] - l[1]) * (x - l[0]) / (l[2] - l[0]);
      truth.forEach((t, k) => {
        const l = staves[k].lines, g = w.CGStaves.spacing(t);
        const off = Math.max(...l.map((v, i) => Math.max(Math.abs(v[1] - yAt(t[i], v[0])), Math.abs(v[3] - yAt(t[i], v[2])))));
        if (off > 1.5) bad.push(`staff ${k + 1}: lines up to ${off.toFixed(1)} px off`);
        if (Math.abs(l[0][0] - t[0][0]) > g / 2 || Math.abs(l[0][2] - t[0][2]) > g / 2) bad.push(`staff ${k + 1}: runs ${l[0][0]}–${l[0][2]}, truly ${t[0][0]}–${t[0][2]}`);
        if (Math.abs(w.CGStaves.tilt(l) - 0.7) > 0.1) bad.push(`staff ${k + 1}: tilted ${w.CGStaves.tilt(l).toFixed(2)}°, truly 0.70°`);
        if (w.CGStaves.count(l[0]) !== 2) bad.push(`staff ${k + 1}: straight, but given ${w.CGStaves.count(l[0]) - 2} bends`);
      });
      return bad;
    } },
    { name: 'app: bent lines followed on a page that wasn\'t scanned flat', browser: true, unit: async app => {
      const { w } = await app('test/pages/warped.jpg');
      const truth = await (await w.fetch('test/pages/warped-lines.json')).json(), bad = [];
      const rough = [[-30, 18, 20], [-10, 26, 8], [-40, 12, 30], [0, 22, 14], [-20, 30, 25]];
      for (const [k, t] of truth.entries()) {
        const ys = t.flatMap(l => l.filter((v, i) => i & 1)), r = rough[k];
        await w.CGEditor.addStaff([90 + r[0], Math.min(...ys) - r[1], 1050, Math.max(...ys) - Math.min(...ys) + r[1] + r[2]]);
      }
      const staves = w.CGApp.state.doc.pages[0].staves, S = w.CGStaves;
      if (staves.length !== truth.length) return [`${staves.length} staves, expected ${truth.length}`];
      truth.forEach((t, k) => {
        const l = staves[k].lines, g = S.spacing(t), xs = S.xsOf(l[0]), from = xs[0], to = xs[xs.length - 1];
        let off = 0;
        for (let x = from; x <= to; x += 4) for (let i = 0; i < 4; i++) off = Math.max(off, Math.abs(S.yAt(l[i], x) - S.yAt(t[i], x)));
        if (off > 2) bad.push(`staff ${k + 1}: lines up to ${off.toFixed(1)} px off`);
        const tx = S.xsOf(t[0]);
        if (Math.abs(from - tx[0]) > g / 2 || Math.abs(to - tx[tx.length - 1]) > g / 2) bad.push(`staff ${k + 1}: runs ${from}–${to}, truly ${tx[0]}–${tx[tx.length - 1]}`);
        if (S.count(l[0]) < 3) bad.push(`staff ${k + 1}: not bent`);
      });
      return bad;
    } },
    { name: 'app: bends added, dragged and taken away', browser: true, unit: async app => {
      const { w } = await app('test/pages/page2.png');
      await drag(w, [20, 45], [400, 110]);
      const S = w.CGStaves, st = () => w.CGApp.state.doc.pages[0].staves[0];
      await until(() => st());
      const dbl = p => {
        const svg = w.document.getElementById('overlay'), m = svg.getScreenCTM(), x = m.a * p[0] + m.e, y = m.d * p[1] + m.f;
        w.document.elementFromPoint(x, y).dispatchEvent(new w.MouseEvent('dblclick', { clientX: x, clientY: y, bubbles: true }));
      };
      dbl([200, S.yAt(st().lines[1], 200) + 6]);
      const bad = same('points after a double-click', S.count(st().lines[0]), 3);
      if (Math.abs(st().lines[0][2] - 200) > 1) bad.push(`bend at ${st().lines[0][2]}, expected 200`);
      // the bend's bar dragged down: the middle bows, the ends stay
      const y0 = st().lines[0][1], ym = st().lines[0][3], mid = (S.yAt(st().lines[0], 200) + S.yAt(st().lines[3], 200)) / 2;
      await drag(w, [200, mid], [200, mid + 10]);
      bad.push(...same('ends stay', Math.round(st().lines[0][1]), Math.round(y0)));
      if (Math.abs(st().lines[0][3] - (ym + 10)) > 1) bad.push(`the bend moved to ${st().lines[0][3]}, expected ${ym + 10}`);
      if (!/bent at 1 point/.test(w.document.getElementById('staffInfo').textContent)) bad.push('No word of the bend: ' + w.document.getElementById('staffInfo').textContent);
      dbl([200, (S.yAt(st().lines[0], 200) + S.yAt(st().lines[3], 200)) / 2]);
      bad.push(...same('points after double-clicking the bend', S.count(st().lines[0]), 2));
      w.CGEditor.undo();
      bad.push(...same('undo brings the bend back', S.count(st().lines[0]), 3));
      bad.push(...same('checks', w.CGChant.check(w.CGApp.state.doc), []));
      return bad;
    } },
    { name: 'app: GABC placed on the staves, drawn, saved as GABC, undone', browser: true, unit: async app => {
      const { w } = await app('test/pages/engraved.jpg');
      const truth = await (await w.fetch('test/pages/engraved-lines.json')).json(), bad = [];
      for (const t of truth.slice(0, 2)) { const ys = t.flatMap(l => l.filter((v, i) => i & 1)); await w.CGEditor.addStaff([70, Math.min(...ys) - 20, 1060, Math.max(...ys) - Math.min(...ys) + 40]); }
      const staves = w.CGApp.state.doc.pages[0].staves;
      w.CGEditor.selected = staves[0].id;
      const src = 'name: Two lines;\n%%\n(c4) KY(f)ri(gh)e(h) *(,) e(hjh)lé(gh)i(g)son.(f.) (::) (z) (c3) A(e)ve(fg) Ma(g)rí(h)a,(g.) (::)';
      if (!w.CGEditor.placeChant(src)) return ['Not placed: ' + w.document.getElementById('status').textContent];
      bad.push(...same('on both staves', staves.map(s => s.syllables.length > 0), [true, true]));
      bad.push(...same('one chant, over both', w.CGApp.state.doc.chants.map(c => [c.headers.name, c.staves.length]), [['Two lines', 2]]));
      await new Promise(r => setTimeout(r, 50));
      const glyphs = w.document.querySelectorAll('#overlay .glyph');
      if (glyphs.length < 20) bad.push(`${glyphs.length} glyphs drawn`);
      if (!(await w.document.fonts.check('20px greciliae'))) bad.push('The chant font did not load.');
      bad.push(...same('words drawn (the * too)', w.document.querySelectorAll('#overlay .syl').length, 13));
      bad.push(...same('checks', w.CGChant.check(w.CGApp.state.doc), []));
      const out = w.CGEditor.gabc();
      bad.push(...same('GABC out', out && out.text.slice(out.text.indexOf('%%') + 2).trim(), '(c4) KY(f)ri(gh)e(h) *(,) e(hjh)lé(gh)i(g)son.(f.) (::) (z) (c3) A(e)ve(fg) Ma(g)rí(h)a,(g.) (::)'));
      // the staff moved: its chant goes with it
      const x = staves[0].syllables[1].items[0].box[0];
      w.CGEditor.selected = staves[0].id;
      w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
      if (!(staves[0].syllables[1].items[0].box[0] > x)) bad.push('The chant did not move with its staff.');
      w.CGEditor.undo(); w.CGEditor.undo();
      bad.push(...same('undone', w.CGApp.state.doc.pages[0].staves.map(s => s.syllables.length), [0, 0]));
      return bad;
    } },
    { name: 'app: a neume dragged up and along, a note of it alone, by keys; accepted, deleted, undone', browser: true, unit: async app => {
      const { w, shown } = await app('test/pages/engraved.jpg');
      await w.CGEditor.addStaff([70, 430, 1060, 90]);
      // zoomed in, as for fine work: a step is then more than the few pixels a press may wander before it's a drag
      for (let i = 0; i < 3; i++) { w.document.getElementById('zoomIn').click(); await shown(0); }
      const stage = w.document.getElementById('stage'), m = w.document.getElementById('overlay').getScreenCTM(), r = stage.getBoundingClientRect();
      stage.scrollTop += m.d * 400 + m.f - r.top; stage.scrollLeft += m.a * 120 + m.e - r.left;
      await new Promise(res => setTimeout(res, 50));
      const st = () => w.CGApp.state.doc.pages[0].staves[0], bad = [];
      w.CGEditor.selected = st().id;
      w.CGEditor.placeChant('(f3) Al(f)le(gh)lú(hj)ia.(h.) (::)');
      const it = () => st().syllables[2].items[0], box = it().box.slice(), step = (st().lines[3][1] - st().lines[0][1]) / 6;
      // dragged down two steps and along
      await drag(w, [box[0] + box[2] / 2, box[1] + box[3] / 2], [box[0] + box[2] / 2 + 20, box[1] + box[3] / 2 + 2 * step]);
      bad.push(...same('down two steps', it().g, 'ef'), ...same('marked', it().checked, 'edited'));
      if (Math.abs(it().box[0] - box[0] - 20) > 1) bad.push(`moved along by ${(it().box[0] - box[0]).toFixed(1)}, not 20`);
      bad.push(...same('selected', w.CGEditor.neume, { s: 2, i: 0 }));
      if (!/C3 D3/.test(w.document.getElementById('chantInfo').textContent)) bad.push('No note names: ' + w.document.getElementById('chantInfo').textContent);
      const key = (k, o = {}) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o)));
      key('ArrowUp');
      bad.push(...same('up a step by key', it().g, 'fg'));
      key('Enter');
      bad.push(...same('Enter goes on to the next', w.CGEditor.neume, { s: 3, i: 0 }));
      key('Enter');
      bad.push(...same('accepted alone', st().syllables[3].items[0].checked, 'item'));
      // Shift-drag on the top note of hj: that note alone
      const b3 = st().syllables[3].items[0].box, x3 = b3[0] + b3[2] / 2, yTop = w.CGNeumes.yOf(st().lines, x3, 9);
      await drag(w, [x3, yTop], [x3, yTop + step], { shiftKey: true });
      bad.push(...same('one note moved', st().syllables[3].items[0].g, 'hi'));
      // a drag that comes back where it began changes nothing
      const b1 = st().syllables[1].items[0].box.slice();
      await drag(w, [b1[0] + b1[2] / 2, b1[1] + b1[3] / 2], [b1[0] + b1[2] / 2 + 15, b1[1] + b1[3] / 2], { back: true });
      bad.push(...same('put back: not marked', st().syllables[1].items[0].checked, undefined));
      w.CGEditor.selectNeume(st().id, 4, 0);
      key('Delete');
      bad.push(...same('deleted', st().syllables[4].items.map(i => i.g), []));
      // five changes: the drag, the key, the acceptance, the note, the deletion (the first Enter changed nothing)
      for (let i = 0; i < 5; i++) w.CGEditor.undo();
      bad.push(...same('all undone', [st().syllables[2].items[0].g, st().syllables[3].items[0].g, st().syllables[4].items[0].g], ['gh', 'hj', 'h.']));
      bad.push(...same('checks', w.CGChant.check(w.CGApp.state.doc), []));
      return bad;
    } },
    { name: 'app: words corrected, dragged, split and joined; a staff accepted once its doubtful places are checked', browser: true, unit: async app => {
      const { w } = await app('test/pages/engraved.jpg');
      await w.CGEditor.addStaff([70, 545, 1060, 95]);
      await w.CGEditor.addStaff([70, 430, 1060, 90]);
      const [a] = w.CGApp.state.doc.pages[0].staves, bad = [], doc = w.CGApp.state.doc;
      w.CGEditor.selected = a.id;
      w.CGEditor.placeChant('(f3) Al(f)le(gh)lú(hj)ia.(h.) (::) (z) (c4) Gló(f)ri(gh)a(h) (:)');
      const st = () => doc.pages[0].staves[0];
      st().syllables[2].items[0].conf = 0.5; st().syllables[3].conf = 0.4;   // as if the recognizer doubted them
      w.CGEditor.selected = st().id;
      const key = (k, o = {}) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o)));
      key('Enter', { shiftKey: true });
      bad.push(...same('refused: the doubtful neume first', w.CGEditor.neume, { s: 2, i: 0 }));
      if (!/2 doubtful places/.test(w.document.getElementById('status').textContent)) bad.push('No word of the doubtful places: ' + w.document.getElementById('status').textContent);
      key('Enter');
      key('Enter', { shiftKey: true });
      bad.push(...same('then the doubtful syllable', w.CGEditor.word, 3));
      w.CGEditor.setText('lu');
      w.CGEditor.setDipl('lú');
      bad.push(...same('text and reading as written', [st().syllables[3].text, st().syllables[3].dipl, st().syllables[3].checked], ['lu', 'lú', 'edited']));
      w.CGEditor.setDipl('lu');
      bad.push(...same('no reading as written when it is the same', st().syllables[3].dipl, undefined));
      // the words of Al dragged
      const t = w.document.querySelector('#overlay .syl[data-s="1"]'), x = +t.getAttribute('x'), y = +t.getAttribute('y');
      await drag(w, [x, y - 3], [x - 12, y + 5]);
      const box = st().syllables[1].box;
      if (!box || Math.abs(box[0] + box[2] / 2 - (x - 12)) > 1.5 || Math.abs(box[1] + box[3] - (y + 8)) > 1.5) bad.push(`dragged to ${JSON.stringify(box)}, not round ${x - 12}, ${y + 8}`);
      // joined, then split again at the second neume
      w.CGEditor.selectWord(st().id, 2);
      w.CGEditor.joinPrev();
      bad.push(...same('joined', [st().syllables[1].text, st().syllables[1].items.map(i => i.g)], ['Alle', ['f', 'gh']]));
      w.CGEditor.selectNeume(st().id, 1, 1);
      w.CGEditor.splitHere();
      w.CGEditor.setText('le');
      bad.push(...same('split', st().syllables.slice(1, 3).map(s => [s.text, s.items.map(i => i.g), !!s.join]), [['Alle', ['f'], false], ['le', ['gh'], true]]));
      w.CGEditor.selected = st().id;
      key('Enter', { shiftKey: true });
      bad.push(...same('accepted: everything checked', st().syllables.every(s => (!s.text || s.checked) && s.items.every(i => i.checked)), true));
      bad.push(...same('how', st().syllables[0].items[0].checked, 'staff'));
      bad.push(...same('on to the next staff', w.CGEditor.selected, doc.pages[0].staves[1].id));
      bad.push(...same('checks', w.CGChant.check(doc), []));
      return bad;
    } },
    { name: 'app: GABC with more lines than staves says so', browser: true, unit: async app => {
      const { w } = await app('test/pages/page2.png');
      await drag(w, [20, 265], [400, 330]);
      await until(() => w.CGApp.state.doc.pages[0].staves.length === 1);
      w.CGEditor.placeChant('(c4) a(f) (z) b(g) (z) c(h)');
      return /2 had no staff below/.test(w.document.getElementById('status').textContent) ? [] : ['No word of the lines left over: ' + w.document.getElementById('status').textContent];
    } },
    { name: 'app: lines found on a PDF page, in points', browser: true, unit: async app => {
      const { w } = await app('test/pages/two-pages.pdf');
      await w.CGEditor.addStaff([20, 45, 380, 65]);
      const st = w.CGApp.state.doc.pages[0].staves[0];
      if (!st) return ['No staff.'];
      // the test page's first staff: lines 12 px apart from 60, drawn on a 420 × 595 page set as A5 (420 × 595 points)
      const off = Math.max(...st.lines.map((l, i) => Math.abs((l[1] + l[3]) / 2 - (60 + 12 * i))));
      return off <= 1.5 ? [] : [`lines at ${st.lines.map(l => l[1].toFixed(1)).join(', ')}`];
    } },
    { name: 'app: holding H hides the layer', browser: true, unit: async app => {
      const { w } = await app('test/pages/page2.png');
      const svg = w.document.getElementById('overlay'), key = (type, k) => w.document.dispatchEvent(new w.KeyboardEvent(type, { key: k, bubbles: true }));
      key('keydown', 'h');
      const hidden = w.getComputedStyle(svg).visibility;
      key('keyup', 'h');
      return [].concat(same('while held', hidden, 'hidden'), same('let go', w.getComputedStyle(svg).visibility, 'visible'));
    } },
    { name: 'app: a box with no staff in it gets even lines', browser: true, unit: async app => {
      const { w } = await app('test/pages/page2.png');
      await drag(w, [100, 110], [300, 160]);   // between the first two staves
      const st = await until(() => w.CGApp.state.doc.pages[0].staves[0]);
      return [].concat(same('even', st.lines.map(l => Math.round(l[1])), [110, 127, 143, 160]),
        /spread evenly/.test(w.document.getElementById('status').textContent) ? [] : ['No word that the lines were spread evenly.']);
    } },
    { name: 'app: a document saved and opened again', browser: true, unit: async app => {
      const { w } = await app('test/pages/page2.png', 'test/pages/page10.png');
      await drag(w, [20, 45], [400, 110]);
      await until(() => w.CGApp.state.doc.pages[0].staves.length === 1);
      let saved = null;
      const real = w.URL.createObjectURL;
      w.URL.createObjectURL = b => { saved = b; return real.call(w.URL, b); };
      w.CGApp.save();
      w.URL.createObjectURL = real;
      if (!saved) return ['Nothing was saved.'];
      const text = await saved.text(), bad = [];
      if (w.CGApp.state.dirty) bad.push('Still marked as changed after saving.');
      w.CGApp.state.doc.pages[0].staves = [];
      await w.CGApp.open([new w.File([text], 'page.chantgpt.json', { type: 'application/json' })]);
      bad.push(...same('staves back', w.CGApp.state.doc.pages[0].staves.map(s => s.id), ['p1s1']));
      // a document for another scan is refused
      const other = JSON.parse(text);
      other.pages.pop(); other.source.pages = 1;
      await w.CGApp.open([new w.File([JSON.stringify(other)], 'other.chantgpt.json', { type: 'application/json' })]);
      if (!/not to the scan that is open/.test(w.document.getElementById('status').textContent)) bad.push('A document for another scan was not refused: ' + w.document.getElementById('status').textContent);
      bad.push(...same('staves kept', w.CGApp.state.doc.pages[0].staves.length, 1));
      return bad;
    } },
    { name: 'app: a file it cannot read is explained', browser: true, unit: async app => {
      const { w } = await app();
      await w.CGApp.open([new w.File(['x'], 'scan.tif', { type: 'image/tiff' })]);
      return /TIFF/.test(w.document.getElementById('status').textContent) ? [] : ['No word about TIFF: ' + w.document.getElementById('status').textContent];
    } }
  ];

  // a test page, as for a scan: four lines from x 100 to 900, top at 200, 16 apart, 2 px thick, along a slope and
  // bowed by bow pixels in the middle; square notes on them; a line of words below if asked
  function page(slope, words, bow = 0) {
    const w = 1000, h = 500, g = new Uint8Array(w * h).fill(235);
    const ink = (x, y) => { if (x >= 0 && y >= 0 && x < w && y < h) g[y * w + x] = 20; };
    const off = x => slope * (x - 500) + bow * Math.sin(Math.PI * (x - 100) / 800);
    for (let i = 0; i < 4; i++) for (let x = 100; x < 900; x++) { const y = Math.round(200 + 16 * i + off(x)); ink(x, y); ink(x, y + 1); }
    for (let j = 0; j < 20; j++) {
      const cx = 150 + j * 35, cy = 200 + ((j * 3) % 7) * 8 + off(cx) - 6;
      for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) ink(cx + a, Math.round(cy + b));
    }
    if (words) for (let x = 120; x < 880; x++) if ((x % 9) < 6) for (let y = 300; y < 312; y++) if ((x + y) % 3) ink(x, y);
    return { g, w, h };
  }

  // a drag with the mouse in the app's overlay, between two points in page units
  // (shiftKey: with Shift held; back: there and back again, ending where it began)
  async function drag(w, from, to, { shiftKey = false, back = false } = {}) {
    const svg = w.document.getElementById('overlay'), m = svg.getScreenCTM();
    const client = p => [m.a * p[0] + m.e, m.d * p[1] + m.f];
    const fire = (type, p) => {
      const [x, y] = client(p), t = type === 'pointerdown' ? w.document.elementFromPoint(x, y) : svg;
      t.dispatchEvent(new w.PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true, shiftKey, bubbles: true, cancelable: true }));
    };
    fire('pointerdown', from);
    for (let i = 1; i <= 5; i++) fire('pointermove', [from[0] + (to[0] - from[0]) * i / 5, from[1] + (to[1] - from[1]) * i / 5]);
    if (back) { for (let i = 4; i >= 0; i--) fire('pointermove', [from[0] + (to[0] - from[0]) * i / 5, from[1] + (to[1] - from[1]) * i / 5]); to = from; }
    fire('pointerup', to);
    await new Promise(r => setTimeout(r, 30));
  }

  // waits for f() to give something (finding lines takes a moment)
  async function until(f, ms = 5000) {
    const end = Date.now() + ms;
    for (;;) {
      const v = f();
      if (v) return v;
      if (Date.now() > end) throw new Error('Timed out waiting.');
      await new Promise(r => setTimeout(r, 20));
    }
  }

  // has anything dark been drawn in the middle of the canvas?
  function inked(canvas) {
    const ctx = canvas.getContext('2d'), d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < d.length; i += 4 * 7) if (d[i] < 80 && d[i + 1] < 80 && d[i + 2] < 80) return true;
    return false;
  }
})(typeof window !== 'undefined' ? window : globalThis);
