// Square notation from GABC, in the Greciliae font (Gregorio's), placed along a staff. A GABC group of neume
// material (fgh, f/gh, ivHG) is read into notes, the notes gathered into glyphs as Gregorio gathers them (a pes, a
// torculus, a porrectus …), and each glyph named as Gregorio names it in the font (TorculusOneTwoNothing). A glyph
// the font hasn't got falls back to its notes one by one. Then a staff's syllables are laid out along it, and each
// glyph given its place on the page. Nothing here draws: editor.js draws what layout() gives.
//
// Ported in part from Gregorio (gabc-glyphs-determination.c, gregoriotex-write.c; GPLv3), simplified: no fusion
// (@), no hollow notes, no episemata or other signs yet beyond the mora.
(function (global) {
  'use strict';
  const F = () => global.CGGreciliae, S = () => global.CGStaves, Ch = () => global.CGChant;
  const AMB = ['', 'One', 'Two', 'Three', 'Four', 'Five'];
  const STEP = 157.5, MIDDLE = 72;   // font units: one pitch step; a note's middle above the glyph's baseline
  const has = name => !!F().glyphs[name];
  const width = name => (F().glyphs[name] || [0, 166])[1];
  const posOf = ch => ch.toLowerCase().charCodeAt(0) - 97;

  // ---------------------------------------------------------------- notes
  // The notes of a group of neume material, with what comes before each: sep is the separator written before it
  // ('/', '//', ' ', '!', or null for none). An accidental (ix) is an item of its own: { acc: 'x', p }.
  function parse(g) {
    const out = [];
    let sep = null, initio = false;
    for (let i = 0; i < g.length;) {
      const ch = g[i];
      if (ch === '[') { const j = g.indexOf(']', i); i = j < 0 ? g.length : j + 1; continue; }
      if (ch === '/') { sep = g[i + 1] === '/' ? '//' : (sep === ' ' ? ' ' : '/'); i += sep === '//' ? 2 : 1; continue; }
      if (ch === ' ') { sep = ' '; i++; continue; }
      if (ch === '!') { sep = '!'; i++; continue; }
      if (ch === '-') { initio = true; i++; continue; }
      if (!/[a-m]/i.test(ch)) { i++; continue; }
      const p = posOf(ch);
      if (/[xy#]/.test(g[i + 1] || '')) { out.push({ acc: g[i + 1], p, sep }); sep = null; i += 2; if (g[i] === '?') i++; continue; }
      let j = i + 1;
      while (j < g.length && !/[a-m\[\/ !@-]/i.test(g[j])) j++;
      const m = g.slice(i + 1, j);
      const n = { p, sep, signs: m, mora: (m.match(/\./g) || []).length };
      if (ch !== ch.toLowerCase()) n.shape = 'inclinatum';
      else if (/V/.test(m)) n.shape = 'reversa';
      else if (/v/.test(m)) n.shape = 'virga';
      else if (/w/.test(m)) n.shape = 'quilisma';
      else if (/O/.test(m)) n.shape = 'scapus';
      else if (/o/.test(m)) n.shape = 'oriscus';
      else if (/s/.test(m)) n.shape = 'stropha';
      else n.shape = 'punctum';
      if (/q/.test(m)) n.quadratum = true;
      if (/~/.test(m)) n.liq = 'Deminutus'; else if (/</.test(m)) n.liq = 'Ascendens'; else if (/>/.test(m)) n.liq = 'Descendens';
      if (initio) n.initio = true;
      // repeated (gss, gvv): the note again, close up
      const reps = Math.max(1, (m.match(n.shape === 'stropha' ? /s/g : n.shape === 'virga' ? /v/g : /$^/g) || []).length);
      out.push(n);
      for (let r = 1; r < reps; r++) out.push(Object.assign({}, n, { sep: '!' }));
      sep = null; initio = false;
      i = j;
    }
    return out;
  }

  // ---------------------------------------------------------------- glyphs
  // Notes gathered into glyphs as Gregorio gathers them: { type, notes, sep } or { acc, p, sep }. A separator ends a
  // glyph; so does a unison, a liquescent, or a note that can only stand alone (virga, inclinatum, stropha …).
  const NEXT = {   // the glyph a note going up or down makes of the glyph so far
    punctum: { up: 'pes', down: 'flexus' },
    pes: { up: 'scandicus', down: 'torculus' },
    flexus: { up: 'porrectus' },
    torculus: { up: 'torculusResupinus' },
    porrectus: { down: 'porrectusFlexus' }
  };
  const ALONE = new Set(['virga', 'reversa', 'inclinatum', 'stropha', 'scapus']);

  function glyphs(g) {
    const out = [];
    let cur = null;
    const close = () => { if (cur) out.push(cur); cur = null; };
    for (const n of parse(g)) {
      if (n.acc) { close(); out.push(n); continue; }
      if (n.sep) close();
      if (cur) {
        const last = cur.notes[cur.notes.length - 1], dir = n.p > last.p ? 'up' : n.p < last.p ? 'down' : null;
        const next = dir && (NEXT[cur.type] || {})[dir];
        // a quilisma or oriscus begins a glyph; a note marked initio debilis too
        // (a scandicus only from a plain punctum, as in Gregorio)
        const fits = next && !ALONE.has(n.shape) && n.shape !== 'quilisma' && !n.initio && !(n.shape === 'oriscus' && cur.type !== 'punctum') &&
          !(next === 'scandicus' && cur.notes[0].shape !== 'punctum');
        if (fits) { cur.type = next; cur.notes.push(n); if (n.liq || n.mora) close(); continue; }
        close();
      }
      cur = { type: ALONE.has(n.shape) ? n.shape : 'punctum', notes: [n], sep: n.sep };
      if (ALONE.has(n.shape) || n.liq || n.mora) close();
    }
    close();
    return out;
  }

  // ---------------------------------------------------------------- names
  // where a note's stem would run, as Gregorio has it: which queue length a glyph needs
  function queue(p) {
    if (p === 0 || p === 2) return 'below';
    if (p === 1 || p === 3) return 'bottom';
    return p % 2 ? 'line' : 'space';
  }
  // Gregorio's flexus_shape: a flexus's stem by where its second note lies, and whether it falls a second
  function flexusShape(base, a1, p2) {
    const q = queue(p2), one = a1 === 1;
    if (q === 'below' || q === 'bottom') return one ? base + 'Openqueue' : (q === 'below' ? base : base + 'Longqueue');
    if (q === 'space') return one ? base + 'Longqueue' : base;
    return one ? base : base + 'Longqueue';
  }
  const liqOf = (gl, initioAllowed = true) => {
    const last = gl.notes[gl.notes.length - 1], first = gl.notes[0];
    const tail = last.liq || '', ini = initioAllowed && first.initio;
    if (ini) return 'InitioDebilis' + tail;
    return tail || 'Nothing';
  };

  // the name of a one-note glyph
  function noteName(n, prev, next) {
    const q = queue(n.p);
    switch (n.shape) {
      case 'virga': return q === 'line' ? 'VirgaLongqueue' : q === 'space' ? 'Virga' : 'VirgaOpenqueue';
      case 'reversa': {
        const base = 'VirgaReversa' + (q === 'line' ? 'Longqueue' : q === 'bottom' ? 'Openqueue' : '');
        return n.liq === 'Ascendens' || n.liq === 'Descendens' ? base + n.liq : base;
      }
      case 'inclinatum':
        if (n.liq === 'Deminutus') return 'PunctumInclinatumDeminutus';
        if (n.liq) return 'PunctumInclinatumAuctus';
        return (next && next.p > n.p) || (!next && prev && prev.p < n.p) ? 'AscendensPunctumInclinatum' : 'DescendensPunctumInclinatum';
      case 'quilisma': return 'Quilisma';
      case 'oriscus': return next && next.p < n.p ? 'DescendensOriscus' : 'AscendensOriscus';
      case 'scapus': return (next && next.p < n.p ? 'DescendensOriscusScapus' : 'AscendensOriscusScapus') + (q === 'line' ? 'Longqueue' : q === 'bottom' || q === 'below' ? 'Openqueue' : '');
      case 'stropha': return n.liq ? 'StrophaAucta' : 'Stropha';
      default: return n.liq ? 'Punctum' + n.liq : 'Punctum';
    }
  }

  // the name of a glyph of several notes, or null if Gregorio has no such glyph
  function multiName(gl) {
    const ps = gl.notes.map(n => n.p), a = [];
    for (let k = 1; k < ps.length; k++) a.push(Math.abs(ps[k] - ps[k - 1]));
    if (a.some(v => v < 1 || v > 5)) return null;
    const first = gl.notes[0], amb = a.map(v => AMB[v]).join('');
    switch (gl.type) {
      case 'pes': {
        let shape = 'Pes';
        if (first.shape === 'quilisma') shape = first.quadratum ? 'QuilismaPesQuadratum' : 'QuilismaPes';
        else if (first.shape === 'oriscus') shape = 'PesQuassus';
        else if (first.quadratum) shape = 'PesQuadratum';
        if (shape !== 'Pes' && shape !== 'QuilismaPes') {
          // Gregorio's quadratum_shape: the stem by where the first note lies
          const q = queue(first.p), one = a[0] === 1;
          if (q === 'below' || q === 'bottom') shape += one ? 'Openqueue' : (q === 'below' ? '' : 'Longqueue');
          else if (q === 'space') shape += one ? 'Longqueue' : '';
          else shape += one ? '' : 'Longqueue';
        }
        return shape + amb + liqOf(gl, shape === 'Pes' || shape === 'PesQuadratum');
      }
      case 'flexus': {
        const shape = flexusShape(first.shape === 'oriscus' ? 'FlexusOriscus' : 'Flexus', a[0], ps[1]);
        return shape + amb + liqOf(gl, false);
      }
      case 'torculus': return (first.shape === 'quilisma' ? 'TorculusQuilisma' : 'Torculus') + amb + liqOf(gl, first.shape !== 'quilisma');
      case 'torculusResupinus': return (first.shape === 'quilisma' ? 'TorculusResupinusQuilisma' : 'TorculusResupinus') + amb + liqOf(gl);
      case 'porrectus':
      case 'porrectusFlexus': {
        const base = gl.type === 'porrectus' ? 'Porrectus' : 'PorrectusFlexus';
        const long = (a[0] === 1 || gl.notes[gl.notes.length - 1].liq === 'Deminutus') && queue(first.p) === 'line';
        return base + (long ? 'Longqueue' : '') + amb + liqOf(gl, false);
      }
      case 'scandicus': return 'Scandicus' + amb + (gl.notes[gl.notes.length - 1].liq === 'Deminutus' ? 'Deminutus' : 'Nothing');
    }
    return null;
  }

  // A group of neume material as glyphs to draw: [{ name, p (the pitch it is set at), dx (font units from the
  // group's start), w (its width), notes }], and the group's width. A glyph the font hasn't got is drawn note by note.
  const GAP = { '!': 0, null: 25, '/': 45, '//': 90, ' ': 90 };   // font units between glyphs, by separator
  function shapes(g) {
    const out = [];
    let x = 0;
    const put = (name, p, notes, sep) => {
      if (out.length) x += GAP[sep] !== undefined ? GAP[sep] : GAP.null;
      out.push({ name, p, dx: x, w: width(name), notes });
      x += width(name);
    };
    const list = glyphs(g);
    list.forEach((gl, k) => {
      if (gl.acc) { put(gl.acc === 'x' ? 'Flat' : gl.acc === 'y' ? 'Natural' : 'Sharp', gl.p, [], gl.sep); return; }
      const name = gl.notes.length > 1 ? multiName(gl) : null;
      if (name && has(name)) put(name, gl.notes[0].p, gl.notes, gl.sep);
      else gl.notes.forEach((n, i) => {
        const prev = i ? gl.notes[i - 1] : (list[k - 1] && list[k - 1].notes ? list[k - 1].notes[list[k - 1].notes.length - 1] : null);
        const next = i < gl.notes.length - 1 ? gl.notes[i + 1] : (list[k + 1] && list[k + 1].notes ? list[k + 1].notes[0] : null);
        let nm = noteName(n, prev, next);
        if (!has(nm)) nm = 'Punctum';
        put(nm, n.p, [n], i ? null : gl.sep);
      });
      // moras after the glyph, at their notes
      for (const n of gl.notes || []) for (let m = 0; m < n.mora; m++) { x += 20; out.push({ name: 'AuctumMora', p: n.p, dx: x, w: width('AuctumMora'), notes: [], sign: true }); x += width('AuctumMora'); }
    });
    return { list: out, width: x };
  }

  // the glyphs of any GABC item: a clef, a bar, a custos, an accidental or neume material. For a clef, cb3 gives
  // the clef and its flat. first: whether it opens the staff (a clef changing later is drawn smaller).
  function itemShapes(g, first) {
    const kind = Ch().kind(g);
    if (kind === 'clef') {
      const m = /^([cf])(b?)([1-5])$/.exec(g), line = 1 + 2 * +m[3];
      const name = (m[1] === 'c' ? 'CClef' : 'FClef') + (first ? '' : 'Change');
      const list = [{ name, p: line - 1, dx: 0, w: width(name), notes: [] }];
      if (m[2]) list.push({ name: 'Flat', p: (m[1] === 'c' ? line : line + 3) - 1, dx: width(name) + 40, w: width('Flat'), notes: [] });
      return { list, width: list.reduce((t, v) => Math.max(t, v.dx + v.w), 0) };
    }
    if (kind === 'bar') {
      const name = /^::/.test(g) ? 'DivisioMaiorFour' : /^:/.test(g) ? 'DivisioMaiorFour' : /^;/.test(g) ? 'DivisioMinorFour' : /^,/.test(g) ? 'DivisioMinimaFour' : 'VirgulaFour';
      const list = [{ name, p: 6, dx: 0, w: width(name), notes: [], bar: true }];
      if (/^::/.test(g)) list.push({ name, p: 6, dx: width(name) + 60, w: width(name), notes: [], bar: true });
      return { list, width: list[list.length - 1].dx + list[list.length - 1].w };
    }
    if (kind === 'custos') {
      const p = posOf(g[0]), name = p <= 6 ? 'CustosUpShort' : 'CustosDownShort';
      return { list: [{ name, p, dx: 0, w: width(name), notes: [] }], width: width(name) };
    }
    if (kind === 'break') return { list: [], width: 0 };
    return shapes(g);
  }

  // ---------------------------------------------------------------- along a staff
  // How big the notation is on a staff: page units per font unit (a pitch step is half the line spacing).
  const scaleOf = lines => S().spacing(lines) / 2 / STEP;

  // Each item of a staff given its place, where it hasn't one: laid out from the staff's start (after any box an
  // item already has), the items' natural widths and gaps stretched to fill the staff as a printed line is
  // justified. An item's box is [x, y, w, h] in page units; x and w are what matter, y and h follow its notes.
  // Returns the items that were placed.
  function place(staff) {
    const sc = scaleOf(staff.lines), xs = S().xsOf(staff.lines[0]), x0 = xs[0], x1 = xs[xs.length - 1];
    const items = [];
    let firstClef = true;
    staff.syllables.forEach(syl => syl.items.forEach(it => {
      const sh = itemShapes(it.g, firstClef && Ch().kind(it.g) === 'clef' && !items.length);
      if (Ch().kind(it.g) === 'clef') firstClef = false;
      items.push({ it, sh, syl, startsSyl: syl.items[0] === it });
    }));
    const todo = items.filter(v => !v.it.box);
    if (!todo.length) return [];
    // natural spacing, in font units: a little between items of a syllable, more between syllables; the clef close
    // to the staff's start, as printed. The gaps are then stretched to fill the staff, as a printed line is justified.
    const lead = 0.25 * STEP, gapSyl = 2.2 * STEP, gapIn = 0.8 * STEP;
    const inked = items.reduce((t, v) => t + v.sh.width, 0);
    const gaps = items.reduce((t, v, k) => t + (k ? (v.startsSyl ? gapSyl : gapIn) : 0), 0);
    const room = (x1 - x0) / sc - 2 * lead;
    const stretch = gaps && room > inked + gaps ? (room - inked) / gaps : 1;
    let x = lead;
    items.forEach((v, k) => {
      if (k) x += (v.startsSyl ? gapSyl : gapIn) * stretch;
      if (!v.it.box) v.it.box = [x0 + x * sc, 0, v.sh.width * sc, 0];
      else x = (v.it.box[0] - x0) / sc;
      x += v.sh.width;
    });
    for (const v of items) fitBox(staff, v.it, v.sh);
    return todo.map(v => v.it);
  }

  // an item's box made to fit its notes, up and down, where its x is
  function fitBox(staff, it, sh) {
    sh = sh || itemShapes(it.g, false);
    const sc = scaleOf(staff.lines), cx = it.box[0] + it.box[2] / 2;
    const ps = sh.list.map(v => v.p).concat(sh.list.flatMap(v => v.notes.map(n => n.p)));
    if (!ps.length) return;
    const hi = Math.max(...ps), lo = Math.min(...ps);
    const top = yOf(staff.lines, cx, hi) - 1.3 * STEP * sc, bot = yOf(staff.lines, cx, lo) + 1.3 * STEP * sc;
    it.box = [it.box[0], top, sh.width * sc, bot - top].map(v => Math.round(v * 100) / 100);
  }

  // where a pitch (a staff position, a = 0) lies on a staff at x: the bottom line is d (3), the top j (9)
  function yOf(lines, x, p) {
    const b = S().yAt(lines[3], x), t = S().yAt(lines[0], x);
    return b + (t - b) * (p - 3) / 6;
  }

  // Everything to draw on a staff: each glyph with its character, its baseline on the page, its size (the font size
  // in page units) and the staff's slope there (degrees), with the item and syllable it belongs to; and each
  // syllable's text, centred under its first note.
  // a syllable's words as printed: GABC's markup taken out (<i>, <sp>V/</sp> as ℣, the braces of centring)
  const SP = { 'V/': '℣', 'R/': '℟', 'A/': '℣', '+': '†', "'ae": 'ǽ', "'oe": 'œ́', 'ae': 'æ', 'oe': 'œ', '*': '*' };
  const plain = t => String(t || '').replace(/<v>.*?<\/v>/g, '').replace(/<sp>(.*?)<\/sp>/g, (m, k) => SP[k] !== undefined ? SP[k] : k)
    .replace(/<\/?[a-z]+>/g, '').replace(/[{}]/g, '');

  function layout(staff) {
    const sc = scaleOf(staff.lines), size = 1000 * sc, out = { glyphs: [], texts: [], size };
    let firstClef = true, k = 0;
    staff.syllables.forEach((syl, si) => {
      let textAt = null;
      syl.items.forEach((it, ii) => {
        if (!it.box) return;
        const isClef = Ch().kind(it.g) === 'clef';
        const sh = itemShapes(it.g, isClef && firstClef && k === 0);
        if (isClef) firstClef = false;
        k++;
        for (const v of sh.list) {
          const x = it.box[0] + v.dx * sc, ym = yOf(staff.lines, x + v.w * sc / 2, v.p);
          const slope = (yOf(staff.lines, x + v.w * sc, v.p) - yOf(staff.lines, x, v.p)) / Math.max(1e-6, v.w * sc);
          const g = F().glyphs[v.name];
          out.glyphs.push({ name: v.name, ch: g ? String.fromCodePoint(g[0]) : '', p: v.p, x, y: ym + MIDDLE * sc, angle: Math.atan(slope) * 180 / Math.PI, syllable: si, item: ii, bar: !!v.bar, conf: it.conf, checked: it.checked });
          if (textAt === null && v.notes.length) textAt = x + Math.min(v.w, 166) * sc / 2;
        }
      });
      // a syllable with a box of its own is drawn there (its middle, on its bottom); else centred under its first note
      if (syl.text && syl.box) out.texts.push({ text: plain(syl.text), x: syl.box[0] + syl.box[2] / 2, y: syl.box[1] + syl.box[3], syllable: si, join: !!syl.join, checked: syl.checked });
      else if (syl.text && syl.items.some(it => it.box)) {
        const first = syl.items.find(it => it.box);
        out.texts.push({ text: plain(syl.text), x: textAt !== null ? textAt : first.box[0] + first.box[2] / 2, syllable: si, join: !!syl.join, checked: syl.checked });
      }
    });
    // the words' baseline two spaces below the bottom line, where it lies at each syllable, as in the printed books
    for (const t of out.texts) if (t.y === undefined) t.y = S().yAt(staff.lines[3], t.x) + 2 * S().spacing(staff.lines);
    out.textSize = S().spacing(staff.lines);
    return out;
  }

  // ---------------------------------------------------------------- a chant over several staves
  // A custos (GABC: a letter and +) for a note (a letter, under its clef), written under the clef of the staff the
  // custos ends; null if it can't be (no clef, or off the staff).
  function custosFor(letter, clef, hereClef) {
    const want = Ch().pitch(letter, clef);
    if (!want) return null;
    for (let p = 0; p <= 12; p++) {
      const q = Ch().pitch(String.fromCharCode(97 + p), hereClef);
      if (q && q.step === want.step && q.octave === want.octave) return String.fromCharCode(97 + p) + '+';
    }
    return null;
  }

  // A chant's syllables spread over several staves, as a printed chant runs on from line to line: broken only between
  // syllables, each staff taking a share in proportion to its length (less room for the clef and the custos it will
  // carry); every staff after the first begun with the clef in force, every one but the last ended with a custos
  // pointing to the next note, as printed. syllables: the chant's (one GABC line); linesList: each staff's lines, in
  // order. Returns each staff's syllables (copies, without boxes, to be placed).
  function spread(syllables, linesList, starts) {
    const n = linesList.length;
    const sum = a => a.reduce((t, v) => t + v, 0);
    if (starts) return dress(syllables, starts.concat(syllables.length).slice(0, n).map((a, k, all) => k < n - 1 ? syllables.slice(a, starts[k + 1]) : syllables.slice(a)));
    const ws = syllables.map(syl => syl.items.reduce((t, it, k) => t + itemShapes(it.g, false).width + (k ? 0.8 * STEP : 0), 0) + 2.2 * STEP);
    const caps = linesList.map((lines, k) => {
      const xs = S().xsOf(lines[0]);
      return Math.max(STEP, (xs[xs.length - 1] - xs[0]) / scaleOf(lines) - (k ? 2.5 * STEP : 0) - (k < n - 1 ? 1.6 * STEP : 0));
    });
    const r = sum(ws) / sum(caps), parts = [];
    let i = 0, acc = 0, room = 0;
    for (let k = 0; k < n; k++) {
      if (k === n - 1 || i >= syllables.length) { parts.push(syllables.slice(i)); i = syllables.length; continue; }
      room += caps[k];
      const target = r * room;
      // at least one syllable, and leave one for each staff still to come
      let j = i + 1, cum = acc + ws[i];
      while (j < syllables.length - (n - 1 - k) && Math.abs(cum + ws[j] - target) < Math.abs(cum - target)) cum += ws[j++];
      // a bar ends the line it follows, never begins the next
      const barOnly = syl => syl && !syl.text && syl.items.length && syl.items.every(it => Ch().kind(it.g) === 'bar');
      while (j < syllables.length - (n - 1 - k) && barOnly(syllables[j])) cum += ws[j++];
      parts.push(syllables.slice(i, j));
      i = j; acc = cum;
    }
    while (parts.length < n) parts.push([]);
    return dress(syllables, parts);
  }
  // each staff's syllables (copies, without boxes), each line after the first begun with the clef in force, each but
  // the last ended with a custos
  function dress(syllables, parts) {
    const n = parts.length;
    const out = parts.map(p => JSON.parse(JSON.stringify(p)).map(syl => {
      delete syl.box;
      syl.items.forEach(it => delete it.box);
      return syl;
    }));
    // the clef in force at each staff's end, and the first note after each
    const clefAt = [], firstNote = [];
    let clef = null;
    out.forEach((list, k) => {
      firstNote[k] = null;
      for (const syl of list) for (const it of syl.items) {
        const kind = Ch().kind(it.g);
        if (kind === 'clef') clef = it.g;
        else if (firstNote[k] === null && (kind === 'neume' || kind === 'accidental')) {
          const nn = Ch().notes(it.g).find(x => !x.acc);
          if (nn) firstNote[k] = { p: nn.p, clef };
        }
      }
      clefAt[k] = clef;
    });
    out.forEach((list, k) => {
      if (k && clefAt[k - 1] && !(list[0] && list[0].items[0] && Ch().kind(list[0].items[0].g) === 'clef')) {
        list.unshift({ text: '', items: [{ g: clefAt[k - 1] }] });
        if (firstNote[k] && firstNote[k].clef === null) firstNote[k].clef = clefAt[k - 1];
      }
      // the custos: the next staff's first note, written under this staff's clef
      const next = firstNote[k + 1], c = k < n - 1 && next && clefAt[k] ? custosFor(next.p, next.clef || clefAt[k], clefAt[k]) : null;
      if (c) list.push({ text: '', items: [{ g: c }] });
    });
    return out;
  }

  // Where a chant's lines break, read from what its staves carry on the page (S.carries): seen: for each staff, its
  // ink's mass (a measure of its notes) and its custos (a staff position, or null). Each syllable weighs its notes (a
  // bar, an accidental and a clef change less); the masses are scaled to the chant's whole weight; the breaks are
  // those whose lines weigh most nearly what their staves carry, a custos agreeing with the next line's first note,
  // no line begun by a bar. Returns the syllable each line starts at (the first at 0), or null if it can't say.
  function breaks(syllables, seen) {
    const n = syllables.length, S_ = seen.length;
    if (S_ < 2 || n < S_ || seen.some(v => !v || !(v.mass >= 0))) return S_ === 1 ? [0] : null;
    let clef = null, first = true;
    const w = [], letters = [], firstP = [], clefBefore = [], barOnly = [];
    syllables.forEach((syl, i) => {
      letters.push(plain(syl.text).replace(/[\s*†℣℟.,;:!?]/g, '').length);
      clefBefore[i] = clef;
      let t = 0, fp = null;
      for (const it of syl.items) {
        const kind = Ch().kind(it.g);
        if (kind === 'clef') { if (!first) t += 1.5; clef = it.g; }
        else if (kind === 'bar') t += /::/.test(it.g) ? 1.2 : 0.6;
        else if (kind === 'accidental') t += 0.5;
        else if (kind === 'neume') {
          const ns = Ch().notes(it.g).filter(x => !x.acc);
          t += ns.length;
          if (fp === null && ns.length) fp = { p: ns[0].p, clef };
        }
        if (kind !== 'clef') first = false;
      }
      w.push(t); firstP.push(fp);
      barOnly.push(!syl.text && syl.items.length > 0 && syl.items.every(it => Ch().kind(it.g) === 'bar'));
    });
    const pre = [0], preL = [0];
    for (const v of w) pre.push(pre[pre.length - 1] + v);
    for (const v of letters) preL.push(preL[preL.length - 1] + v);
    const total = pre[n], mass = seen.reduce((t, v) => t + v.mass, 0);
    if (!(total > 0 && mass > 0)) return null;
    const expect = seen.map(v => v.mass * total / mass);
    // the words, if they were read: letters against their ink
    const totalL = preL[n], ink = seen.reduce((t, v) => t + (v.words || 0), 0), useWords = totalL > 0 && ink > 0 && seen.every(v => v.words >= 0);
    const expectL = seen.map(v => useWords ? v.words * totalL / ink : 0);
    // the first note at or after syllable i, under the clef in force
    const nextNote = [];
    for (let i = n - 1; i >= 0; i--) nextNote[i] = firstP[i] ? Object.assign({}, firstP[i], { clef: firstP[i].clef || clefBefore[i] }) : nextNote[i + 1] || null;
    const custosMiss = (k, i) => {
      const c = seen[k].custos, nn = nextNote[i];
      if (c === null || c === undefined || !nn || !nn.clef) return 0;
      const here = clefBefore[i] || nn.clef, g = custosFor(nn.p, nn.clef, here);
      return g && g.charCodeAt(0) - 97 === c ? -1 : 8;
    };
    const cost = (k, a, b) => {
      const d = pre[b] - pre[a] - expect[k], e = preL[b] - preL[a] - expectL[k];
      return d * d / ((0.2 * expect[k]) ** 2 + 1) + (useWords ? e * e / ((0.08 * expectL[k]) ** 2 + 1) : 0);
    };
    // dp[k][i]: the best for staves 0..k-1 over syllables 0..i-1
    const dp = Array.from({ length: S_ + 1 }, () => new Float64Array(n + 1).fill(Infinity)), from = Array.from({ length: S_ + 1 }, () => new Int32Array(n + 1));
    dp[0][0] = 0;
    for (let k = 1; k <= S_; k++) {
      for (let i = k; i <= n - (S_ - k); i++) {
        if (k < S_ && (i >= n || barOnly[i])) continue;
        for (let a = k - 1; a < i; a++) {
          if (dp[k - 1][a] === Infinity) continue;
          const c = dp[k - 1][a] + cost(k - 1, a, i) + (k < S_ ? custosMiss(k - 1, i) : 0);
          if (c < dp[k][i]) { dp[k][i] = c; from[k][i] = a; }
        }
      }
    }
    if (dp[S_][n] === Infinity) return null;
    const starts = [];
    for (let k = S_, i = n; k > 0; k--) { i = from[k][i]; starts.unshift(i); }
    return starts;
  }

  // A chant's syllables gathered back from its staves (as spread() left them): the custos taken off each line's end,
  // and the clef that begins a line after the first, if it is only the clef in force repeated.
  function gather(staves) {
    const out = [];
    let clef = null;
    staves.forEach((syls, k) => {
      syls.forEach((syl, i) => {
        const items = syl.items.filter(it => Ch().kind(it.g) !== 'custos');
        if (k && i === 0 && !syl.text && items.length === 1 && Ch().kind(items[0].g) === 'clef' && items[0].g === clef) return;
        for (const it of items) if (Ch().kind(it.g) === 'clef') clef = it.g;
        if (items.length || syl.text) out.push(Object.assign({}, syl, { items }));
      });
    });
    return out;
  }

  const api = { plain, parse, glyphs, noteName, multiName, shapes, itemShapes, place, fitBox, yOf, layout, scaleOf, spread, breaks, gather, custosFor, STEP, MIDDLE };
  global.CGNeumes = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
