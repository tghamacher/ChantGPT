// Mensural notation (white notation, 15th-17th century polyphony): what a mensural staff holds, how it is written as
// text, its pitches, what is wrong with it, how it is drawn on the page, and MEI.
//
// A mensural staff (notation "mensural", CGChant.notationOf) keeps its contents in staff.mensural: a list of items,
// in order along the staff. Each has k, its kind, and x, where it stands on the page (page units; optional: an item
// without one is set after the one before):
//   { k: 'clef', shape: 'C' | 'F' | 'G', line }          line counted from the bottom (1-5)
//   { k: 'sign', sign: 'O' | 'C' | 'R', dot, stroke }     a mensuration sign (R: the C turned round); dot, stroke: true
//   { k: 'num', text }                                     a proportion's figures (3, 3/2)
//   { k: 'note', v, p, color, stem }                       v: Mx L B Sb M Sm F Sf; p: the staff position; stem: 'up' | 'down'
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
//   c4 f3 g2           clefs, the line from the bottom (lower case, as in GABC: F is the fusa)   O C O. C| O.| R   signs   3  3/2   proportions
//   B5 Sb6 M5 Sm4 L2 Mx1 F3 Sf3   notes, value and position (B-1: below the bottom line)   B5* a black (coloured) note
//   M5v L2^            a stem turned down, or up (minims and smaller go up, longae and maximae down, unless said)
//   rB4 rL3 rLp3       rests (rLp: a perfect longa rest)
//   [B5 L2]  [Sb6 Sb5 B7]  [L5 B3~B1]*   a ligature: its notes; ~ joins two into an oblique; * blackens it all
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
      else if ((m = /^([cfg])([1-5])$/.exec(t))) out.push({ k: 'clef', shape: m[1].toUpperCase(), line: +m[2] });
      else if ((m = /^([OCR])(\.?)(\|?)$/.exec(t))) out.push(Object.assign({ k: 'sign', sign: m[1] }, m[2] ? { dot: true } : {}, m[3] ? { stroke: true } : {}));
      else if (/^\d+(\/\d+)?$/.test(t)) out.push({ k: 'num', text: t });
      else if ((m = new RegExp(`^${VAL}(-?\\d+)([v^]?)(\\*?)$`).exec(t))) out.push(Object.assign({ k: 'note', v: m[1], p: +m[2] }, m[3] ? { stem: m[3] === 'v' ? 'down' : 'up' } : {}, m[4] ? { color: 'black' } : {}));
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
        case 'clef': return it.shape.toLowerCase() + it.line;
        case 'sign': return it.sign + (it.dot ? '.' : '') + (it.stroke ? '|' : '');
        case 'num': return it.text;
        case 'note': return it.v + it.p + (it.stem ? (it.stem === 'down' ? 'v' : '^') : '') + (it.color === 'black' ? '*' : '');
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
  // The single signs are Elam Rotem's EMS_Serenissima, as js/serenissima.js keeps them (CGSerenissima: each an outline in
  // staff spaces, its origin at its left on the staff position it stands for, its staff lines taken out). Ligatures,
  // bars, and what the font lacks (a natural, a turned C, black maximae) are drawn as shapes: the font has no
  // ligatures, and these must fit any interval and any length.
  const SIGN = () => global.CGSerenissima || {};
  const HAS_STEM = { Mx: 'down', L: 'down', M: 'up', Sm: 'up', F: 'up', Sf: 'up' };   // (which way a stem goes, unless said)
  // a note's sign, by its value, colour and stem: { key, p } (a black note the font hasn't: the next shorter white
  // one, which is how a blackened minim and its like look; or null, drawn as a shape)
  function noteSign(it) {
    const black = it.color === 'black', stem = it.stem || HAS_STEM[it.v];
    if (black) {
      if (it.v === 'Mx') return null;
      const k = { L: 'kL', B: 'kB', Sb: 'kSb', M: 'Sm', Sm: 'F', F: 'Sf', Sf: 'Sf' }[it.v];
      return /^(kL|Sm|F|Sf)$/.test(k) ? k + '.' + (stem || 'up') : k;
    }
    return stem ? `${it.v}.${stem}` : it.v;
  }
  const REST = { Mx: 'rL', L: 'rL', B: 'rB', Sb: 'rSb', M: 'rM', Sm: 'rSm', F: 'rF', Sf: 'rF' };
  // how wide each item is, in spaces (to set out items without an x, and to box them)
  const WIDTH = { clef: 1.7, sign: 1.8, num: 1.4, note: 1.6, rest: 1.2, dot: 0.7, acc: 1.3, custos: 1.8, bar: 0.8 };
  const BLOCK = 1.07, OBL = 2.1, HIGH = 0.9, STEM = 3.0, PEN = 0.13;   // (a ligature's note: width, height (Serenissima's breve); an oblique's run; in spaces)
  const ligWidth = notes => notes.reduce((w, n, i) => w + (i > 0 && notes[i - 1].obl ? OBL - BLOCK : 0) + (n.v === 'Mx' ? 2 * BLOCK : BLOCK), 0);
  const widthOf = it => it.k === 'lig' ? ligWidth(it.notes) + 0.9 : it.k === 'rest' && it.v === 'Mx' ? 1.6 : WIDTH[it.k] || 1;

  // A staff's geometry: the y of a staff position at x, the spacing.
  function geometry(lines) {
    const top = lines[0], bot = lines[lines.length - 1], steps = 2 * (lines.length - 1);
    return { y: (p, x) => { const b = S().yAt(bot, x), t = S().yAt(top, x); return b + (t - b) * p / steps; }, s: S().spacing(lines), left: top[0], right: top[top.length - 2] };
  }

  // Everything to draw for a staff, in page units: { signs: [{ key, d, x, y, scale, flip, item }] (Serenissima's,
  // drawn as path d at x, y, scaled to the staff's spacing, flipped left to right if flip), shapes: [{ d, fill, item }]
  // (filled when fill is true, outlined when 'outline', else a line pen wide), texts: [{ text, x, y, size, item }],
  // boxes: each item's [x, y, w, h], to grab it by; cells: for each ligature (by its index), each note's [left,
  // right] along the staff; angle: the staff's tilt (degrees), for the signs and texts.
  function layout(staff) {
    const items = staff.mensural || [], g = geometry(staff.lines), s = g.s, T = SIGN();
    const out = { signs: [], shapes: [], texts: [], boxes: [], cells: {}, pen: PEN * s, angle: S().tilt(staff.lines) };
    let x = g.left + 0.8 * s;
    items.forEach((it, i) => {
      const x0 = Number.isFinite(it.x) ? it.x : x, w = widthOf(it) * s;
      x = x0 + w + 0.5 * s;
      const sign = (key, p, dx = 0, flip = false) => { if (T[key]) out.signs.push({ key, d: T[key].d, x: x0 + dx * s, y: g.y(p, x0), scale: s, flip, item: i }); return !!T[key]; };
      const shape = (d, fill) => out.shapes.push({ d, fill, item: i });
      const box = (pLo, pHi) => out.boxes.push([x0, g.y(pHi, x0), w, g.y(pLo, x0) - g.y(pHi, x0)]);
      switch (it.k) {
        case 'clef': { const p = 2 * (it.line - 1); sign('clef' + it.shape, p); box(p - 4, p + 4); break; }
        case 'note': {
          const key = noteSign(it);
          if (!key || !sign(key, it.p)) {          // (a black maxima: a filled block twice a breve's width, its stem down)
            const y = g.y(it.p, x0), h = HIGH * s / 2, a = x0 + 0.3 * s, b2 = a + 2 * BLOCK * s;
            shape(`M${f(a)} ${f(y - h)}L${f(b2)} ${f(y - h)}L${f(b2)} ${f(y + h)}L${f(a)} ${f(y + h)}Z`, it.color === 'black' ? true : 'outline');
            shape(`M${f(b2)} ${f(y)}L${f(b2)} ${f(y + STEM * s)}`, false);
          }
          const up = /\.up$/.test(key || '') ? 6 : 1.5, down = /\.down$/.test(key || '') || it.v === 'Mx' ? 6 : 1.5;
          box(it.p - down, it.p + up); break;
        }
        case 'rest': {
          const key = it.v === 'L' && it.perf ? 'rLp' : REST[it.v];
          sign(key, it.p); if (it.v === 'Mx') sign(key, it.p, 0.6);   // (a maxima rest: two longa rests)
          box(it.p - 3, it.p + 3); break;
        }
        case 'acc':
          if (it.a === 'n') {                      // (a natural: Serenissima has none)
            const y = g.y(it.p, x0), a = x0 + 0.35 * s, b2 = x0 + 0.95 * s;
            shape(`M${f(a)} ${f(y - 1.3 * s)}L${f(a)} ${f(y + 0.45 * s)}L${f(b2)} ${f(y + 0.25 * s)}M${f(b2)} ${f(y + 1.3 * s)}L${f(b2)} ${f(y - 0.45 * s)}L${f(a)} ${f(y - 0.25 * s)}`, false);
          } else sign(it.a === 'b' ? 'flat' : 'sharp', it.p);
          box(it.p - 2, it.p + 3); break;
        case 'custos': sign('custos', it.p); box(it.p - 2, it.p + 4); break;
        case 'dot': sign('dot', it.p); box(it.p - 1, it.p + 1); break;
        case 'num': out.texts.push({ text: it.text, x: x0, y: g.y(4, x0) + 0.5 * s, size: 1.6 * s, item: i }); box(2, 6); break;
        case 'bar': {
          const n = { single: 1, double: 2, end: 3 }[it.form] || 1;
          for (let k = 0; k < n; k++) { const bx = x0 + k * 0.3 * s; shape(`M${f(bx)} ${f(g.y(8, bx))}L${f(bx)} ${f(g.y(0, bx))}`, false); }
          box(0, 8); break;
        }
        case 'sign': {
          // Serenissima's O and C, with or without their stroke; R, its C turned round; a dot in the middle, drawn
          const key = (it.sign === 'O' ? 'signO' : 'signC') + (it.stroke ? 'stroke' : '');
          sign(key, 4, 0, it.sign === 'R');
          if (it.dot && T[key]) { const cx = x0 + (T[key].x0 + T[key].x1) / 2 * s; shape(circle(cx, g.y(4, cx), 0.14 * s), true); }
          box(1, 7); break;
        }
        case 'lig': out.cells[i] = ligature(it, x0 + 0.3 * s, g, s, shape); box(Math.min(...it.notes.map(n => n.p)) - 6, Math.max(...it.notes.map(n => n.p)) + 6); break;
      }
    });
    return out;
  }
  // a sign's transform, for SVG: placed, scaled, tilted with the staff, flipped (turned round) if need be
  function transform(v, angle = 0) {
    const T = SIGN()[v.key] || { x0: 0, x1: 1 }, w = (T.x0 + T.x1) * v.scale;
    return `translate(${f(v.x + (v.flip ? w : 0))} ${f(v.y)}) rotate(${(angle || 0).toFixed(3)}) scale(${f(v.flip ? -v.scale : v.scale)} ${f(v.scale)})`;
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
    return cells;
  }

  // ---------------------------------------------------------------- hearing it
  // Mensural staves played in order, one voice: [{ staff, i, n, midi (null: a rest), beats }], a beat a minim. How long
  // each note is, read as white notation reads it (a first reading, to hear by: the commoner rules, not every one):
  //   the sign sets the tempus (O: three semibreves to the breve; C: two) and the prolation (a dot: three minims to
  //   the semibreve); a stroke through it halves every value (diminution), a proportion (3, 3/2) scales them (3/2:
  //   three in the time of two); the modus is imperfect (two breves to the longa), a maxima two longae.
  //   In a perfect mensuration, a note of that level followed by a single note of the next smaller (before the next
  //   note as long or longer) is imperfect, a third shorter; of two between, the second is altered (twice as long); a
  //   dot just after it is a dot of perfection. A dot after a note of an imperfect level adds half its value.
  //   A black (coloured) note loses a third of its value.
  //   A flat or sharp just after a clef holds for every note of its letter (a signature); any other, for the next
  //   note at its place.
  const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  function perform(staves) {
    const stream = [];                               // the notes and rests, and what bears on them, in order
    let tempus = false, prol = false, factor = 1, clef = null, sig = {}, next = {};
    for (const st of staves) {
      let afterClef = false;
      (st.mensural || []).forEach((it, i) => {
        if (it.k === 'clef') { clef = it; sig = {}; afterClef = true; return; }
        if (it.k === 'acc') {
          const q = pitch(it.p, clef), a = it.a === 'b' ? -1 : it.a === '#' ? 1 : 0;
          if (afterClef && q) sig[q.pname] = a; else next[it.p] = a;
          return;
        }
        afterClef = false;
        if (it.k === 'sign') { tempus = it.sign === 'O'; prol = !!it.dot; factor = it.stroke ? 0.5 : 1; return; }
        if (it.k === 'num') { const [a, b] = it.text.split('/').map(Number); factor = (b || 1) / (a || 1); return; }
        if (it.k === 'bar') { next = {}; return; }
        if (it.k === 'dot') { if (stream.length) stream[stream.length - 1].dot = true; return; }
        const add = (v, p, color, n, rest) => {
          const q = rest ? null : pitch(p, clef);
          let midi = null;
          if (q) { midi = 12 * (q.oct + 1) + SEMI[q.pname] + (next[p] !== undefined ? next[p] : sig[q.pname] || 0); delete next[p]; }
          stream.push({ staff: st.id, i, n, v, midi, rest: !!rest, black: color === 'black', tempus, prol, factor });
        };
        if (it.k === 'note') add(it.v, it.p, it.color, null, false);
        else if (it.k === 'rest') add(it.v, it.p, null, null, true);
        else if (it.k === 'lig') it.notes.forEach((nt, k) => add(nt.v, nt.p, it.color, k, false));
      });
    }
    // each one's value in minims, as its mensuration makes it
    const RANK = { Mx: 0, L: 1, B: 2, Sb: 3, M: 4, Sm: 5, F: 6, Sf: 7 };
    const value = e => {
      const sb = e.prol ? 3 : 2, b = (e.tempus ? 3 : 2) * sb;
      return { Sf: 0.125, F: 0.25, Sm: 0.5, M: 1, Sb: sb, B: b, L: 2 * b, Mx: 4 * b }[e.v];
    };
    stream.forEach(e => { e.minims = value(e); });
    // perfection, imperfection and alteration, at the breve's level (in O) and the semibreve's (with the dot)
    for (const [big, small, perfect] of [['B', 'Sb', e => e.tempus], ['Sb', 'M', e => e.prol]]) {
      stream.forEach((e, a) => {
        if (e.v !== big || e.rest || !perfect(e) || e.dot) return;      // (a dot after it: a dot of perfection)
        const between = [];
        for (let k = a + 1; k < stream.length && RANK[stream[k].v] > RANK[big]; k++) between.push(stream[k]);
        const unit = value({ v: small, tempus: e.tempus, prol: e.prol });
        const count = between.reduce((t, x) => t + value(x) / unit, 0);
        if (Math.abs(count - 1) < 1e-9) e.minims -= unit;               // (one after it: imperfect a parte post)
        else if (between.length === 2 && between.every(x => x.v === small && !x.rest)) between[1].minims += unit;   // (altered)
      });
    }
    return stream.map(e => {
      const perfLevel = (e.v === 'B' && e.tempus) || (e.v === 'Sb' && e.prol);
      let m = e.minims;
      if (e.dot && !perfLevel) m *= 1.5;                               // (a dot of addition)
      if (e.black) m *= 2 / 3;
      return { staff: e.staff, i: e.i, n: e.n, midi: e.midi, beats: m * e.factor };
    });
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

  global.CGMensural = { VALUES, parse, text, pitch, ligRules, check, layout, transform, geometry, mei, noteSign, perform };
})(typeof window !== 'undefined' ? window : globalThis);
