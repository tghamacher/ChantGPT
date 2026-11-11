// Mensural notation (white notation, 15th-17th century polyphony): what a mensural staff holds, how it is written as
// text, its pitches, what is wrong with it, how it is drawn on the page, and MEI.
//
// A mensural staff (notation "mensural", CGChant.notationOf) keeps its contents in staff.mensural: a list of items,
// in order along the staff. Each has k, its kind, and x, where it stands on the page (page units; optional: an item
// without one is set after the one before):
//   { k: 'clef', shape: 'C' | 'F' | 'G', line }          line counted from the bottom (1-5)
//   { k: 'sign', sign: 'O' | 'C' | 'R', dot, stroke }     a mensuration sign (R: the C turned round); dot, stroke: true
//   { k: 'num', text }                                     a proportion's figures (3, 3/2)
//   { k: 'note', v, p, color }                             v: Mx L B Sb M Sm F Sf; p: the staff position
//   { k: 'rest', v, p }                                    (a longa rest: perfect, with perf: true)
//   { k: 'lig', notes: [{ v, p, obl }], color }            a ligature; obl: this note and the next drawn as one oblique
//   { k: 'dot', p }                                        a dot (of addition, or of division)
//   { k: 'acc', a: 'b' | 'n' | '#', p }                    an accidental
//   { k: 'custos', p }
//   { k: 'bar', form: 'single' | 'double' | 'end' }
// A staff position p counts steps up from the bottom line (0), line by line and space by space: on five lines the
// top line is 8, the space above it 9, the space below the bottom line -1. color: 'black' for a note blackened in
// white notation (coloration), absent for white.
//
// The text form (as GABC is chant's): items one after another, spaces between them:
//   C4 F3 G2           clefs, the line from the bottom      O C O. C| O.| R     signs        3  3/2   proportions
//   B5 Sb6 M5 Sm4 L2 Mx1 F3 Sf3   notes, value and position (B-1: below the bottom line)   B5* a black (coloured) note
//   rB4 rL3 rLp3       rests (rLp: a perfect longa rest)
//   [B5 L2]  [Sb6 Sb5 B3]  [B5~B3 L1]*   a ligature: its notes; ~ joins two into an oblique; * blackens it all
//   .5  b6  n6  #6  +5  |  ||  |||       a dot, flat, natural, sharp, custos, bars
// Used for tests, for typing a staff in, and for the recognizer's labels.
(function (global) {
  'use strict';
  const VALUES = ['Mx', 'L', 'B', 'Sb', 'M', 'Sm', 'F', 'Sf'];
  const MEI_DUR = { Mx: 'maxima', L: 'longa', B: 'brevis', Sb: 'semibrevis', M: 'minima', Sm: 'semiminima', F: 'fusa', Sf: 'semifusa' };
  const S = () => global.CGStaves;

  // ---------------------------------------------------------------- the text form
  const VAL = '(Mx|Sb|Sm|Sf|L|B|M|F)';
  const NOTE = new RegExp(`^${VAL}(-?\\d+)$`);
  function parse(text) {
    const out = [], bad = [];
    const toks = String(text).replace(/\[/g, ' [ ').replace(/\](\*?)/g, ' ]$1 ').trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      let m;
      if (t === '[') {
        const notes = [];
        let j = i + 1;
        for (; j < toks.length && !/^\]/.test(toks[j]); j++) {
          const parts = toks[j].split('~');
          parts.forEach((q, k) => {
            const n = NOTE.exec(q);
            if (!n) { bad.push(`"${q}" in a ligature is not a note (B5, L2, Sb6 …)`); return; }
            notes.push(Object.assign({ v: n[1], p: +n[2] }, k < parts.length - 1 ? { obl: true } : {}));
          });
        }
        if (j >= toks.length) { bad.push('A ligature "[" is not closed by "]"'); break; }
        if (notes.length < 2) bad.push('A ligature has two notes or more');
        out.push(Object.assign({ k: 'lig', notes }, toks[j] === ']*' ? { color: 'black' } : {}));
        i = j;
      }
      else if ((m = /^([CFG])([1-5])$/.exec(t))) out.push({ k: 'clef', shape: m[1], line: +m[2] });
      else if ((m = /^([OCR])(\.?)(\|?)$/.exec(t))) out.push(Object.assign({ k: 'sign', sign: m[1] }, m[2] ? { dot: true } : {}, m[3] ? { stroke: true } : {}));
      else if (/^\d+(\/\d+)?$/.test(t)) out.push({ k: 'num', text: t });
      else if ((m = new RegExp(`^${VAL}(-?\\d+)(\\*?)$`).exec(t))) out.push(Object.assign({ k: 'note', v: m[1], p: +m[2] }, m[3] ? { color: 'black' } : {}));
      else if ((m = new RegExp(`^r${VAL}(p?)(-?\\d+)$`).exec(t))) out.push(Object.assign({ k: 'rest', v: m[1], p: +m[3] }, m[2] ? { perf: true } : {}));
      else if ((m = /^\.(-?\d+)$/.exec(t))) out.push({ k: 'dot', p: +m[1] });
      else if ((m = /^([bn#])(-?\d+)$/.exec(t))) out.push({ k: 'acc', a: m[1], p: +m[2] });
      else if ((m = /^\+(-?\d+)$/.exec(t))) out.push({ k: 'custos', p: +m[1] });
      else if (/^\|{1,3}$/.test(t)) out.push({ k: 'bar', form: ['single', 'double', 'end'][t.length - 1] });
      else bad.push(`"${t}" is not mensural notation`);
    }
    if (bad.length) throw new Error(bad.join('; ') + '.');
    return out;
  }
  function text(items) {
    return items.map(it => {
      switch (it.k) {
        case 'clef': return it.shape + it.line;
        case 'sign': return it.sign + (it.dot ? '.' : '') + (it.stroke ? '|' : '');
        case 'num': return it.text;
        case 'note': return it.v + it.p + (it.color === 'black' ? '*' : '');
        case 'rest': return 'r' + it.v + (it.perf ? 'p' : '') + it.p;
        case 'lig': return '[' + it.notes.map((n, i) => n.v + n.p + (n.obl && i < it.notes.length - 1 ? '~' : ' ')).join('').trim() + ']' + (it.color === 'black' ? '*' : '');
        case 'dot': return '.' + it.p;
        case 'acc': return it.a + it.p;
        case 'custos': return '+' + it.p;
        case 'bar': return '|'.repeat({ single: 1, double: 2, end: 3 }[it.form] || 1);
        default: return '?';
      }
    }).join(' ');
  }

  // ---------------------------------------------------------------- pitch
  // A staff position as a pitch under a clef: { pname, oct } (middle C is c4). C on its line is c4, F f3, G g4.
  const STEPS = 'cdefgab';
  function pitch(p, clef) {
    if (!clef) return null;
    const at = 2 * (clef.line - 1), base = { C: 4 * 7, F: 3 * 7 + 3, G: 4 * 7 + 4 }[clef.shape];
    if (base === undefined) return null;
    const d = base + (p - at);
    return { pname: STEPS[((d % 7) + 7) % 7], oct: Math.floor(d / 7) };
  }

  // ---------------------------------------------------------------- ligatures
  // How a ligature is written, from its notes' values: the rules of white notation (as Tinctoris and the theorists
  // after him give them) read backwards. For each note, which stems it takes; and what can't be written.
  //   The first note: a breve has propriety (descending: a stem down on its left; ascending: none); a longa has none
  //     (descending: no stem; ascending: a stem down on its right); two semibreves begin with a stem up on the left
  //     (opposite propriety).
  //   The last note: a longa has perfection (descending: written square; ascending: a stem down on its right); a breve
  //     has none (descending: written oblique; ascending: square, no stem).
  //   Between: breves; a maxima, twice as long, anywhere.
  function ligRules(notes) {
    const n = notes.length, stems = notes.map(() => []), bad = [];
    if (n < 2) return { stems, bad: ['A ligature has two notes or more.'] };
    const up = i => notes[i + 1].p > notes[i].p;              // (from note i to the next, rising)
    notes.forEach((nt, i) => { if (!['Mx', 'L', 'B', 'Sb'].includes(nt.v)) bad.push(`A ${MEI_DUR[nt.v] || nt.v} can't be in a ligature.`); });
    notes.forEach((nt, i) => { if (nt.obl && i + 1 < n && notes[i + 1].p === nt.p) bad.push('An oblique joins two notes of different pitch.'); });
    const f = notes[0];
    if (f.v === 'Sb') {
      stems[0].push('upLeft');
      if (notes[1].v !== 'Sb') bad.push('A ligature that begins with a semibreve has two (cum opposita proprietate).');
    } else if (f.v === 'B') { if (!up(0)) stems[0].push('downLeft'); }
    else if (f.v === 'L') { if (up(0)) stems[0].push('downRight'); }
    const l = notes[n - 1], k = n - 2, desc = notes[n - 1].p < notes[n - 2].p;
    if (!(n === 2 && f.v === 'Sb')) {
      if (l.v === 'L') {
        if (desc && notes[k].obl) bad.push('A descending last longa is written square, not oblique.');
        if (!desc) stems[n - 1].push('downRight');
      } else if (l.v === 'B') {
        if (desc && !notes[k].obl) bad.push('A descending last breve is written oblique (join it to the note before with ~).');
        if (!desc && notes[k].obl) bad.push('An ascending last breve is written square, not oblique.');
      } else if (l.v === 'Sb') bad.push('Only a ligature\'s first two notes can be semibreves.');
    }
    for (let i = 1; i < n - 1; i++) {
      if (notes[i].v === 'Sb' && !(i === 1 && f.v === 'Sb')) bad.push('Only a ligature\'s first two notes can be semibreves.');
      if (notes[i].v === 'L') stems[i].push('downRight');     // (a longa within: rare, marked with a stem)
    }
    return { stems, bad };
  }

  // ---------------------------------------------------------------- what's wrong
  // The problems of a staff's items, in plain sentences (empty when it is right).
  function check(items) {
    const bad = [];
    if (!Array.isArray(items)) return ['A mensural staff\'s contents are a list of items.'];
    const pos = v => Number.isInteger(v) && v > -12 && v < 20;
    items.forEach((it, i) => {
      const at = `Item ${i + 1}`;
      if (it.x !== undefined && !Number.isFinite(it.x)) bad.push(`${at}: its x is not a number.`);
      switch (it.k) {
        case 'clef': if (!['C', 'F', 'G'].includes(it.shape) || !(it.line >= 1 && it.line <= 5)) bad.push(`${at}: a clef is C, F or G on a line from 1 to 5.`); break;
        case 'sign': if (!['O', 'C', 'R'].includes(it.sign)) bad.push(`${at}: a mensuration sign is O, C or R (the C turned round).`); break;
        case 'num': if (!/^\d+(\/\d+)?$/.test(it.text || '')) bad.push(`${at}: a proportion is figures (3, 3/2).`); break;
        case 'note': case 'rest':
          if (!VALUES.includes(it.v)) bad.push(`${at}: its value is one of ${VALUES.join(', ')}.`);
          if (!pos(it.p)) bad.push(`${at}: its position is a whole number of steps from the bottom line.`);
          break;
        case 'lig':
          if (!Array.isArray(it.notes)) { bad.push(`${at}: a ligature has notes.`); break; }
          if (it.notes.some(n => !pos(n.p))) bad.push(`${at}: a ligature's notes have positions.`);
          bad.push(...ligRules(it.notes).bad.map(b => `${at}: ${b}`));
          break;
        case 'dot': case 'custos': if (!pos(it.p)) bad.push(`${at}: it needs a position.`); break;
        case 'acc': if (!['b', 'n', '#'].includes(it.a) || !pos(it.p)) bad.push(`${at}: an accidental is b, n or # at a position.`); break;
        case 'bar': if (!['single', 'double', 'end'].includes(it.form)) bad.push(`${at}: a bar is single, double or end.`); break;
        default: bad.push(`${at}: "${it.k}" is not a kind of mensural item.`);
      }
    });
    return bad;
  }

  // ---------------------------------------------------------------- drawing
  // Serenissima (Elam Rotem's early-music font, SMuFL) for the single signs: a glyph's origin is at its left, on the
  // staff position it stands for; one em is four spaces. Ligatures, mensuration signs and dots are drawn as shapes:
  // the font has no ligatures, and these must fit any interval and any length.
  const G = {
    white: { Mx: '', L: '', B: '', Sb: '', M: '', Sm: '', F: '', Sf: '' },
    black: { Mx: '', L: '', B: '', Sb: '', M: '', Sm: '', F: '', Sf: '' },
    rest: { Mx: '', L: '', Lp: '', B: '', Sb: '', M: '', Sm: '', F: '', Sf: '' },
    clef: { C: '', F: '', G: '' },
    acc: { b: '', n: '', '#': '' },
    custos: '',
  };
  // how wide each item is, in spaces (to set out items without an x, and to box them)
  const WIDTH = { clef: 1.6, sign: 2.2, num: 1.4, note: 1.4, rest: 1.2, dot: 0.6, acc: 1.0, custos: 1.0, bar: 0.8 };
  const BLOCK = 1.25, OBL = 2.4, HIGH = 0.95, STEM = 2.6, PEN = 0.13;   // (a ligature's note: width, height; an oblique's run; in spaces)
  const ligWidth = notes => notes.reduce((w, n, i) => w + (i > 0 && notes[i - 1].obl ? OBL - BLOCK : 0) + (n.v === 'Mx' ? 2 * BLOCK : BLOCK), 0);
  const widthOf = it => it.k === 'lig' ? ligWidth(it.notes) + 0.6 : WIDTH[it.k] || 1;

  // A staff's geometry: the y of a staff position at x, the spacing.
  function geometry(lines) {
    const top = lines[0], bot = lines[lines.length - 1], steps = 2 * (lines.length - 1);
    return { y: (p, x) => { const b = S().yAt(bot, x), t = S().yAt(top, x); return b + (t - b) * p / steps; }, s: S().spacing(lines), left: top[0], right: top[top.length - 2] };
  }

  // Everything to draw for a staff: { glyphs: [{ ch, x, y, size, item }], shapes: [{ d, fill, item }], boxes } in page
  // units. shapes are SVG path data: filled (fill true) or stroked (a line PEN spaces wide). boxes: each item's
  // [x, y, w, h], to grab it by.
  function layout(staff) {
    const items = staff.mensural || [], g = geometry(staff.lines), s = g.s, size = 4 * s;
    const out = { glyphs: [], shapes: [], boxes: [], size, pen: PEN * s };
    let x = g.left + 0.8 * s;
    items.forEach((it, i) => {
      const x0 = Number.isFinite(it.x) ? it.x : x, w = widthOf(it) * s;
      x = x0 + w + 0.5 * s;
      const glyph = (ch, p) => out.glyphs.push({ ch, x: x0, y: g.y(p, x0), size, item: i });
      const shape = (d, fill) => out.shapes.push({ d, fill, item: i });
      const box = (pLo, pHi) => out.boxes.push([x0, g.y(pHi, x0), w, g.y(pLo, x0) - g.y(pHi, x0)]);
      switch (it.k) {
        case 'clef': glyph(G.clef[it.shape] || '?', 2 * (it.line - 1)); box(2 * (it.line - 1) - 3, 2 * (it.line - 1) + 3); break;
        case 'note': glyph((it.color === 'black' ? G.black : G.white)[it.v] || '?', it.p); box(it.p - (it.v === 'L' || it.v === 'Mx' ? 6 : 1.5), it.p + (/^(M|Sm|F|Sf)$/.test(it.v) ? 6 : 1.5)); break;
        case 'rest': glyph(G.rest[it.v === 'L' && it.perf ? 'Lp' : it.v] || '?', it.p); box(it.p - 3, it.p + 3); break;
        case 'acc': glyph(G.acc[it.a] || '?', it.p); box(it.p - 2, it.p + 3); break;
        case 'custos': glyph(G.custos, it.p); box(it.p - 2, it.p + 3); break;
        case 'num': out.glyphs.push({ ch: it.text, x: x0, y: g.y(4, x0) + 0.5 * s, size: 1.6 * s, item: i, text: true }); box(2, 6); break;
        case 'dot': { const r = 0.22 * s, cy = g.y(it.p, x0); shape(circle(x0 + 0.3 * s, cy, r), true); box(it.p - 1, it.p + 1); break; }
        case 'bar': {
          const n = { single: 1, double: 2, end: 3 }[it.form] || 1;
          for (let k = 0; k < n; k++) { const bx = x0 + k * 0.3 * s; shape(`M${f(bx)} ${f(g.y(8, bx))}L${f(bx)} ${f(g.y(0, bx))}`, false); }
          box(0, 8); break;
        }
        case 'sign': {
          // a circle (O) or most of one (C, R) on the middle line, a space and a half across; a dot in it, a stroke through
          const cx = x0 + 0.9 * s, cy = g.y(4, cx), r = 0.75 * s;
          if (it.sign === 'O') shape(circle(cx, cy, r), false);
          else { const c = it.sign === 'C' ? 0 : Math.PI, open = 0.75; shape(arc(cx, cy, r, c + open, c + 2 * Math.PI - open), false); }   // (the gap to the right, or for R to the left)
          if (it.dot) shape(circle(cx, cy, 0.16 * s), true);
          if (it.stroke) shape(`M${f(cx)} ${f(cy - 1.4 * r)}L${f(cx)} ${f(cy + 1.4 * r)}`, false);
          box(1, 7); break;
        }
        case 'lig': ligature(it, x0, g, s, shape); box(Math.min(...it.notes.map(n => n.p)) - 6, Math.max(...it.notes.map(n => n.p)) + 3); break;
      }
    });
    return out;
  }
  const f = v => Math.round(v * 100) / 100;
  const circle = (cx, cy, r) => `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
  function arc(cx, cy, r, a0, a1) {
    // (angles from the right, anticlockwise on the page: the C opens to the right)
    const p = a => [cx + r * Math.cos(a), cy - r * Math.sin(a)], [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${f(x0)} ${f(y0)}A${f(r)} ${f(r)} 0 1 ${a1 > a0 ? 0 : 1} ${f(x1)} ${f(y1)}`;
  }
  // A ligature's shapes: each note a block at its pitch (a maxima twice as wide), blocks joined edge to edge by a
  // stroke from one pitch to the next; an oblique, one slanting block from one note to the next; its stems by the
  // rules (ligRules). White notes are outlined; black (coloured) ones filled.
  function ligature(it, x0, g, s, shape) {
    const notes = it.notes, black = it.color === 'black', h = HIGH * s / 2, { stems } = ligRules(notes);
    const cells = [];                                          // each note's [left, right] along the staff
    let x = x0;
    for (let i = 0; i < notes.length; i++) {
      if (i > 0 && notes[i - 1].obl) { cells.push([cells[i - 1][0] + (OBL - BLOCK) * s, cells[i - 1][0] + OBL * s]); x = cells[i][1]; continue; }
      const w = (notes[i].v === 'Mx' ? 2 * BLOCK : BLOCK) * s;
      cells.push([x, x + w]); x += w;
    }
    const y = (i, xx) => g.y(notes[i].p, xx);
    for (let i = 0; i < notes.length; i++) {
      if (i > 0 && notes[i - 1].obl) continue;               // (drawn with the note before, as one)
      if (notes[i].obl && i + 1 < notes.length) {
        const a = cells[i][0], b = cells[i + 1][1];
        shape(`M${f(a)} ${f(y(i, a) - h)}L${f(b)} ${f(y(i + 1, b) - h)}L${f(b)} ${f(y(i + 1, b) + h)}L${f(a)} ${f(y(i, a) + h)}Z`, black ? true : 'outline');
      } else {
        const [a, b] = cells[i];
        shape(`M${f(a)} ${f(y(i, a) - h)}L${f(b)} ${f(y(i, b) - h)}L${f(b)} ${f(y(i, b) + h)}L${f(a)} ${f(y(i, a) + h)}Z`, black ? true : 'outline');
      }
    }
    // the strokes between square neighbours at different pitches, where one ends and the next begins
    for (let i = 0; i + 1 < notes.length; i++) {
      if (notes[i].obl || notes[i].p === notes[i + 1].p) continue;
      const xj = cells[i][1];
      shape(`M${f(xj)} ${f(y(i, xj))}L${f(xj)} ${f(y(i + 1, xj))}`, false);
    }
    stems.forEach((list, i) => list.forEach(kind => {
      const [a, b] = cells[i], xs = /Left/.test(kind) ? a : b, yy = y(i, xs), dy = (/^up/.test(kind) ? -1 : 1) * STEM * s;
      shape(`M${f(xs)} ${f(yy)}L${f(xs)} ${f(yy + dy)}`, false);
    }));
  }

  // ---------------------------------------------------------------- MEI
  // A document's mensural staves as MEI (mensural, white notation): its staves one after another in one voice, a
  // system break between them, each with its facsimile zone. Pitches from the clef in force.
  function mei(doc, opts = {}) {
    const C = global.CGChant, esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const list = [];
    (doc.pages || []).forEach((pg, pi) => (pg.staves || []).forEach(st => { if (C.notationOf(doc, st) === 'mensural') list.push({ st, pi }); }));
    const surfaces = new Map(), body = [];
    let clef = null, n = 0;
    const id = () => `m${++n}`;
    const at = (p, attrs = '') => { const q = pitch(p, clef); return q ? ` pname="${q.pname}" oct="${q.oct}"${attrs}` : ` loc="${p}"${attrs}`; };
    list.forEach(({ st, pi }) => {
      // (each staff begins with a system break, naming its zone on the page, where it has a box)
      let facs = '';
      if (st.box) {
        const z = `z-${st.id}`;
        if (!surfaces.has(pi)) surfaces.set(pi, []);
        surfaces.get(pi).push(`<zone xml:id="${esc(z)}" ulx="${Math.round(st.box[0])}" uly="${Math.round(st.box[1])}" lrx="${Math.round(st.box[0] + st.box[2])}" lry="${Math.round(st.box[1] + st.box[3])}"/>`);
        facs = ` facs="#${esc(z)}"`;
      }
      body.push(`<sb${facs}/>`);
      for (const it of st.mensural || []) {
        switch (it.k) {
          case 'clef': clef = it; body.push(`<clef xml:id="${id()}" shape="${it.shape}" line="${it.line}"/>`); break;
          case 'sign': body.push(`<mensur xml:id="${id()}" sign="${it.sign === 'R' ? 'C' : it.sign}"${it.sign === 'R' ? ' orient="reversed"' : ''}${it.dot ? ' dot="true"' : ''}${it.stroke ? ' slash="1"' : ''}/>`); break;
          case 'num': { const [a, b] = it.text.split('/'); body.push(`<proport xml:id="${id()}" num="${a}"${b ? ` numbase="${b}"` : ''}/>`); break; }
          case 'note': body.push(`<note xml:id="${id()}" dur="${MEI_DUR[it.v]}"${at(it.p)}${it.color === 'black' ? ' colored="true"' : ''}/>`); break;
          case 'rest': body.push(`<rest xml:id="${id()}" dur="${MEI_DUR[it.v]}" loc="${it.p}"${it.v === 'L' ? ` num="${it.perf ? 3 : 2}"` : ''}/>`); break;
          case 'lig': {
            const lid = id();
            const notes = it.notes.map((nt, i) => `<note xml:id="${id()}" dur="${MEI_DUR[nt.v]}"${at(nt.p)}${nt.obl || (i > 0 && it.notes[i - 1].obl) ? ' lig="obliqua"' : ''}${it.color === 'black' ? ' colored="true"' : ''}/>`);
            body.push(`<ligature xml:id="${lid}" form="${it.notes.every(nt => !nt.obl) ? 'recta' : 'obliqua'}">${notes.join('')}</ligature>`);
            break;
          }
          case 'dot': body.push(`<dot xml:id="${id()}" loc="${it.p}"/>`); break;
          case 'acc': body.push(`<accid xml:id="${id()}" accid="${{ b: 'f', n: 'n', '#': 's' }[it.a]}" loc="${it.p}"/>`); break;
          case 'custos': body.push(`<custos xml:id="${id()}"${at(it.p)}/>`); break;
          case 'bar': body.push(`<barLine xml:id="${id()}"${it.form === 'double' ? ' form="dbl"' : it.form === 'end' ? ' form="end"' : ''}/>`); break;
        }
      }
    });
    const title = esc(opts.title || (doc.source && doc.source.name) || 'ChantGPT');
    return `<?xml version="1.0" encoding="UTF-8"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.0">
<meiHead><fileDesc><titleStmt><title>${title}</title></titleStmt><pubStmt><p>Made with ChantGPT</p></pubStmt></fileDesc></meiHead>
<music>${surfaces.size ? `<facsimile>${[...surfaces].map(([pi, zs]) => `<surface n="${pi + 1}">${zs.join('')}</surface>`).join('')}</facsimile>` : ''}<body><mdiv><parts><part>
<scoreDef><staffGrp><staffDef n="1" lines="5" notationtype="mensural.white"/></staffGrp></scoreDef>
<section><staff n="1"><layer n="1">
${body.join('\n')}
</layer></staff></section>
</part></parts></mdiv></body></music>
</mei>
`;
  }

  global.CGMensural = { VALUES, parse, text, pitch, ligRules, check, layout, geometry, mei, GLYPHS: G };
})(typeof window !== 'undefined' ? window : globalThis);
