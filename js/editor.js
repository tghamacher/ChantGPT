// The editing layer over the page: staves, and the chant on them. Drag across a staff to add it (its four lines are
// found in the ink, bent if the page is, or spread evenly if they can't be found); select one to move it, drag a
// line's point up or down, or the bar through all four lines at a point (an end, or a bend) to move it; double-click
// a staff to bend it there, or a bend's bar to straighten it; find its lines again, space them evenly, or delete it.
// A staff's chant is drawn on it; a neume (a GABC group: all that stands over a syllable in it) is dragged up or down
// by steps, which rewrites its GABC, or along the staff; Shift-drag moves one note of it. A syllable's words are
// dragged into place and corrected in the side panel; a staff is accepted when its doubtful neumes have been checked.
// Every change can be undone.
// Everything is drawn in the page's own units (the overlay's viewBox is the page), so it lines up at any zoom.
(function (global) {
  'use strict';
  const S = global.CGStaves, N = global.CGNeumes, M = global.CGMensural, C = global.CGChant, K = global.CGChecks, X = global.CGExport, R = global.CGRecognizer;
  const SVG = 'http://www.w3.org/2000/svg';
  const HANDLE = 6, MIN_DRAG = 6;   // in screen pixels

  let ctx = null;            // { state, svg, say, changed, pixels(page) }
  let selected = null;       // the selected staff's id
  let item = null;           // the selected neume (an item of the selected staff): { s: syllable, i: item }, by index
  let word = null;           // or the selected syllable's words: the syllable's index on the selected staff
  let mitem = null;          // or, on a mensural staff, the selected item: { i, n } (n: the note, in a ligature)
  let alerts = [];           // what the checks found (checks.js), as of the last full drawing
  let drag = null;           // what the pointer is doing
  const history = { undo: [], redo: [] };

  function init(c) {
    ctx = c;
    ctx.svg.addEventListener('pointerdown', down);
    ctx.svg.addEventListener('pointermove', move);
    ctx.svg.addEventListener('pointerup', up);
    ctx.svg.addEventListener('dblclick', dbl);
    ctx.svg.addEventListener('contextmenu', contextMenu);
    ctx.svg.addEventListener('pointercancel', () => { if (drag && drag.before) restore(drag.before); drag = null; draw(); });
  }

  // a new document: nothing selected, nothing to undo
  function reset() { selected = null; item = null; word = null; drag = null; history.undo.length = history.redo.length = 0; info(); }

  const page = () => ctx.state.doc.pages[ctx.state.page];
  const staffOf = id => page().staves.find(s => s.id === id) || null;
  // screen pixels to page units, at the present zoom
  const unit = () => { const m = ctx.svg.getScreenCTM(); return m && m.a ? 1 / m.a : 1; };
  function at(e) {
    const p = ctx.svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(ctx.svg.getScreenCTM().inverse());
    return [q.x, q.y];
  }

  // ---------------------------------------------------------------- changes and undo
  // A change is recorded as the page's staves and the chants before and after it.
  // (A change over several pages is recorded as every page's staves: page is then null.)
  // (a page's staves and its voice areas, as JSON: what undo puts back)
  const pageState = p => JSON.stringify(p.regions && p.regions.length ? { staves: p.staves, regions: p.regions } : p.staves);
  const putPage = (p, json) => { const v = JSON.parse(json); if (Array.isArray(v)) { p.staves = v; delete p.regions; } else { p.staves = v.staves; p.regions = v.regions; } };
  const snapshot = () => ({ page: ctx.state.page, staves: pageState(page()), chants: JSON.stringify(ctx.state.doc.chants) });
  const snapshotAll = () => ({ page: null, staves: JSON.stringify(ctx.state.doc.pages.map(pageState)), chants: JSON.stringify(ctx.state.doc.chants) });
  function restore(snap) {
    const doc = ctx.state.doc;
    if (snap.page === null) JSON.parse(snap.staves).forEach((json, k) => { if (typeof json === 'string') putPage(doc.pages[k], json); else doc.pages[k].staves = json; });
    else putPage(doc.pages[snap.page], snap.staves);
    doc.chants = JSON.parse(snap.chants);
  }
  function commit(before) {
    const after = before.page === null ? snapshotAll() : snapshot();
    if (after.staves === before.staves && after.chants === before.chants) return;
    history.undo.push({ before, after });
    if (history.undo.length > 500) history.undo.shift();
    history.redo.length = 0;
    ctx.changed();
  }
  function step(from, to, which) {
    const h = from.pop();
    if (!h) return;
    to.push(h);
    restore(h[which]);
    if (selected && !page().staves.some(s => s.id === selected)) selected = null;
    if (!itemOf()) item = null;
    if (!sylOf()) word = null;
    ctx.changed();
    if (h[which].page !== null && h[which].page !== ctx.state.page) ctx.show(h[which].page); else draw();
  }
  const undo = () => step(history.undo, history.redo, 'before');
  const redo = () => step(history.redo, history.undo, 'after');

  // after any change to a staff's lines: its box, its chant's boxes (up and down, to follow its notes), and the
  // staves in reading order
  function settle(st, pg = page()) {
    st.lines = S.roundLines(st.lines);
    st.box = S.box(st.lines, pg.size);
    for (const syl of st.syllables) for (const it of syl.items) if (it.box) N.fitBox(st, it);
    pg.staves.splice(0, pg.staves.length, ...S.order(pg.staves));   // (down each column)
  }

  function newId(pg = page()) {
    const n = pg.n, used = new Set(ctx.state.doc.pages.flatMap(p => p.staves.map(s => s.id)));
    let k = 1 + Math.max(0, ...pg.staves.map(s => +(/s(\d+)$/.exec(s.id) || [0, 0])[1]));
    while (used.has(`p${n}s${k}`)) k++;
    return `p${n}s${k}`;
  }

  // ---------------------------------------------------------------- chant or mensural
  // Which notation a staff is in (the document's, unless the staff says otherwise: CGChant.notationOf). Mensural
  // staves have five lines, and the chant tools (GABC, the chant recognizer) leave them alone: they will be read and
  // saved their own way.
  const mensural = st => C.notationOf(ctx.state.doc, st) === 'mensural';
  const fiveLines = () => !!ctx.state.doc.fiveLines || ctx.state.doc.notation === 'mensural';
  // the document's notation set (its staves that said otherwise left as they are)
  function setNotation(v) {
    const doc = ctx.state.doc;
    if (!doc || !C.NOTATIONS.includes(v) || C.notationOf(doc) === v) return;
    if (v === 'chant') delete doc.notation; else doc.notation = v;
    ctx.changed();
    draw();
    const odd = C.staves(doc).filter(st => st.notation && st.notation !== v).length;
    ctx.say((v === 'mensural'
      ? 'Mensural notation: staves will be found with five lines, and read by the mensural reader; the chant tools leave them alone.'
      : 'Chant notation: staves are found and read as chant again.') +
      (odd ? ` ${odd} ${odd === 1 ? 'staff is' : 'staves are'} marked as the other notation and stay so (right-click a staff to change it).` : ''));
  }
  // the selected staff marked as the other notation from the document's (or back)
  function toggleNotation() {
    const st = staffOf(selected);
    if (!st) return;
    const before = snapshot(), doc = C.notationOf(ctx.state.doc), now = mensural(st) ? 'chant' : 'mensural';
    if (now === doc) delete st.notation; else st.notation = now;
    commit(before);
    draw();
    ctx.say(now === 'mensural' ? 'This staff is mensural: the chant tools leave it alone.' : 'This staff is chant again.');
  }

  // ---------------------------------------------------------------- mensural items
  // Selected (mitem), dragged along the staff and up and down it by steps, changed from the keyboard or the menu. In a
  // ligature, the note under the pointer is the one moved or changed (mitem.n).
  const VALUE_NAMES = { Mx: 'Maxima', L: 'Longa', B: 'Breve', Sb: 'Semibreve', M: 'Minima', Sm: 'Semiminima', F: 'Fusa', Sf: 'Semifusa' };
  const VALUE_KEYS = ['Mx', 'L', 'B', 'Sb', 'M', 'Sm', 'F', 'Sf'];
  const DIGIT_OF = { Sb: 1, M: 2, Sm: 4, F: 8, Sf: 6, B: 0, L: 9, Mx: 7 };   // (the keys for them, as the Measuring Polyphony editor has them)
  const mOf = () => { const st = staffOf(selected); return st && mitem && (st.mensural || [])[mitem.i] || null; };
  // the staff position under a point (steps up from the bottom line)
  function mPos(st, x, y) {
    const g = M.geometry(st.lines), b = g.y(0, x), t = g.y(8, x);
    return Math.round((b - y) / ((b - t) / 8));
  }
  // in a ligature, the note whose place along the staff is nearest x
  function ligNote(st, i, x) {
    const cells = (M.layout(st).cells || {})[i];
    if (!cells) return 0;
    let best = 0, bd = Infinity;
    cells.forEach(([a, b], k) => { const d = x < a ? a - x : x > b ? x - b : 0; if (d < bd) { bd = d; best = k; } });
    return best;
  }
  // a change to the selected item (fn changes it, or, changing nothing, returns a sentence saying why it can't): one undo
  function mChange(fn) {
    const st = staffOf(selected), it = mOf();
    if (!st || !it) return;
    const before = snapshot(), why = fn(it, st);
    if (typeof why === 'string') { ctx.say(why, true); return; }
    const now = mOf();
    if (now) delete now.conf;                                  // (changed by a person: taken as right)
    commit(before);
    draw();
    const bad = mitem ? M.check(st.mensural).filter(b => b.startsWith(`Item ${mitem.i + 1}:`)) : [];
    if (bad.length) ctx.say(bad.join(' '), true);
  }
  // the item's (or the ligature note's) value
  function mValue(v) {
    mChange(it => {
      if (it.k === 'note' || it.k === 'rest') { it.v = v; return; }
      if (it.k === 'lig' && mitem.n !== null) {
        if (!['Mx', 'L', 'B', 'Sb'].includes(v)) return `A ${VALUE_NAMES[v].toLowerCase()} can't be in a ligature.`;
        it.notes[mitem.n].v = v; return;
      }
      return 'Select a note or a rest.';
    });
  }
  // up or down by steps: a note, rest, dot, accidental or custos; a ligature's note (or all its notes); a clef by lines
  function mShift(d, all) {
    mChange(it => {
      if (it.k === 'clef') { const l = it.line + Math.sign(d); if (l < 1 || l > 5) return 'A clef stays on the staff\'s lines.'; it.line = l; return; }
      if (it.k === 'lig') { (all || mitem.n === null ? it.notes : [it.notes[mitem.n]]).forEach(n => { n.p += d; }); return; }
      if ('p' in it) { it.p += d; return; }
      return 'That stays where it is on the staff.';
    });
  }
  function mNudge(dx) { mChange(it => { it.x = Math.round(((Number.isFinite(it.x) ? it.x : 0) + dx) * 10) / 10; }); }
  // a ligature's notes, each with its own colour (the ligature's, if all of it is black)
  const ligNotes = it => it.notes.map(n => Object.assign({}, n, it.color === 'black' ? { color: 'black' } : {}));
  // black (coloured), or white again: a note; in a ligature, the selected note (with the note it makes an oblique
  // with: the two are one shape), or with whole, all of it
  function mBlack(whole) {
    mChange(it => {
      if (it.k !== 'note' && it.k !== 'lig') return 'Only notes and ligatures are blackened.';
      if (it.k === 'note' || whole || mitem.n === null) {
        if (it.color === 'black') delete it.color; else it.color = 'black';
        if (it.k === 'lig') it.notes.forEach(n => { delete n.color; });
        return;
      }
      const ns = ligNotes(it), k = mitem.n, on = ns[k].color !== 'black';
      let a = k, b = k;
      while (a > 0 && ns[a - 1].obl) a--;
      while (b < ns.length - 1 && ns[b].obl) b++;
      for (let j = a; j <= b; j++) { if (on) ns[j].color = 'black'; else delete ns[j].color; }
      const lig = M.ligOf(ns, false);
      it.notes = lig.notes; if (lig.color) it.color = 'black'; else delete it.color;
    });
  }
  function mStem() {
    mChange(it => {
      if (it.k !== 'note' || /^(B|Sb)$/.test(it.v)) return 'Only a note with a stem (a longa, maxima, minima or smaller) has one to turn.';
      const now = it.stem || ({ Mx: 'down', L: 'down' }[it.v] || 'up');
      it.stem = now === 'up' ? 'down' : 'up';
    });
  }
  function mRest() {
    mChange(it => {
      if (it.k === 'note') { it.k = 'rest'; delete it.color; delete it.stem; return; }
      if (it.k === 'rest') { it.k = 'note'; delete it.perf; return; }
      return 'Only a note becomes a rest, or a rest a note.';
    });
  }
  // a dot after the selected note: in the space it is in, or the one above if it is on a line
  function mDot() {
    const st = staffOf(selected), it = mOf();
    if (!st || !it) return;
    const p = it.k === 'lig' ? it.notes[it.notes.length - 1].p : 'p' in it ? it.p : 4;
    const b = M.layout(st).boxes[mitem.i];
    mInsert({ k: 'dot', p: p % 2 === 0 ? p + 1 : p, x: Math.round((b ? b[0] + b[2] : it.x + M.geometry(st.lines).s) * 10) / 10 }, mitem.i + 1);
  }
  // the selected note (or ligature) and the next one in one ligature
  function mJoin() {
    mChange((it, st) => {
      const nx = st.mensural[mitem.i + 1];
      const notes = x => x && (x.k === 'lig' ? ligNotes(x) : x.k === 'note' ? [Object.assign({ v: x.v, p: x.p }, x.color === 'black' ? { color: 'black' } : {})] : null);
      const a = notes(it), b = notes(nx);
      if (!a || !b) return 'Only notes (or ligatures) next to each other join into a ligature.';
      if (a.concat(b).some(n => !['Mx', 'L', 'B', 'Sb'].includes(n.v))) return 'Only maximae, longae, breves and semibreves go into a ligature.';
      const lig = Object.assign(M.ligOf(a.concat(b), false), { x: it.x });
      st.mensural.splice(mitem.i, 2, lig);
      mitem = { i: mitem.i, n: a.length - 1 };
    });
  }
  // in a ligature: the selected note and the next one drawn as one oblique (or square again)
  function mOblique() {
    mChange(it => {
      if (it.k !== 'lig' || mitem.n === null || mitem.n >= it.notes.length - 1) return 'Select a ligature\'s note (not its last) to make it and the next one oblique.';
      const n = it.notes[mitem.n];
      if (n.obl) delete n.obl; else n.obl = true;
    });
  }
  // a ligature cut after the selected note: two ligatures (or notes)
  function mSplit() {
    mChange((it, st) => {
      if (it.k !== 'lig' || mitem.n === null || mitem.n >= it.notes.length - 1) return 'Select a ligature\'s note (not its last) to cut the ligature after it.';
      const cells = (M.layout(st).cells || {})[mitem.i] || [];
      const part = ns => ns.length === 1
        ? Object.assign({ k: 'note', v: ns[0].v, p: ns[0].p }, ns[0].color === 'black' ? { color: 'black' } : {})
        : M.ligOf(ns, false);
      const all = ligNotes(it), a = part(all.slice(0, mitem.n + 1)), b = part(all.slice(mitem.n + 1));
      if (a.k === 'lig') delete a.notes[a.notes.length - 1].obl;
      a.x = it.x;
      b.x = cells[mitem.n + 1] ? Math.round((cells[mitem.n + 1][0] + 0.6 * M.geometry(st.lines).s) * 10) / 10 : it.x + 2 * M.geometry(st.lines).s;
      st.mensural.splice(mitem.i, 1, a, b);
      mitem = { i: mitem.i, n: a.k === 'lig' ? a.notes.length - 1 : null };
    });
  }
  function mRemove() {
    const st = staffOf(selected);
    if (!st || !mOf()) return;
    const before = snapshot();
    st.mensural.splice(mitem.i, 1);
    mitem = null;
    commit(before);
    draw();
  }
  // a new item on the selected staff, at index k (or where its x puts it among the others)
  function mInsert(it, k) {
    const st = staffOf(selected);
    if (!st) return;
    const before = snapshot();
    st.mensural = st.mensural || [];
    if (k === undefined) { k = st.mensural.findIndex(v => Number.isFinite(v.x) && v.x > it.x); if (k < 0) k = st.mensural.length; }
    st.mensural.splice(k, 0, it);
    mitem = { i: k, n: it.k === 'lig' ? 0 : null };
    commit(before);
    draw();
  }
  // the next item along the staff (or the one before)
  function mNext(d) {
    const st = staffOf(selected);
    if (!st || !(st.mensural || []).length) return;
    const n = st.mensural.length, i = mitem ? (mitem.i + d + n) % n : d > 0 ? 0 : n - 1;
    mitem = { i, n: st.mensural[i].k === 'lig' ? 0 : null };
    draw();
  }
  // ---------------------------------------------------------------- typing music in (as the Measuring Polyphony editor does)
  // A letter, a to g, puts a note of that pitch after the selected item (or at the staff's end): the nearest such
  // pitch to the note before; a capital, the one the other way (d then A: the fifth up, not the fourth down). Digits set
  // a value, of the selected item and of the notes typed after it, as that editor numbers them: 1 semibreve, 2 minim,
  // 4 semiminim, 8 fusa, 6 semifusa, 0 breve, 9 longa, 7 maxima. r puts a rest; - # n a flat, sharp or natural before
  // the selected note (N takes it off); [ and ] the first and last notes of a ligature.
  const DIGIT_VALUES = { 1: 'Sb', 2: 'M', 4: 'Sm', 8: 'F', 6: 'Sf', 0: 'B', 9: 'L', 7: 'Mx' };
  let entry = 'Sb', ligFrom = null;
  // the clef in force at index k of the staff's items (else its first; else C4)
  function clefAt(st, k) {
    const items = st.mensural || [];
    return items.slice(0, k).reverse().find(v => v.k === 'clef') || items.find(v => v.k === 'clef') || { k: 'clef', shape: 'C', line: 4 };
  }
  // the place of the last note at or before index k (a ligature's last note), else the staff's middle line
  function lastPlace(st, k) {
    for (const v of (st.mensural || []).slice(0, k + 1).reverse()) {
      if (v.k === 'note') return v.p;
      if (v.k === 'lig') return v.notes[v.notes.length - 1].p;
    }
    return 4;
  }
  // an item put after index k (or at the start, k = -1), where it fits along the staff; those after it moved on if need be
  function mInsertAfter(it, k) {
    const st = staffOf(selected);
    if (!st) return;
    st.mensural = st.mensural || [];
    const g = M.geometry(st.lines), L = M.layout(st), b = L.boxes[k];
    const x = b ? b[0] + b[2] + 0.4 * g.s : g.left + 0.8 * g.s;
    it.x = Math.round(x * 10) / 10;
    // (room for it: the width layout would give it)
    const w = M.layout({ lines: st.lines, mensural: [Object.assign({}, it)] }).boxes[0][2] + 0.4 * g.s;
    const before = snapshot();
    const next = st.mensural[k + 1];
    if (next && Number.isFinite(next.x) && next.x < x + w) { const dx = x + w - next.x; for (const v of st.mensural.slice(k + 1)) if (Number.isFinite(v.x)) v.x = Math.round((v.x + dx) * 10) / 10; }
    st.mensural.splice(k + 1, 0, it);
    mitem = { i: k + 1, n: it.k === 'lig' ? 0 : null };
    delete it.conf;
    commit(before);
    draw();
  }
  // where typing goes: after the selected item, or after the staff's last
  const typingAt = st => mitem ? mitem.i : (st.mensural || []).length - 1;
  function mTypeNote(letter) {
    const st = staffOf(selected);
    if (!st || !mensural(st)) return;
    let k = typingAt(st);
    // (a staff with no clef: a C4 put first, to say what the letters mean)
    if (!(st.mensural || []).some(v => v.k === 'clef')) {
      mInsertAfter({ k: 'clef', shape: 'C', line: 4 }, -1); k++;
      ctx.say('The staff had no clef: a C clef on the fourth line is put first (↑ ↓ moves it to another line).');
    }
    const clef = clefAt(st, k + 1), ref = lastPlace(st, k), name = letter.toLowerCase();
    const cands = [];
    for (let p = ref - 7; p <= ref + 7; p++) { const q = M.pitch(p, clef); if (q && q.pname === name) cands.push(p); }
    cands.sort((a, b) => Math.abs(a - ref) - Math.abs(b - ref) || b - a);
    let p = cands[0];
    if (letter !== name) p = cands.find(c => c !== ref && Math.sign(c - ref) !== Math.sign(cands[0] - ref)) ?? (cands[0] === ref ? ref + 7 : cands[0]);
    mInsertAfter({ k: 'note', v: entry, p }, k);
  }
  function mTypeRest() {
    const st = staffOf(selected);
    if (!st || !mensural(st)) return;
    const p = { Mx: 4, L: 4, B: 5, Sb: 6, M: 4, Sm: 4, F: 4, Sf: 4 }[entry];
    mInsertAfter({ k: 'rest', v: entry, p }, typingAt(st));
  }
  // a digit: the selected note's (or rest's) value, and the value of what is typed next
  function mDigit(d) {
    const v = DIGIT_VALUES[d];
    if (!v) return false;
    entry = v;
    const it = mOf();
    if (it && (it.k === 'note' || it.k === 'rest' || (it.k === 'lig' && mitem.n !== null))) mValue(v);
    else ctx.say(`${VALUE_NAMES[v]}s from now on.`);
    return true;
  }
  // an accidental before the selected note (n: natural); N: the one before it taken off
  function mAccidental(a) {
    const st = staffOf(selected), it = mOf();
    if (!st || !it || (it.k !== 'note' && it.k !== 'lig')) { ctx.say('Select the note it goes before.', true); return; }
    const before = st.mensural[mitem.i - 1];
    if (a === null) {
      if (!before || before.k !== 'acc') return;
      const snap = snapshot();
      st.mensural.splice(mitem.i - 1, 1);
      mitem = { i: mitem.i - 1, n: mitem.n };
      commit(snap);
      draw();
      return;
    }
    const p = it.k === 'lig' ? it.notes[mitem.n === null ? 0 : mitem.n].p : it.p, i = mitem.i;
    if (before && before.k === 'acc') { mitem = { i: i - 1, n: null }; mChange(x => { x.a = a; x.p = p; }); mitem = { i, n: null }; draw(); return; }
    const x = Number.isFinite(it.x) ? it.x : M.geometry(st.lines).left;
    const s = M.geometry(st.lines).s, snap = snapshot();
    for (const v of st.mensural.slice(i)) if (Number.isFinite(v.x)) v.x = Math.round((v.x + 1.4 * s) * 10) / 10;
    st.mensural.splice(i, 0, { k: 'acc', a, p, x: Math.round(x * 10) / 10 });
    mitem = { i: i + 1, n: it.k === 'lig' ? mitem.n : null };
    commit(snap);
    draw();
  }
  // [ marks the selected note as a ligature's first; ] joins it and every note up to the selected one
  function mLigature(open) {
    const st = staffOf(selected);
    if (!st || !mOf()) return;
    if (open) { ligFrom = { staff: st.id, i: mitem.i }; ctx.say('A ligature begins here: type its notes, then ] at its last.'); return; }
    if (!ligFrom || ligFrom.staff !== st.id || ligFrom.i >= mitem.i) { ctx.say('Mark the ligature\'s first note with [ first.', true); return; }
    const from = ligFrom.i, to = mitem.i, part = st.mensural.slice(from, to + 1);
    if (part.some(v => v.k !== 'note')) { ctx.say('Only notes go into a ligature (no rests, dots or accidentals between).', true); return; }
    if (part.some(v => !['Mx', 'L', 'B', 'Sb'].includes(v.v))) { ctx.say('Only maximae, longae, breves and semibreves go into a ligature.', true); return; }
    const snap = snapshot();
    st.mensural.splice(from, part.length, { k: 'lig', notes: part.map(v => ({ v: v.v, p: v.p })), x: part[0].x });
    mitem = { i: from, n: part.length - 1 };
    ligFrom = null;
    commit(snap);
    draw();
    const bad = M.check([st.mensural[from]]);
    if (bad.length) ctx.say(bad.join(' ').replace(/Item 1: /g, ''), true);
  }

  // what the side panel says of the selected item
  function mDescribe(st, it) {
    const clef = st.mensural.slice(0, mitem.i + 1).reverse().find(v => v.k === 'clef');
    const name = p => { const q = M.pitch(p, clef); return q ? q.pname.toUpperCase() + q.oct : `position ${p}`; };
    const black = it.color === 'black' ? ' (black)' : '';
    switch (it.k) {
      case 'note': return `${VALUE_NAMES[it.v] || it.v}${black} on ${name(it.p)}${it.stem ? `, its stem ${it.stem}` : ''}.`;
      case 'rest': return `${VALUE_NAMES[it.v] || it.v} rest${it.perf ? ' (perfect)' : ''}.`;
      case 'lig': {
        const n = mitem.n !== null ? it.notes[mitem.n] : null;
        return `Ligature of ${it.notes.length}${black}: ${it.notes.map(v => (VALUE_NAMES[v.v] || v.v) + (v.color === 'black' ? ' (black)' : '')).join(', ')}.` +
          (n ? ` This note: ${(VALUE_NAMES[n.v] || n.v).toLowerCase()}${n.color === 'black' && !black ? ' (black)' : ''} on ${name(n.p)}${n.obl ? ', oblique with the next' : ''}.` : '');
      }
      case 'clef': return `${it.shape} clef on line ${it.line} (from the bottom).`;
      case 'sign': return `Mensuration sign: ${it.sign === 'R' ? 'C turned round' : it.sign}${it.dot ? ', with a dot' : ''}${it.stroke ? ', struck through' : ''}.`;
      case 'dot': return `A dot, on ${name(it.p)}.`;
      case 'acc': return `${{ b: 'Flat', n: 'Natural', '#': 'Sharp' }[it.a]} on ${name(it.p)}.`;
      case 'custos': return `Custos: the next staff begins on ${name(it.p)}.`;
      case 'congr': return 'Signum congruentiae: where the voices meet (a canon\'s entry, a hold), or where this voice goes on elsewhere (the same sign there).';
      case 'num': return `Proportion ${it.text}.`;
      case 'bar': return `Bar (${it.form}).`;
    }
    return '';
  }

  // the selected mensural staff given what is typed (CGMensural's text form), its items spread along it
  function putMensural(text) {
    const st = staffOf(selected);
    if (!st || !mensural(st)) { ctx.say('Select a mensural staff first (mark it so from its right-click menu, or set the document to Mensural).', true); return false; }
    let items;
    try { items = M.parse(text); } catch (e) { ctx.say(e.message, true); return false; }
    const before = snapshot();
    // (spread: each item's x where the layout puts it, stretched (up to three times) to fill the staff; never squeezed,
    // so that what runs past the staff's end shows)
    const L = M.layout({ lines: st.lines, mensural: items }), g = M.geometry(st.lines);
    const xs = L.boxes.map(b => b[0]), end = L.boxes.length ? L.boxes[L.boxes.length - 1][0] + L.boxes[L.boxes.length - 1][2] : g.left;
    const k = items.length > 1 ? Math.max(1, Math.min(3, (g.right - g.left - g.s) / Math.max(1, end - g.left))) : 1;
    items.forEach((it, i) => { it.x = Math.round((g.left + (xs[i] - g.left) * k) * 10) / 10; });
    st.mensural = items;
    commit(before);
    draw();
    const bad = M.check(items);
    const over = end > g.right + g.s;
    ctx.say(`${items.length} ${items.length === 1 ? 'item' : 'items'} on the staff.` + (over ? ' They run past its end: is it all one staff?' : '') + (bad.length ? ` To look at: ${bad.slice(0, 3).join(' ')}` : ''), !!bad.length);
    return true;
  }
  // the document's mensural staves as MEI
  function mensuralMusicXml() {
    const doc = ctx.state.doc;
    if (!C.staves(doc).some(st => mensural(st) && (st.mensural || []).length)) { ctx.say('No mensural staff has anything on it yet.', true); return null; }
    const base = (doc.source.name || 'mensural').replace(/\.[^.]+$/, '').replace(/ \(.*$/, '');
    const unnamed = M.voices(doc).filter(v => !v.voice && v.staves.some(st => (st.mensural || []).length)).length;
    if (unnamed && M.voices(doc).some(v => v.voice)) ctx.say('Some mensural staves have no voice named: they are written as a part of their own (right-click a staff to say which voice it is).');
    return { name: `${base}.musicxml`, text: M.musicxml(doc, { title: base }) };
  }
  function mensuralMei() {
    const doc = ctx.state.doc;
    if (!C.staves(doc).some(st => mensural(st) && (st.mensural || []).length)) { ctx.say('No mensural staff has anything on it yet.', true); return null; }
    const base = (doc.source.name || 'mensural').replace(/\.[^.]+$/, '').replace(/ \(.*$/, '');
    return { name: `${base} (mensural).mei`, text: M.mei(doc) };
  }

  // ---------------------------------------------------------------- finding lines in the ink
  // region: [x, y, w, h] in page units. The lines found, in page units, or null.
  async function find(region) {
    const px = await ctx.pixels(ctx.state.page);
    // (a book of five-line staves: the one the five-line finder finds in the box, if any)
    if (fiveLines() && px.reds) {
      const [x, y, w, h] = region.map(v => v * px.scale);
      const hit = S.byFiveLines(px.reds, px.w, px.h).find(s => { const m = (s.lines[0][1] + s.lines[4][1]) / 2; return m > y && m < y + h && s.lines[0][2] > x && s.lines[0][0] < x + w; });
      return hit ? hit.lines.map(l => l.map(v => v / px.scale)) : null;
    }
    const r = (px.lines && S.fitStaff(px.lines, px.w, px.h, region.map(v => v * px.scale), undefined, true)) || S.fitStaff(px.gray, px.w, px.h, region.map(v => v * px.scale));
    return r && r.lines.map(l => l.map(v => v / px.scale));
  }

  async function addStaff(rect) {
    const pg = ctx.state.page, grow = rect[3] * 0.05;
    let lines = null;
    ctx.say('Finding the lines …');
    try { lines = await find([rect[0], rect[1] - grow, rect[2], rect[3] + 2 * grow]); } catch (e) { ctx.say(`Couldn't read the page: ${e.message || e}`, true); }
    if (ctx.state.page !== pg) return;
    const before = snapshot();   // taken now, not before the search, in case another staff was added meanwhile
    const st = { id: newId(), lines: lines || S.even(rect, fiveLines() ? 5 : 4), syllables: [] };
    page().staves.push(st);
    settle(st);
    voiceFromArea(st);
    selected = st.id;
    commit(before);
    ctx.say(!lines ? 'Couldn\'t find four lines there, so they are spread evenly over the box. Drag them into place.'
      : S.count(lines[0]) > 2 ? 'Staff added. It bends, so it has a point at each bend; drag them if they are off.' : 'Staff added. Drag its lines to adjust them if they are off.');
    draw();
  }

  // Every staff on the shown page found (those already marked left as they are). Returns how many were added.
  let busy = false, stopping = false;
  async function findAll() {
    const pg = ctx.state.page;
    const found = await findOn(pg, () => ctx.state.page !== pg);
    if (found === null) return 0;
    const before = snapshot();
    addFound(pg, found);
    commit(before);
    draw();
    return found.length;
  }
  // the staves on page pg (from 0) not yet marked, as found in its ink (null if stale() says to give up), and added
  async function findOn(pg, stale = () => false) {
    const px = await ctx.pixels(pg);
    if (stale()) return null;
    const skip = ctx.state.doc.pages[pg].staves.map(st => st.box.map(v => v * px.scale));
    const found = S.findStaves(px.gray, px.w, px.h, { skip, lines: px.lines, tint: px.tint, reds: px.reds, ruled: !!ctx.state.doc.ruledEvenly, five: fiveLines() });
    return stale() ? null : found.map(r => r.lines.map(l => l.map(v => v / px.scale)));
  }
  function addFound(pg, found) {
    const p = ctx.state.doc.pages[pg];
    for (const lines of found) {
      const st = { id: newId(p), lines, syllables: [] };
      p.staves.push(st);
      settle(st, p);
      voiceFromArea(st, p);
    }
  }
  // on this page, saying what was found
  async function findHere() {
    if (busy) return;
    busy = true;
    ctx.say('Finding the staves …');
    try {
      const n = await findAll();
      ctx.say(n ? `${n} ${n === 1 ? 'staff' : 'staves'} found. Check them (hold H to see the page alone); drag any that are off, delete any that aren't staves.` : page().staves.length ? 'No more staves found on this page.' : 'No staves found on this page. Drag a box round one to mark it.');
    } catch (e) { ctx.say(`Couldn't read the page: ${e.message || e}`, true); }
    busy = false;
    info();
  }
  // on every page from this one on, one at a time, until done or stopped
  async function findEverywhere() {
    if (busy) return;
    busy = true; stopping = false;
    const doc = ctx.state.doc, from = ctx.state.page;
    let total = 0, pages = 0;
    info();
    try {
      for (let i = from; i < doc.pages.length && !stopping; i++) {
        await ctx.show(i);
        ctx.say(`Finding the staves on page ${i + 1} of ${doc.pages.length} … (${total} so far)`);
        total += await findAll();
        pages++;
      }
      ctx.say(`${total} ${total === 1 ? 'staff' : 'staves'} found on ${pages} ${pages === 1 ? 'page' : 'pages'}${stopping ? ' (stopped)' : ''}. Check them page by page.`);
    } catch (e) { ctx.say(`Couldn't read page ${ctx.state.page + 1}: ${e.message || e}`, true); }
    busy = false; stopping = false;
    info();
  }
  const stop = () => { stopping = true; };

  async function refit() {
    const st = staffOf(selected);
    if (!st) return;
    const s = S.spacing(st.lines), xs = st.lines.flatMap(S.xsOf), ys = st.lines.flatMap(l => l.filter((v, i) => i & 1));
    const x0 = Math.min(...xs) - 2 * s, x1 = Math.max(...xs) + 2 * s, y0 = Math.min(...ys) - 2 * s, y1 = Math.max(...ys) + 2 * s;
    const lines = await find([x0, y0, x1 - x0, y1 - y0]);
    if (!lines) { ctx.say('Couldn\'t find four lines along this staff. Drag them into place.'); return; }
    const before = snapshot();
    st.lines = lines;
    settle(st);
    commit(before);
    ctx.say('Lines found again.');
    draw();
  }

  function evenly() {
    const st = staffOf(selected);
    if (!st) return;
    const before = snapshot();
    st.lines = S.spaceEvenly(st.lines);
    settle(st);
    commit(before);
    draw();
  }

  function remove() {
    const st = staffOf(selected);
    if (!st) return;
    const before = snapshot();
    page().staves = page().staves.filter(s => s !== st);
    letGo();
    for (const c of ctx.state.doc.chants) c.staves = (c.staves || []).filter(id => id !== st.id);
    selected = null;
    commit(before);
    ctx.say(st.syllables.length ? 'Staff deleted, with its chant. Undo brings it back.' : 'Staff deleted.');
    draw();
  }

  function nudge(dx, dy) {
    const st = staffOf(selected);
    if (!st) return;
    const before = snapshot();
    st.lines = shift(st.lines, dx, dy);
    shiftChant(st, boxesOf(st), dx, dy);
    settle(st);
    commit(before);
    draw();
  }
  const shift = (lines, dx, dy) => lines.map(l => l.map((v, i) => v + (i & 1 ? dy : dx)));
  // a staff's chant goes where the staff goes: its items' boxes, as they were (boxes), moved by dx, dy
  const boxesOf = st => Object.assign(st.syllables.map(syl => syl.items.map(it => it.box ? it.box.slice() : null)), { mx: (st.mensural || []).map(it => it.x) });
  function shiftChant(st, boxes, dx, dy) {
    (st.mensural || []).forEach((it, j) => { if (boxes.mx && Number.isFinite(boxes.mx[j])) it.x = Math.round((boxes.mx[j] + dx) * 10) / 10; });
    st.syllables.forEach((syl, i) => syl.items.forEach((it, j) => {
      const b = boxes[i] && boxes[i][j];
      if (b) it.box = [b[0] + dx, b[1] + dy, b[2], b[3]];
    }));
  }

  // ---------------------------------------------------------------- neumes
  // the selected item (or the one at s, i on the selected staff), or null
  function itemOf(s = item && item.s, i = item && item.i) {
    const st = staffOf(selected);
    return st && s !== null && s !== undefined && st.syllables[s] && st.syllables[s].items[i] || null;
  }
  // the selected syllable, or null
  function sylOf() {
    const st = staffOf(selected);
    return st && word !== null && st.syllables[word] || null;
  }
  // nothing selected within the staff
  const letGo = () => { item = null; word = null; mitem = null; };
  const DOUBT = 0.8;
  // A custos is no work of the editor's: Gregorio sets its own and GABC and Volpiano leave it out. It's read (so it isn't
  // taken for a note), drawn faintly, never doubtful nor counted as to check, passed over by Tab; it's only heard from
  // when it disagrees with the next line's first note (checks.js).
  const isCustos = it => !!(it && it.g && C.kind(it.g) === 'custos');
  const doubtful = x => x.conf !== undefined && x.conf < DOUBT && !x.checked && !isCustos(x);

  // the staff position (a = 0) at a point on the page, on the selected staff, and the size of a step there
  function pitchAt(st, x, y) {
    const b = S.yAt(st.lines[st.lines.length - 1], x), t = S.yAt(st.lines[0], x), step = (b - t) / (2 * (st.lines.length - 1));
    return { p: 3 + (b - y) / step, step };
  }
  // the item's GABC changed (moved up or down, or a note of it): marked as checked by being edited
  function setG(it, g) { if (g && g !== it.g) { it.g = g; it.checked = 'edited'; return true; } return false; }

  // the selected neume moved up or down by k steps (or just its note number `note`)
  function shiftNeume(k, note = null) {
    const st = staffOf(selected), it = itemOf();
    if (!it) return;
    const before = snapshot(), g = C.transpose(it.g, k, note);
    if (!g) { ctx.say('That would take it off the staff.'); return; }
    if (!setG(it, g)) return;
    N.fitBox(st, it);
    commit(before);
    draw();
  }
  function nudgeNeume(dx) {
    const st = staffOf(selected), it = itemOf();
    if (!it || !it.box) return;
    const before = snapshot();
    it.box = [it.box[0] + dx, it.box[1], it.box[2], it.box[3]];
    it.checked = 'edited';
    N.fitBox(st, it);
    commit(before);
    draw();
  }
  // the selected neume confirmed as right, looked at alone (Enter), and the next one selected
  function acceptNeume() {
    const it = itemOf();
    if (!it) return;
    const before = snapshot();
    if (it.checked !== 'edited') it.checked = 'item';
    commit(before);
    nextNeume(1);
  }
  // the selected neume taken out of the chant (its syllable too, if nothing is left of it)
  function removeNeume() {
    const st = staffOf(selected), it = itemOf();
    if (!it) return;
    const before = snapshot(), syl = st.syllables[item.s];
    syl.items.splice(item.i, 1);
    if (!syl.items.length && !syl.text) st.syllables.splice(item.s, 1);
    item = null;
    commit(before);
    draw();
  }
  // the next (or previous) neume on the page, staff by staff
  function nextNeume(d) {
    const list = [];
    page().staves.forEach(st => st.syllables.forEach((syl, s) => syl.items.forEach((it, i) => { if (it.box && !isCustos(it)) list.push({ id: st.id, s, i }); })));
    if (!list.length) return;
    const at = list.findIndex(v => v.id === selected && item && v.s === item.s && v.i === item.i);
    const v = list[at < 0 ? (d > 0 ? 0 : list.length - 1) : (at + d + list.length) % list.length];
    selected = v.id; item = { s: v.s, i: v.i }; word = null;
    draw();
  }

  // ---------------------------------------------------------------- the words
  // The selected syllable's text (expanded: what goes into the GABC), its reading as written, whether it begins a
  // word. Each counts as checking it.
  function setText(v) {
    const syl = sylOf();
    if (!syl) return;
    v = String(v).replace(/[()]/g, '').trim();
    if (v === syl.text) return;
    const before = snapshot();
    syl.text = v;
    syl.checked = 'edited';
    commit(before);
    draw();
  }
  function setDipl(v) {
    const syl = sylOf();
    if (!syl) return;
    v = String(v).trim();
    if (v === (syl.dipl || '')) return;
    const before = snapshot();
    if (v && v !== syl.text) syl.dipl = v; else delete syl.dipl;
    syl.checked = 'edited';
    commit(before);
    draw();
  }
  function setWordStart(on) {
    const syl = sylOf();
    if (!syl || on === !syl.join) return;
    const before = snapshot();
    if (on) delete syl.join; else syl.join = true;
    syl.checked = 'edited';
    commit(before);
    draw();
  }
  function nudgeWord(dx, dy) {
    const syl = sylOf(), box = syl && wordBox(word);
    if (!box) return;
    const before = snapshot();
    syl.box = [box[0] + dx, box[1] + dy, box[2], box[3]].map(v => Math.round(v * 100) / 100);
    syl.checked = 'edited';
    commit(before);
    draw();
  }
  // a syllable's box as drawn: its own, or one made from where it is drawn now (its middle, its baseline, its width)
  function wordBox(s) {
    const st = staffOf(selected), syl = st && st.syllables[s];
    if (!syl) return null;
    if (syl.box) return syl.box.slice();
    const t = ctx.svg.querySelector(`.syl[data-staff="${st.id}"][data-s="${s}"]`);
    if (!t) return null;
    const x = +t.getAttribute('x'), y = +t.getAttribute('y'), h = +t.getAttribute('font-size'), w = t.getBBox().width;
    return [x - w / 2, y - h, w, h];
  }
  // a new syllable from the selected neume on (the neume must not be its syllable's first): it takes that neume and
  // those after it, and has no text yet; it goes on with the word before it
  function splitHere() {
    const st = staffOf(selected), it = itemOf();
    if (!it) return;
    if (item.i === 0) { ctx.say('This neume already begins its syllable. Select a later one to split there.'); return; }
    const before = snapshot(), syl = st.syllables[item.s];
    const fresh = { text: '', items: syl.items.splice(item.i), join: true, checked: 'edited' };
    st.syllables.splice(item.s + 1, 0, fresh);
    word = item.s + 1; item = null;
    commit(before);
    draw();
    ctx.say('A new syllable begins at that neume. Type its text in the side panel.');
  }
  // the selected syllable joined onto the one before it on the staff: its text and its neumes
  function joinPrev() {
    const st = staffOf(selected), s = word !== null ? word : item ? item.s : null;
    if (s === null) return;
    if (s === 0) { ctx.say('This is the staff\'s first syllable; there is none before it on the staff to join it to.'); return; }
    const before = snapshot(), cur = st.syllables[s], prev = st.syllables[s - 1];
    prev.text += cur.text;
    if (cur.dipl || prev.dipl) prev.dipl = (prev.dipl || prev.text) + (cur.dipl || cur.text);
    prev.items.push(...cur.items);
    prev.checked = 'edited';
    st.syllables.splice(s, 1);
    item = null; word = s - 1;
    commit(before);
    draw();
  }
  // The selected neume's syllable, its text to be typed: a new syllable from this neume, if it isn't its syllable's
  // first; the text field in the side panel ready
  function textHere() {
    const st = staffOf(selected);
    if (!st || !item) return;
    if (item.i > 0) splitHere();
    else { word = item.s; item = null; draw(); }
    const f = document.getElementById('sylText');
    if (f) { f.focus(); f.select(); }
  }
  // the selected neume's syllable (with no text of its own) put into the one before it: its neumes sung to that
  function joinBack() {
    const st = staffOf(selected);
    if (!st || !item || item.s === 0 || item.i !== 0 || st.syllables[item.s].text) return;
    const s = item.s, i = st.syllables[s - 1].items.length;
    word = s; joinPrev();
    word = null; item = { s: s - 1, i };
    draw();
  }
  function acceptWord() {
    const syl = sylOf();
    if (!syl) return;
    const before = snapshot();
    if (syl.checked !== 'edited') syl.checked = 'item';
    commit(before);
    nextWord(1);
  }
  // the next (or previous) syllable with words on the selected staff, then on the staves after it
  function nextWord(d) {
    const list = [];
    page().staves.forEach(st => st.syllables.forEach((syl, s) => { if (syl.text) list.push({ id: st.id, s }); }));
    if (!list.length) return;
    const at = list.findIndex(v => v.id === selected && v.s === word);
    const v = list[at < 0 ? (d > 0 ? 0 : list.length - 1) : (at + d + list.length) % list.length];
    selected = v.id; word = v.s; item = null;
    draw();
  }

  // ---------------------------------------------------------------- accepting a staff
  // The selected staff accepted: its neumes and words not yet checked are checked with it. Not while a doubtful one
  // (the recognizer unsure of it) is unchecked: then the first of those is selected, to be looked at alone.
  function acceptStaff() {
    const st = staffOf(selected);
    if (!st || !st.syllables.length) return;
    const left = [];
    st.syllables.forEach((syl, s) => {
      syl.items.forEach((it, i) => { if (it.box && doubtful(it)) left.push({ s, i }); });
      if (syl.text && doubtful(syl)) left.push({ s, i: null });
    });
    if (left.length) {
      const first = left[0];
      if (first.i === null) { word = first.s; item = null; } else { item = { s: first.s, i: first.i }; word = null; }
      draw();
      ctx.say(`${left.length} doubtful ${left.length === 1 ? 'place' : 'places'} on this staff still to check, one by one (Enter accepts each). Then accept the staff.`, true);
      return;
    }
    const before = snapshot();
    let n = 0;
    for (const syl of st.syllables) {
      for (const it of syl.items) if (it.box && !it.checked) { it.checked = 'staff'; n++; }
      if (syl.text && !syl.checked) { syl.checked = 'staff'; n++; }
    }
    commit(before);
    // on to the next staff with chant on it
    const list = page().staves, next = list.slice(list.indexOf(st) + 1).find(t => t.syllables.length);
    if (next) selected = next.id;
    letGo();
    draw();
    ctx.say(`Staff accepted${n ? ` (${n} more ${n === 1 ? 'thing' : 'things'} checked with it)` : ''}.` + (next ? ' On to the next staff.' : ' That was the last staff with chant on this page.'));
  }

  // ---------------------------------------------------------------- the chant on a staff
  // GABC placed on the selected staff: a line of it on each staff from there down the page, as many as its line
  // breaks (z) say. Each staff's chant is laid out along it, its gaps stretched to fill the staff; the chant is
  // listed in the document's chants under its name. Returns false (and says why) if it can't be placed.
  async function placeChant(src, last) {
    const st = staffOf(selected);
    if (!st) { ctx.say('Select the staff the chant begins on first.', true); return false; }
    if (mensural(st)) { ctx.say('This staff is marked mensural: GABC goes on chant staves only. (Right-click it to mark it chant.)', true); return false; }
    let r;
    try { r = C.fromGabc(src); } catch (e) { ctx.say(e.message, true); return false; }
    const where = staves(st, r, last), pages = new Set(where.map(v => v.page));
    const seen = r.staves.length === 1 && where.length > 1 ? await seenOf(where) : null;
    if (!staffOf(st.id)) return false;
    const before = pages.size > 1 || !pages.has(ctx.state.page) ? snapshotAll() : snapshot();
    letGo();
    const n = put(st, r, last, seen);
    commit(before);
    draw();
    const name = r.headers.name ? `${r.headers.name}: ` : '';
    if (r.staves.length > n)
      ctx.say(`${name}placed on ${n} ${n === 1 ? 'staff' : 'staves'}, but it has ${r.staves.length} lines; the last ${r.staves.length - n} had no staff below to go on. Mark more staves and place it again.`, true);
    else ctx.say(`${name}placed on ${n === 1 ? 'the staff' : `${n} staves`}${pages.size > 1 ? ` over ${pages.size} pages` : ''}${r.staves.length === 1 && n > 1 ? (seen ? ', its lines broken where the page seems to break them (check them)' : ', spread over them as the page has it (check the line breaks)') : ''}. Hold H to compare it with the page.`);
    return true;
  }
  // the staves a chant (read from GABC) goes on from staff st, in the book's order, with their pages: one per line of
  // the GABC, if it has line breaks; else (as GregoBase gives it) all the chant's staves, down to where the next chant
  // begins, but no further than page last (from 0; if not given, the page it begins on, unless a chant is marked as
  // beginning further on)
  function staves(st, r, last) {
    const order = bookStaves(), from = order.findIndex(v => v.staff === st);
    if (r.staves.length > 1) return order.slice(from, from + r.staves.length);
    if (last === undefined) last = order.slice(from + 1).some(v => v.staff.begins === true) ? Infinity : order[from].page;
    let to = from + 1;
    // (a staff another chant begins part way along: this one ends on it, at that point)
    while (to < order.length && order[to].staff.begins !== true && order[to].page <= last) { to++; if (typeof order[to - 1].staff.beginsAt === 'number') break; }
    return order.slice(from, to);
  }
  // the part of a staff a chant placed on staves goes on: [from, to] across it. On a staff a chant begins part way
  // along (beginsAt): from that point, for the chant that begins there (the first of its staves); up to it, for one
  // that runs on to it from the staves before.
  function span(staff, first) {
    const xs = S.xsOf(staff.lines[0]);
    let a = xs[0], b = xs[xs.length - 1];
    if (typeof staff.beginsAt === 'number') { if (first) a = staff.beginsAt; else b = staff.beginsAt; }
    return [a, b];
  }
  // a staff's lines cut to run from xa to xb only
  function cut(lines, xa, xb) {
    return S.atXs(lines, [xa, ...S.xsOf(lines[0]).filter(x => x > xa + 1 && x < xb - 1), xb]);
  }
  // the chant put on those staves (spread over them as printed, if it has no line breaks) and listed in the
  // document's chants (taken off any chant they were part of); no undo recorded. Returns how many staves it went on.
  function put(st, r, last, seen) {
    let targets = staves(st, r, last).map(v => v.staff), lines;
    // the part of each staff it goes on (all of it, but where a chant begins part way along one)
    const spans = targets.map((t, k) => span(t, k === 0)), cuts = targets.map((t, k) => cut(t.lines, ...spans[k]));
    const whole = targets.map((t, k) => typeof t.beginsAt !== 'number');
    if (r.staves.length > 1) lines = r.staves.map(v => v.syllables);
    else if (targets.length > 1) {
      const syls = r.staves[0].syllables, starts = seen && seen.length === targets.length ? N.breaks(syls, seen) : null;
      lines = N.spread(syls, cuts, starts || undefined);
    } else lines = [r.staves[0].syllables];
    const startsAt = typeof st.beginsAt === 'number' ? st.beginsAt : null;
    targets.forEach((t, k) => {
      const mine = JSON.parse(JSON.stringify(lines[k]));
      N.place({ lines: cuts[k], syllables: mine });
      // on a staff it shares, the other chant's syllables (those outside its part) kept
      const [a, b] = spans[k], kept = whole[k] ? [] : t.syllables.filter(syl => { const x = C.sylX(syl); return x !== null && (x < a - 0.5 || x >= b - 0.5); });
      // (in order along the staff: the kept ones before this chant's, or after)
      t.syllables = !kept.length ? mine : k === 0 ? kept.concat(mine) : mine.concat(kept);
    });
    const ids = targets.map(t => t.id), shared = new Set(targets.filter((t, k) => !whole[k]).map(t => t.id));
    for (const c of ctx.state.doc.chants) c.staves = (c.staves || []).filter(id => {
      if (!ids.includes(id)) return true;
      if (!shared.has(id)) return false;
      // a shared staff stays with the chant on its other part: the one before the point, if this one begins there
      const begins = typeof c.startsAt === 'number' && c.staves[0] === id;
      return id === st.id && startsAt !== null ? !begins : begins;
    });
    ctx.state.doc.chants = ctx.state.doc.chants.filter(c => c.staves.length);
    ctx.state.doc.chants.push(Object.assign({ headers: r.headers, staves: ids }, startsAt !== null ? { startsAt } : {}));
    return targets.length;
  }
  // a chant begins part way along the selected staff, at x (or no longer, with x null): marked, or the mark taken off
  function beginsAt(x) {
    const st = staffOf(selected);
    if (!st) return;
    const before = snapshot();
    if (x === null) delete st.beginsAt; else st.beginsAt = Math.round(x * 100) / 100;
    commit(before);
    draw();
    ctx.say(x === null ? 'The mark is off this staff.' : 'A chant begins here, part way along the staff: select the staff and place the chant (it goes on from the mark), and a chant placed on the staves before ends at it.');
  }

  // What each of these staves ({ staff, page }) carries, read from the page's ink (S.carries): for finding where a
  // chant's lines break. A staff that can't be read gives null.
  async function seenOf(list) {
    const out = new Array(list.length).fill(null), pages = [...new Set(list.map(v => v.page))];
    for (const pg of pages) {
      let px;
      try { px = await ctx.pixels(pg); } catch (e) { continue; }
      list.forEach((v, k) => { if (v.page === pg) out[k] = S.carries(px.gray, px.w, px.h, v.staff.lines.map(l => l.map(u => u * px.scale))); });
    }
    return out;
  }
  // The chant on the selected staff given its line breaks again, read from the page: its syllables gathered from all
  // its staves and spread over them anew (what was lined up by hand on them is laid out afresh).
  async function readBreaks() {
    const st = staffOf(selected), chant = st && ctx.state.doc.chants.find(c => c.staves.includes(st.id));
    if (!chant || chant.staves.length < 2) { ctx.say(chant ? 'This chant is on one staff: it has no line breaks.' : 'Select a staff with a chant on it.', true); return; }
    const order = bookStaves(), list = chant.staves.map(id => order.find(v => v.staff.id === id)).filter(Boolean);
    const seen = await seenOf(list);
    const syls = N.gather(list.map(v => v.staff.syllables)), starts = N.breaks(syls, seen);
    if (!starts) { ctx.say('Couldn\'t read where this chant\'s lines break from the page.', true); return; }
    const before = snapshotAll();
    letGo();
    const parts = N.spread(syls, list.map(v => v.staff.lines), starts);
    list.forEach((v, k) => { v.staff.syllables = parts[k]; N.place(v.staff); });
    commit(before);
    draw();
    ctx.say(`Its line breaks read from the page${new Set(list.map(v => v.page)).size > 1 ? ', over the page turn' : ''}. Check them; [ and ] move one.`);
  }

  // ---------------------------------------------------------------- the recognizer
  // The notes read off a staff (recognizer.js). On a staff without chant, they are put on it, a neume to a syllable,
  // each where it was seen. On a staff with chant (placed from GABC), what was read is lined up with what is there,
  // neume by neume: each neume moved to where it was seen; where the two differ, the neume is marked doubtful and
  // what was read kept with it (read), to be looked at. Returns what it did, or null (and says why).
  async function readStaff(st, pg = ctx.state.page) {
    let px, got;
    try { px = await ctx.pixels(pg); got = await R.read(px, st.lines, ctx.model ? ctx.model() : 'auto'); }
    catch (e) { ctx.say(`Couldn't read the notes: ${e.message || e}`, true); return null; }
    const items = st.syllables.flatMap((syl, s) => syl.items.map((it, i) => ({ it, s, i })));
    let same = 0, differ = 0, unseen = 0, extra = 0;
    if (!items.length) {
      st.syllables = got.map(v => ({ text: '', items: [{ g: v.g, box: [v.x0, 0, v.x1 - v.x0, 0], conf: v.conf }] }));
      for (const syl of st.syllables) N.fitBox(st, syl.items[0]);
      return { put: got.length };
    }
    const pairs = lineUp(items.map(v => v.it.g), got.map(v => v.g));
    for (const [a, b] of pairs) {
      if (a === null) { extra++; continue; }
      const it = items[a].it;
      if (b === null) { it.conf = 0.3; it.read = ''; unseen++; continue; }
      const v = got[b];
      if (it.box) { it.box[0] = v.x0; N.fitBox(st, it); }
      if (notesOf(it.g) === notesOf(v.g)) { it.conf = v.conf; delete it.read; same++; }
      else { it.conf = Math.min(0.4, v.conf); it.read = v.g; differ++; }
    }
    return { same, differ, unseen, extra };
  }
  // a group's notes, for comparing: letters, shapes and accidentals, without the breaks between glyphs and the marks
  const notesOf = g => String(g).replace(/[\/! .'_0-9]/g, '');
  // two lists of GABC groups lined up (global alignment): [[i or null, j or null], ...]; groups pair the more
  // readily the more of their notes agree
  function lineUp(a, b) {
    const n = a.length, m = b.length, gap = 1;
    const cost = (x, y) => { const p = notesOf(x), q = notesOf(y); if (p === q) return 0; const d = editDistance(p, q); return Math.min(2 * gap - 0.01, 0.2 + d / Math.max(p.length, q.length, 1) * 1.6); };
    const D = Array.from({ length: n + 1 }, (_, i) => new Float64Array(m + 1).fill(0).map((_, j) => i === 0 ? j * gap : j === 0 ? i * gap : 0));
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j] + gap, D[i][j - 1] + gap, D[i - 1][j - 1] + cost(a[i - 1], b[j - 1]));
    const out = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && Math.abs(D[i][j] - (D[i - 1][j - 1] + cost(a[i - 1], b[j - 1]))) < 1e-9) { out.push([i - 1, j - 1]); i--; j--; }
      else if (i > 0 && Math.abs(D[i][j] - (D[i - 1][j] + gap)) < 1e-9) { out.push([i - 1, null]); i--; }
      else { out.push([null, j - 1]); j--; }
    }
    return out.reverse();
  }
  function editDistance(p, q) {
    const d = Array.from({ length: q.length + 1 }, (_, j) => j);
    for (let i = 1; i <= p.length; i++) {
      let prev = d[0]; d[0] = i;
      for (let j = 1; j <= q.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (p[i - 1] === q[j - 1] ? 0 : 1)); prev = t; }
    }
    return d[q.length];
  }
  // the selected staff, or every staff on the page, read; one undo
  // the selected staff, or every staff on the page, read: chant staves by the chant recognizer, mensural ones by the
  // mensural reader (their items replaced by what it reads, each with how sure it is); one undo
  async function readNotes(all) {
    const chosen = all ? page().staves.slice() : [staffOf(selected)].filter(Boolean);
    if (!chosen.length) { ctx.say(all ? 'No staves on this page: find them first.' : 'Select a staff first.', true); return; }
    const list = chosen.filter(st => !mensural(st)), mlist = chosen.filter(mensural);
    if (busy) return;
    busy = true;
    ctx.say('Reading the notes … (the first time, the recognizer is loaded)');
    const before = snapshot(), pg = ctx.state.page, tally = { put: 0, same: 0, differ: 0, unseen: 0, extra: 0 };
    let ok = 0, mok = 0, mitems = 0, mdoubt = 0;
    for (const st of list) {
      const r = await readStaff(st, pg);
      if (!r) break;
      ok++;
      for (const k in r) tally[k] += r[k];
    }
    for (const st of mlist) {
      let got;
      try { got = await R.readMensural(await ctx.pixels(pg), st.lines); }
      catch (e) { ctx.say(`Couldn't read the mensural notation: ${e.message || e}`, true); break; }
      st.mensural = got.map(v => Object.assign(v.item, v.conf < 1 ? { conf: v.conf } : {}));
      mok++; mitems += got.length; mdoubt += got.filter(v => v.conf < DOUBT).length;
    }
    busy = false;
    if (!ok && !mok) { info(); return; }
    commit(before);
    letGo();
    draw();
    const said = [];
    if (ok) {
      const parts = [];
      if (tally.put) parts.push(`${tally.put} neumes read onto ${list.length === 1 ? 'the staff' : 'staves without chant'}`);
      if (tally.same + tally.differ + tally.unseen) parts.push(`of the chant's neumes, ${tally.same} read as written, ${tally.differ} read otherwise, ${tally.unseen} not seen`);
      if (tally.extra) parts.push(`${tally.extra} more seen on the page than the chant has`);
      said.push(`${ok === 1 ? 'Staff' : `${ok} staves`} read: ${parts.join('; ') || 'nothing found'}. Where they differ, the neume is marked in orange; select it to see what was read.`);
    }
    if (mok) said.push(`${mok === 1 ? 'Mensural staff' : `${mok} mensural staves`} read: ${mitems} items${mdoubt ? `, ${mdoubt} of them doubtful (in orange)` : ''}. Correct what is wrong; an item changed is taken as right.`);
    ctx.say(said.join(' '));
  }

  // ---------------------------------------------------------------- the words under the notes
  // The letters read under a staff (CGRecognizer.readText) put into its syllables. The words (between spaces) are
  // broken into syllables as the books break Latin (CGChant.syllables), each placed where its vowel was read; a mark
  // standing alone (: * †) goes with what's before it. Then each goes to a syllable with neumes, in order, the one
  // whose first note its vowel lies nearest (several to one if need be, but dearly). A syllable of neumes left
  // without words is sung to the one before (a melisma): its neumes go into that one. Only a staff whose syllables
  // have no words yet. Returns how many syllables got words.
  function wordsInto(st, letters, sp) {
    const words = [];
    let cur = null;
    for (const l of letters.concat([{ t: ' ' }])) {
      if (l.t === ' ') { if (cur) words.push(cur); cur = null; continue; }
      if (!cur) cur = [];
      cur.push(l);
    }
    const marks = [];
    for (const w of words) {
      const text = w.map(l => l.t).join('');
      if (!/[\p{L}\p{N}]/u.test(text)) { if (marks.length) marks[marks.length - 1].text += ' ' + text; continue; }
      let k = 0;
      C.syllables(text).forEach((sy, j) => {
        const ls = w.slice(k, k + sy.length); k += sy.length;
        const v = ls.find(l => /[aeiouyáéíóúýæœǽ]/i.test(l.t)) || ls[0];
        marks.push({ text: sy, x0: v.x, x1: v.x, word: j === 0 });
      });
    }
    const sylls = st.syllables.map((syl, s) => ({ s, it: syl.items.find(v => v.box && C.kind(v.g) === 'neume') })).filter(v => v.it);
    if (!marks.length || !sylls.length) return 0;
    // (order kept, each chunk to a syllable at or after the last one's: the nearest overall)
    // (where the reader places a letter runs about a staff space left of the note it's under: measured on the
    // Graduale's pages, a syllable's vowel against its neume's left edge)
    const cost = (c, v) => Math.abs(v.it.box[0] - sp - c.x0);
    const n = marks.length, S = sylls.length, INF = 1e18, d = Array.from({ length: n }, () => new Float64Array(S).fill(INF)), from = Array.from({ length: n }, () => new Int32Array(S).fill(-1));
    for (let k = 0; k < S; k++) d[0][k] = cost(marks[0], sylls[k]);
    for (let c = 1; c < n; c++) {
      let best = INF, arg = -1;
      for (let k = 0; k < S; k++) {
        const same = d[c - 1][k] + 3 * sp;                       // (two syllables to one neume: allowed, but dear)
        if (best + cost(marks[c], sylls[k]) < same + cost(marks[c], sylls[k])) { d[c][k] = best + cost(marks[c], sylls[k]); from[c][k] = arg; }
        else { d[c][k] = same + cost(marks[c], sylls[k]); from[c][k] = k; }
        if (d[c - 1][k] < best) { best = d[c - 1][k]; arg = k; }
      }
    }
    let k = 0;
    for (let j = 1; j < S; j++) if (d[n - 1][j] < d[n - 1][k]) k = j;
    const to = new Array(n);
    for (let c = n - 1; c >= 0; c--) { to[c] = k; k = from[c][k]; }
    const got = new Map();
    marks.forEach((c, j) => { const s = sylls[to[j]].s; if (!got.has(s)) got.set(s, []); got.get(s).push(c); });
    for (const [s, cs] of got) {
      const syl = st.syllables[s];
      syl.text = cs.map((c, j) => (j && c.word ? ' ' : '') + c.text).join('');
      syl.join = !cs[0].word;
      delete syl.checked;
    }
    // melismas: a syllable of neumes alone, after words, into the one before
    const first = Math.min(...got.keys());
    for (let s = st.syllables.length - 1; s > first; s--) {
      const syl = st.syllables[s];
      if (!syl.text && syl.items.length && syl.items.every(v => ['neume', 'accidental'].includes(C.kind(v.g)))) {
        st.syllables[s - 1].items.push(...syl.items);
        st.syllables.splice(s, 1);
      }
    }
    return got.size;
  }
  // The words under the selected staff (all: every staff on the page) read and put under its notes: staves with
  // notes and no words yet. One undo for all of it.
  async function readWords(all) {
    const list = (all ? page().staves.slice() : [staffOf(selected)].filter(Boolean));
    if (!list.length) { ctx.say(all ? 'No staves on this page: find them first.' : 'Select a staff first.', true); return; }
    const todo = list.filter(st => st.syllables.some(y => y.items.some(v => C.kind(v.g) === 'neume')) && !st.syllables.some(y => y.text));
    if (!todo.length) { ctx.say(list.some(st => st.syllables.some(y => y.text)) ? 'These staves have their words already.' : 'Read the notes first: the words go under them.', true); return; }
    if (busy) return;
    busy = true;
    ctx.say('Reading the words … (the first time, the text reader is loaded)');
    const before = snapshot(), pg = ctx.state.page;
    let n = 0, done = 0;
    try {
      const px = await ctx.pixels(pg);
      for (const st of todo) { const r = await R.readText(px, st.lines); n += wordsInto(st, r.letters, r.space); done++; }
    } catch (e) { ctx.say(`Couldn't read the words: ${e.message || e}`, true); }
    busy = false;
    if (done) { commit(before); letGo(); draw(); ctx.say(`Words read under ${done === 1 ? 'the staff' : `${done} staves`}: ${n} syllables. Check them: click a word to correct it.`); }
    else info();
  }

  // ---------------------------------------------------------------- a book's chants, from its index
  // The book's index (GregoBase's, made by training/gregobase.py book): its pages, as numbered, and the chants on
  // each in order, with how many pages each runs over. doc.book.first: the scan's page (from 0) that is the index's
  // first page. The book's page shown, by its number; and the chants that begin on it.
  function bookPage(pg = ctx.state.page) {
    const idx = ctx.state.book, b = ctx.state.doc.book;
    if (!idx || !b) return null;
    const k = pg - b.first;
    return k >= 0 && k < idx.pages.length ? { k, label: idx.pages[k], chants: idx.chants.filter(c => c.page === idx.pages[k]) } : null;
  }
  // a chant of the index as GABC, with headers saying where it comes from
  function gabcOf(c) {
    const own = /^%%\s*$/m.exec(c.gabc), head = own ? c.gabc.slice(0, own.index) : '', body = own ? c.gabc.slice(own.index + own[0].length) : c.gabc;
    const h = { name: c.incipit, 'office-part': c.office_part, mode: c.mode, gregobase: c.id };
    // (GABC that has headers of its own keeps them; those it lacks are added)
    const add = Object.entries(h).filter(([k, v]) => v && !new RegExp(`^\\s*${k}\\s*:`, 'm').test(head)).map(([k, v]) => `${k}: ${v};`);
    return add.concat(head.trim() ? [head.trim()] : []).join('\n') + '\n%%\n' + body.replace(/^\s*\n/, '');
  }
  // where chants begin on page pg, from the index where it can say: the first staff begins one unless a chant runs
  // on onto the page from the one before; the others, where they are set in for an initial. Only on a page where
  // nothing is marked yet.
  function markBeginnings(pg) {
    const doc = ctx.state.doc, list = doc.pages[pg].staves, bp = bookPage(pg), idx = ctx.state.book;
    if (!list.length || list.some(s => s.begins !== undefined)) return;
    const ids = new Set(S.beginnings(doc.pages.filter(p => p.staves.length)));
    list.forEach(s => { s.begins = ids.has(s.id); });
    if (bp) {
      const at = new Map(idx.pages.map((p, i) => [p, i]));
      list[0].begins = !idx.chants.some(c => at.get(c.page) < bp.k && at.get(c.page) + (c.extent || 1) - 1 >= bp.k);
    }
  }
  // The chants the index lists for the page shown, placed on it: its staves found if not yet marked, and where chants
  // begin; each chant on the next staff where one begins, in order, spread over its staves (over the next pages too,
  // their staves found, if it runs on). One undo for all of it.
  async function placePage() {
    const doc = ctx.state.doc, pg = ctx.state.page, bp = bookPage();
    if (!bp) { ctx.say(ctx.state.book ? 'This scan page isn\'t one of the book\'s pages: say which page of the book it is.' : 'Open the book\'s index first.', true); return; }
    if (busy) return;
    if (!bp.chants.length) { ctx.say(`The index lists no chant beginning on page ${bp.label}.`); return; }
    busy = true;
    const before = snapshotAll();
    try {
      const reach = Math.max(0, ...bp.chants.map(c => (c.extent || 1) - 1));
      for (let q = pg; q <= Math.min(doc.pages.length - 1, pg + reach); q++) {
        if (!doc.pages[q].staves.length) {
          ctx.say(`Finding the staves on page ${q + 1} …`);
          addFound(q, await findOn(q));
        }
        markBeginnings(q);
      }
      const starts = doc.pages[pg].staves.filter(s => s.begins === true);
      const n = Math.min(starts.length, bp.chants.length), bad = [];
      letGo();
      for (let i = 0; i < n; i++) {
        try {
          const r = C.fromGabc(gabcOf(bp.chants[i])), last = pg + (bp.chants[i].extent || 1) - 1, where = staves(starts[i], r, last);
          put(starts[i], r, last, r.staves.length === 1 && where.length > 1 ? await seenOf(where) : null);
        } catch (e) { bad.push(`${bp.chants[i].incipit}: ${e.message}`); }
      }
      // then, if there is a recognizer, the notes read and compared, so the places to look at are marked
      let compared = null;
      if (await R.load().then(() => true, () => false)) {
        compared = { differ: 0, unseen: 0, staves: 0 };
        ctx.say(`Page ${bp.label}: reading the notes …`);
        for (const st of doc.pages[pg].staves.filter(t => t.syllables.length)) {
          const r = await readStaff(st, pg);
          if (!r) break;
          compared.staves++; compared.differ += r.differ || 0; compared.unseen += r.unseen || 0;
        }
      }
      commit(before);
      if (starts[0]) selected = starts[0].id;
      draw();
      const names = bp.chants.slice(0, n).map(c => c.incipit).join(', ');
      let msg = `Page ${bp.label}: ${n} ${n === 1 ? 'chant' : 'chants'} placed (${names}).`;
      if (starts.length < bp.chants.length) msg += ` The index lists ${bp.chants.length}, but ${starts.length} ${starts.length === 1 ? 'staff is' : 'staves are'} marked where a chant begins: mark the others (B) and place again, or place the rest from the list.`;
      else if (starts.length > bp.chants.length) msg += ` ${starts.length - bp.chants.length} more ${starts.length - bp.chants.length === 1 ? 'staff is' : 'staves are'} marked where a chant begins than the index has chants: check the marks (B).`;
      else msg += ' Check the line breaks ([ and ]), then the neumes.';
      if (bad.length) msg += ` Couldn't read: ${bad.join('; ')}.`;
      if (compared) msg += ` The page read: ${compared.differ + compared.unseen ? `${compared.differ + compared.unseen} ${compared.differ + compared.unseen === 1 ? 'neume differs' : 'neumes differ'} from GregoBase, marked in orange` : 'every neume as GregoBase has it'}.`;
      ctx.say(msg, starts.length !== bp.chants.length || bad.length > 0);
    } catch (e) { restore(before); draw(); ctx.say(`Couldn't place the page's chants: ${e.message || e}`, true); }
    busy = false;
    info();
  }
  // one chant of the index placed on the selected staff (from the list of the page's chants)
  function placeOne(id) {
    const c = ctx.state.book && ctx.state.book.chants.find(v => v.id === id);
    return c ? placeChant(gabcOf(c), ctx.state.page + (c.extent || 1) - 1) : Promise.resolve(false);
  }

  // every staff of the book in order, with its page
  const bookStaves = () => ctx.state.doc.pages.flatMap((p, k) => p.staves.map(staff => ({ staff, page: k })));

  // ---------------------------------------------------------------- where chants begin
  // Marked on the staves: begins true (a chant begins on it), false (not, said by hand), or not said. Found in the book
  // from indented first staves (S.beginnings), where not said already.
  function findBeginnings() {
    const doc = ctx.state.doc, ids = new Set(S.beginnings(doc.pages));
    if (!bookStaves().length) { ctx.say('Find the staves first.', true); return; }
    const before = snapshotAll();
    let n = 0;
    for (const { staff } of bookStaves()) if (staff.begins === undefined && ids.has(staff.id)) { staff.begins = true; n++; }
    commit(before);
    draw();
    const all = bookStaves().filter(v => v.staff.begins === true).length;
    ctx.say(`${all} ${all === 1 ? 'chant begins' : 'chants begin'} in the book${n < all ? ` (${n} found now)` : ''}, at the staves set in for their initials. Check them: select a staff and press B (or the box in the Chant panel) to mark or unmark one.`);
  }
  function toggleBegins(on) {
    const st = staffOf(selected);
    if (!st) return;
    const before = snapshot();
    st.begins = on === undefined ? st.begins !== true : !!on;
    commit(before);
    draw();
  }

  // ---------------------------------------------------------------- line breaks
  // The selected syllable (or the selected neume's) moved to the next line, with everything after it on its line
  // (dir 1), or to the line before, with everything before it (dir -1): as a printed chant's lines break. Only within
  // its chant. Both lines are laid out again (what was lined up on them by hand, not), and each line's custos made to
  // point to the next line's first note again.
  const only = (syl, kind) => !syl.text && syl.items.length && syl.items.every(it => C.kind(it.g) === kind);
  function moveLine(dir) {
    const st = staffOf(selected), s = word !== null ? word : item ? item.s : null;
    if (!st || s === null) { ctx.say('Select the syllable (or a neume of it) where the line should break.'); return; }
    const order = bookStaves(), at = order.findIndex(v => v.staff === st), other = order[at + dir];
    const chant = ctx.state.doc.chants.find(c => c.staves.includes(st.id));
    if (!other || !chant || !chant.staves.includes(other.staff.id)) { ctx.say(`This is the chant's ${dir > 0 ? 'last' : 'first'} line.`); return; }
    const sy = st.syllables;
    let lead = 0, tail = sy.length;
    while (lead < sy.length && only(sy[lead], 'clef')) lead++;
    while (tail > lead && only(sy[tail - 1], 'custos')) tail--;
    if (s < lead || s >= tail) { ctx.say('Select a syllable of the chant, not the clef or the custos.'); return; }
    if ((dir > 0 && s === lead) || (dir < 0 && s === tail - 1)) { ctx.say('That would leave this line empty.'); return; }
    const before = other.page === ctx.state.page ? snapshot() : snapshotAll();
    const moving = dir > 0 ? sy.slice(s, tail) : sy.slice(lead, s + 1);
    st.syllables = dir > 0 ? sy.slice(0, s).concat(sy.slice(tail)) : sy.slice(0, lead).concat(sy.slice(s + 1));
    const os = other.staff.syllables;
    if (dir > 0) { let k = 0; while (k < os.length && only(os[k], 'clef')) k++; os.splice(k, 0, ...moving); }
    else { let k = os.length; while (k > 0 && only(os[k - 1], 'custos')) k--; os.splice(k, 0, ...moving); }
    for (const t of [st, other.staff]) {
      for (const syl of t.syllables) { delete syl.box; syl.items.forEach(it => delete it.box); }
      N.place(t);
    }
    const [a, b] = dir > 0 ? [st, other.staff] : [other.staff, st];
    custos(a, b);
    // and the line before the pair, whose custos points into it
    const prev = order[order.findIndex(v => v.staff === a) - 1];
    if (prev && chant.staves.includes(prev.staff.id)) custos(prev.staff, a);
    letGo();
    commit(before);
    if (other.page !== ctx.state.page) { selected = other.staff.id; ctx.show(other.page); } else draw();
    ctx.say(`Moved to the ${dir > 0 ? 'next' : 'previous'} line. Both lines are laid out afresh.`);
  }
  // a line's custos made to point to the next line's first note
  function custos(a, b) {
    const last = a.syllables[a.syllables.length - 1];
    if (!last || !only(last, 'custos')) return;
    let clefA = null, clefB = null, first = null;
    for (const syl of a.syllables) for (const it of syl.items) if (C.kind(it.g) === 'clef') clefA = it.g;
    clefB = clefA;
    for (const syl of b.syllables) for (const it of syl.items) {
      if (first) break;
      const kd = C.kind(it.g);
      if (kd === 'clef') clefB = it.g;
      else if (kd === 'neume' || kd === 'accidental') { const n = C.notes(it.g).find(x => !x.acc); if (n) first = n.p; }
    }
    const g = first && clefA && N.custosFor(first, clefB, clefA);
    if (g && g !== last.items[0].g) { last.items[0].g = g; N.fitBox(a, last.items[0]); }
  }

  // the chant taken off the selected staff
  function clearChant() {
    const st = staffOf(selected);
    if (!st || !st.syllables.length) return;
    const before = snapshot();
    st.syllables = [];
    letGo();
    for (const c of ctx.state.doc.chants) c.staves = (c.staves || []).filter(id => id !== st.id);
    ctx.state.doc.chants = ctx.state.doc.chants.filter(c => c.staves.length);
    commit(before);
    draw();
  }

  // the chant the selected staff belongs to (or the first), in Volpiano; the page as MEI
  const chantHere = () => ctx.state.doc.chants.find(c => c.staves.includes(selected)) || ctx.state.doc.chants[0];
  function volpiano() { const c = chantHere(); return c ? X.volpiano(ctx.state.doc, c) : null; }
  function mei() {
    const doc = ctx.state.doc, pg = page();
    if (!pg.staves.length) { ctx.say('Mark the staves on this page first.', true); return null; }
    const base = (doc.source.name || 'chant').replace(/\.[^.]+$/, '').replace(/ \(.*$/, '');
    return { name: `${base}, page ${pg.n}.mei`, text: X.mei(doc, ctx.state.page) };
  }

  // The document's chants as GABC, one file each: the chants placed, and from the notes read on staves no chant is
  // placed on, a chant from each beginning marked (a staff that begins one, B; or part way along, where it's marked)
  // to the next, page after page, each as one line of GABC (the page's line breaks aren't the music's). opts: words,
  // lines (as toGabc). [{ name, text, staves }], in the book's order.
  function gabcFiles(opts = {}) {
    const doc = ctx.state.doc, base = (doc.source.name || 'chant').replace(/\.[^.]+$/, '').replace(/ \(.*$/, '');
    const pageOf = new Map(doc.pages.flatMap(p => p.staves.map(st => [st.id, p.n])));
    const placed = new Set(doc.chants.flatMap(c => c.staves));
    const parts = doc.chants.map(c => ({ chant: c, at: C.staves(doc).findIndex(st => st.id === c.staves[0]) }));
    let cur = null;
    C.staves(doc).forEach((st, k) => {
      if (placed.has(st.id) || !st.syllables.length) { if (placed.has(st.id)) cur = null; return; }
      if (!cur || st.begins === true) { cur = { chant: { headers: {}, staves: [] }, at: k }; parts.push(cur); }
      cur.chant.staves.push(st.id);
      if (typeof st.beginsAt === 'number') { cur = { chant: { headers: {}, staves: [st.id], startsAt: st.beginsAt }, at: k + 0.5 }; parts.push(cur); }
    });
    parts.sort((a, b) => a.at - b.at);
    const out = [];
    for (const part of parts) {
      const name = part.chant.headers.name || `${base}, p. ${pageOf.get(part.chant.staves[0])}, chant ${out.length + 1}`;
      const chant = Object.assign({}, part.chant, { headers: Object.assign({}, part.chant.headers, { name }) });
      const text = C.toGabc(doc, { chant, lines: !!opts.lines, words: opts.words !== false });
      if (!/\(/.test(text.slice(text.indexOf('%%')))) continue;     // (nothing of it read: the part of a staff before a mark, say)
      out.push({ name: chant.headers.name, text, staves: chant.staves });
    }
    return out;
  }
  // the chant the selected staff is in (or the first) as GABC; null, and said, if there's nothing to save
  function gabc(opts = {}) {
    const files = gabcFiles(opts);
    if (!files.length) { ctx.say('Nothing to save yet: read the notes or place a chant first.', true); return null; }
    return files.find(f => f.staves.includes(selected)) || files[0];
  }

  // a bend added where a staff is double-clicked; a bend's bar double-clicked takes it away
  // a double click: on a note (a mensural item, a neume), played from there, as Serenissima Press plays from a note
  // clicked; on a staff's line, a bend added there (or taken off, on a bend's knot)
  function dbl(e) {
    const t = e.target.closest('[data-act]');
    if (!t || !t.dataset.staff) return;
    if (t.dataset.act === 'mitem' || t.dataset.act === 'neume') { const f = playFrom(); if (f) listen(f); return; }
    const st = staffOf(t.dataset.staff);
    if (!st) return;
    const before = snapshot();
    if (t.dataset.act === 'knot') st.lines = S.removeBend(st.lines, +t.dataset.knot);
    else st.lines = S.addBend(st.lines, at(e)[0]);
    settle(st);
    selected = st.id;
    commit(before);
    draw();
  }

  // ---------------------------------------------------------------- the right-click menu
  // What's under the pointer selected, and what can be done with it offered (app.js shows the menu): a neume, a
  // syllable's words, a staff, or the page.
  const SHAPES = [['punctum', 'Punctum'], ['virga', 'Virga'], ['inclinatum', 'Inclinatum'], ['quilisma', 'Quilisma'], ['oriscus', 'Oriscus']];
  function contextMenu(e) {
    if (!ctx.state.doc || !ctx.menu) return;
    e.preventDefault();
    const t = e.target.closest('[data-act]'), act = t ? t.dataset.act : 'page', p = at(e), x = e.clientX, y = e.clientY;
    if (act === 'alert') { goTo(alerts[+t.dataset.k]); return; }
    if (act === 'area') { const r = (page().regions || [])[+t.dataset.k]; if (r) areaMenu(r, x, y, false); return; }
    if (act === 'mitem') {
      selected = t.dataset.staff; item = null; word = null;
      const st = staffOf(selected), i = +t.dataset.i, it = st.mensural[i];
      mitem = { i, n: it.k === 'lig' ? ligNote(st, i, p[0]) : null };
      draw();
      const v = it.k === 'lig' ? it.notes[mitem.n].v : it.v, inLig = it.k === 'lig', valued = it.k === 'note' || it.k === 'rest' || inLig;
      const values = (inLig ? ['Mx', 'L', 'B', 'Sb'] : VALUE_KEYS).map(w => ({ label: w, on: v === w, title: `${VALUE_NAMES[w]} (${DIGIT_OF[w]})`, run: () => mValue(w) }));
      ctx.menu([
        { title: mDescribe(st, it) },
        valued ? { shapes: values } : null,
        it.k === 'note' ? { label: it.color === 'black' ? 'Black (coloured) ✓' : 'Black (coloured)', key: 'K', run: () => mBlack() } : null,
        inLig && mitem.n !== null ? { label: it.color === 'black' || it.notes[mitem.n].color === 'black' ? 'This note black (coloured) ✓' : 'This note black (coloured)', key: 'K', run: () => mBlack() } : null,
        inLig ? { label: it.color === 'black' ? 'All of it black ✓' : 'All of it black', run: () => mBlack(true) } : null,
        it.k === 'note' && !/^(B|Sb)$/.test(it.v) ? { label: 'Turn its stem', key: 'S', run: mStem } : null,
        it.k === 'note' ? { label: 'Make it a rest', key: 'R', run: mRest } : it.k === 'rest' ? { label: 'Make it a note', key: 'R', run: mRest } : null,
        it.k === 'rest' && it.v === 'L' ? { label: it.perf ? 'Perfect (three spaces) ✓' : 'Perfect (three spaces)', run: () => mChange(r => { if (r.perf) delete r.perf; else r.perf = true; }) } : null,
        it.k === 'sign' ? { shapes: [['O', 'O'], ['C', 'C'], ['R', 'Ɔ']].map(([w, lab]) => ({ label: lab, on: it.sign === w, run: () => mChange(r => { r.sign = w; }) })) } : null,
        it.k === 'sign' ? { label: it.dot ? 'With a dot ✓' : 'With a dot', run: () => mChange(r => { if (r.dot) delete r.dot; else r.dot = true; }) } : null,
        it.k === 'sign' ? { label: it.stroke ? 'Struck through ✓' : 'Struck through', run: () => mChange(r => { if (r.stroke) delete r.stroke; else r.stroke = true; }) } : null,
        it.k === 'clef' ? { shapes: ['C', 'F', 'G'].map(w => ({ label: w, on: it.shape === w, run: () => mChange(r => { r.shape = w; }) })) } : null,
        it.k === 'acc' ? { shapes: [['b', '♭'], ['n', '♮'], ['#', '♯']].map(([w, lab]) => ({ label: lab, on: it.a === w, run: () => mChange(r => { r.a = w; }) })) } : null,
        it.k === 'bar' ? { shapes: [['single', '|'], ['double', '||'], ['end', '|||']].map(([w, lab]) => ({ label: lab, on: it.form === w, run: () => mChange(r => { r.form = w; }) })) } : null,
        '-',
        it.k === 'note' || inLig ? { label: 'Add a dot after it', key: '.', run: mDot } : null,
        it.k === 'note' || inLig ? { label: 'Join to the next in a ligature', key: 'J', disabled: !st.mensural[i + 1], run: mJoin } : null,
        inLig ? { label: it.notes[mitem.n].obl ? 'Oblique with the next ✓' : 'Oblique with the next', key: 'O', disabled: mitem.n >= it.notes.length - 1, run: mOblique } : null,
        inLig ? { label: 'Cut the ligature after this note', disabled: mitem.n >= it.notes.length - 1, run: mSplit } : null,
        { label: st.voice ? 'Play from here, every voice' : 'Play from here', key: 'Space', run: () => listen({ staff: st.id, i }) },
        st.voice ? { label: `Play the ${st.voice} alone from here`, run: () => listen({ staff: st.id, i }, true) } : null,
        { label: 'Delete', key: 'Del', run: mRemove },
      ].filter(Boolean), x, y);
      return;
    }
    if (act === 'neume') {
      selected = t.dataset.staff; item = { s: +t.dataset.s, i: +t.dataset.i }; word = null; mitem = null; draw();
      const st = staffOf(selected), it = itemOf(), kd = C.kind(it.g);
      const ns = kd === 'neume' ? C.notes(it.g).filter(n => !n.acc) : [];
      // the note under the pointer, whose shape the row sets
      const k = ns.length ? noteUnder(st, it, p) : 0, now = ns.length ? C.shapeOf(ns[k]) : null;
      const falls = ns.length >= 3 && ns.every((n, j) => !j || n.p < ns[j - 1].p);
      const nxt = st.syllables[item.s].items[item.i + 1];
      if (kd === 'clef') {
        const m = /^([cf])(b?)([1-5])$/.exec(it.g), clef = (c, n) => ({ label: `${c.toUpperCase()}${n}`, on: m[1] === c && +m[3] === n, title: `A ${c.toUpperCase()} clef on line ${n} (from the bottom)`, run: () => setItem(c + m[2] + n) });
        ctx.menu([
          { title: `Clef (${it.g})` },
          { shapes: [1, 2, 3, 4].map(n => clef('c', n)) },
          { shapes: [1, 2, 3, 4].map(n => clef('f', n)) },
          { label: m[2] ? 'Without its flat' : 'With a flat (B♭)', run: () => setItem(m[1] + (m[2] ? '' : 'b') + m[3]) },
          { label: 'Change its GABC…', key: 'G', run: () => focusItem() },
          '-',
          { label: 'Accept', key: 'Enter', run: acceptNeume },
          { label: 'Delete', key: 'Del', run: removeNeume },
        ], x, y);
        return;
      }
      ctx.menu([
        { title: `Neume (${it.g})${ns.length > 1 ? `, note ${k + 1} of ${ns.length}` : ''}` },
        ns.length ? { shapes: SHAPES.map(([sh, label]) => ({ label, on: now === sh, title: `This note as a ${sh}`, run: () => reshape(k, sh) })) } : null,
        falls ? { label: 'Climacus: the falling notes as diamonds', run: () => climacus() } : null,
        '-',
        ns.length > 1 ? { label: k ? `Split the neume before note ${k + 1}` : 'Split the neume (point at a later note)', disabled: !k, title: 'Two neumes from here: the notes before this one, and this one on', run: () => splitNeume(k) } : null,
        { label: 'Change its GABC…', key: 'G', run: () => focusItem() },
        { label: 'Join to the next neume', key: 'J', disabled: !nxt || kd !== 'neume' || C.kind(nxt.g) !== 'neume', title: 'This neume and the next one in the syllable as one', run: joinNext },
        { label: 'Play from here', key: 'Space', run: () => listen({ staff: st.id, s: item.s, i: item.i }) },
        { label: 'Accept', key: 'Enter', run: acceptNeume },
        { label: 'Next doubtful', key: 'Tab', run: () => nextNeume(1) },
        { label: st.syllables[item.s].text && item.i === 0 ? 'Change the text under it…' : 'Text under this neume…', key: 'T', title: 'Type the syllable sung to it (from this neume on, if its syllable began before)', run: textHere },
        { label: 'Part of the syllable before', disabled: item.s === 0 || item.i !== 0 || !!st.syllables[item.s].text, title: 'Sung to the syllable before: one syllable with its neumes (a melisma)', run: joinBack },
        { label: 'New syllable here', disabled: item.i === 0, run: splitHere },
        { label: 'Delete', key: 'Del', run: removeNeume },
        '-',
        { label: 'Accept the whole staff', key: 'Shift+Enter', run: acceptStaff },
      ], x, y);
      return;
    }
    if (act === 'syl') {
      selected = t.dataset.staff; word = +t.dataset.s; item = null; draw();
      ctx.menu([
        { title: `Syllable "${(sylOf().text || '').replace(/<[^>]*>/g, '')}"` },
        { label: 'Edit the text', run: () => { const f = document.getElementById('sylText'); if (f) { f.focus(); f.select(); } } },
        { label: 'Accept', key: 'Enter', run: acceptWord },
        { label: 'Join to the one before', disabled: word === 0, run: joinPrev },
        '-',
        { label: 'Move to the line before', key: '[', run: () => moveLine(-1) },
        { label: 'Move to the next line', key: ']', run: () => moveLine(1) },
      ], x, y);
      return;
    }
    if (act === 'body' || act === 'knot' || act === 'point') {
      letGo(); selected = t.dataset.staff; draw();
      const st = staffOf(selected), n = page().staves.indexOf(st) + 1, bent = S.count(st.lines[0]) > 2;
      ctx.menu([
        { title: `Staff ${n}` },
        { label: 'Read the notes', disabled: busy, title: mensural(st) ? 'Read by the mensural reader (models/mensural): what is on the staff is replaced' : '', run: () => readNotes(false) },
        mensural(st) ? null : { label: 'Read the words', disabled: busy || !st.syllables.length, title: 'Read the words under its notes', run: () => readWords(false) },
        { label: 'Play from this staff', disabled: mensural(st) ? !(st.mensural || []).length : !st.syllables.length, run: () => listen({ staff: st.id, s: 0, i: 0 }) },
        ...(mensural(st) ? [] : [
          { label: 'Accept the staff', key: 'Shift+Enter', disabled: !st.syllables.length, run: acceptStaff },
          { label: st.begins === true ? 'A chant begins on this staff ✓' : 'A chant begins on this staff', key: 'B', run: () => toggleBegins() },
          typeof st.beginsAt === 'number' ? { label: 'Take off the mid-line chant start', run: () => beginsAt(null) }
            : { label: 'A chant begins here, at this point', title: 'Part way along the staff, where you clicked (before an initial, say)', run: () => beginsAt(p[0]) },
        ]),
        '-',
        { label: mensural(st) ? (C.notationOf(ctx.state.doc) === 'mensural' ? 'Make it a chant staff' : 'Make it a chant staff again') : (C.notationOf(ctx.state.doc) === 'chant' ? 'Make it a mensural staff' : 'Make it a mensural staff again'), title: `Mark this staff as ${mensural(st) ? 'chant' : 'mensural notation'} (the document is ${C.notationOf(ctx.state.doc)})`, run: toggleNotation },
        // (on a mensural staff: which voice it is; played alone; a new item where the pointer is, at its height)
        ...(mensural(st) ? (() => {
          const names = [...new Set(['Cantus', 'Altus', 'Tenor', 'Bassus', ...M.voices(ctx.state.doc).map(v => v.voice).filter(Boolean)])];
          const { clefs } = M.clefsOf(ctx.state.doc), first = (st.mensural || []).find(it => it.k === 'clef');
          const mine = first ? first.shape.toLowerCase() + first.line : null, usual = st.voice && clefs.get(st.voice);
          const byClef = !st.voice && mine ? [...clefs].filter(([, c]) => c === mine).map(([v]) => v) : [];
          return [
            usual && mine && usual !== mine ? { label: `Use the ${st.voice}'s clef (${usual.toUpperCase()})`, title: `This staff begins with ${mine.toUpperCase()}; the ${st.voice}'s others with ${usual.toUpperCase()}. The notes stay where they are on the staff.`,
              run: () => { const b = snapshot(); first.shape = usual[0].toUpperCase(); first.line = +usual.slice(1); commit(b); draw(); ctx.say(`The clef is ${usual.toUpperCase()}, as the ${st.voice}'s.`); } } : null,
            byClef.length === 1 ? { label: `The ${byClef[0]}, by its clef (${mine.toUpperCase()})`, title: `No other voice has ${mine.toUpperCase()}`, run: () => setVoice(st, byClef[0]) } : null,
            { title: `Voice${st.voice ? `: ${st.voice}` : ''}` },
            { shapes: names.map(v => ({ label: v, on: st.voice === v, title: `This staff is the ${v}`, run: () => setVoice(st, v) }))
              .concat([{ label: 'Other…', title: 'Another name (Quintus, Sextus, Superius …)', run: () => { const v = global.prompt ? global.prompt('The voice\'s name', st.voice || '') : null; if (v !== null) setVoice(st, v); } },
                { label: 'None', on: !st.voice, run: () => setVoice(st, '') }]) },
            { label: 'Play this voice alone', disabled: !(st.mensural || []).length, run: () => listen({ staff: st.id, i: 0 }, true) },
          ];
        })() : []),
        ...(mensural(st) ? (() => {
          const here = mPos(st, p[0], p[1]), x0 = Math.round(p[0] * 10) / 10, add = it => () => mInsert(Object.assign({ x: x0 }, it));
          return [
            { title: 'Add here' },
            { shapes: VALUE_KEYS.map(w => ({ label: w, title: `A ${VALUE_NAMES[w].toLowerCase()} here`, run: add({ k: 'note', v: w, p: here }) })) },
            { shapes: [['Rest', { k: 'rest', v: 'Sb', p: 4 }], ['Clef', { k: 'clef', shape: 'C', line: Math.max(1, Math.min(5, Math.round(here / 2) + 1)) }], ['Sign', { k: 'sign', sign: 'O' }],
              ['Dot', { k: 'dot', p: here }], ['♭', { k: 'acc', a: 'b', p: here }], ['♯', { k: 'acc', a: '#', p: here }], ['Custos', { k: 'custos', p: here }], ['Bar', { k: 'bar', form: 'single' }], ['Signum', { k: 'congr', p: here }]]
              .map(([lab, it]) => ({ label: lab, run: add(it) })) },
          ];
        })() : []),
        '-',
        { label: 'Find its lines again', key: 'F', run: refit },
        { label: 'Space the lines evenly', key: 'E', run: evenly },
        { label: 'Straighten', disabled: !bent, run: straighten },
        mensural(st) ? { label: 'Take its notes off', disabled: !(st.mensural || []).length, run: () => { const b = snapshot(); st.mensural = []; commit(b); draw(); } }
          : { label: 'Take its chant off', disabled: !st.syllables.length, run: clearChant },
        { label: 'Delete the staff', key: 'Del', run: remove },
      ], x, y);
      return;
    }
    // the page (in a voice area: the area's menu)
    const hereArea = areaAt(page(), p[0], p[1]);
    if (selected) { selected = null; letGo(); draw(); }
    const list = page().staves, chantDoc = C.notationOf(ctx.state.doc) === 'chant';
    ctx.menu([
      ...(act === 'page' && hereArea ? [...areaItems(hereArea, false), '-'] : []),
      { title: `Page ${ctx.state.page + 1}${chantDoc ? '' : ' (mensural)'}` },
      chantDoc ? null : { label: 'Mark a voice area: a box', title: 'Drag a box round where one voice is on the page, then say which', run: () => setAreaTool('box') },
      chantDoc ? null : { label: 'Mark a voice area: freeform', title: 'Draw round where one voice is on the page, then say which', run: () => setAreaTool('free') },
      { label: 'Find the staves', disabled: busy, run: findHere },
      // (a book ruled evenly all down the page, the words on every fifth line: its staves aren't inked to be found)
      chantDoc && { label: `${ctx.state.doc.ruledEvenly ? '✓ ' : ''}Ruled evenly, words on every fifth line`, disabled: busy, run: () => {
        ctx.state.doc.ruledEvenly = !ctx.state.doc.ruledEvenly;
        ctx.say(ctx.state.doc.ruledEvenly ? 'Staves will be found as the four ruled lines above each row of words (a book ruled evenly all down the page, like Paris lat. 12044). Delete any found wrongly, then Find the staves.' : 'Staves will be found by their own lines again.');
      } },
      // (a book whose staves have five lines, as the later choirbooks do: found, drawn and read with five)
      chantDoc && { label: `${ctx.state.doc.fiveLines ? '✓ ' : ''}Five-line staves`, disabled: busy, run: () => {
        ctx.state.doc.fiveLines = !ctx.state.doc.fiveLines;
        ctx.say(ctx.state.doc.fiveLines ? 'Staves will be found with five lines (a choirbook ruled in red, 16th–18th century). Find the staves; the GABC is saved with staff-lines: 5.' : 'Staves will be found with four lines again.');
      } },
      chantDoc || list.some(v => !mensural(v)) ? { label: 'Read the words on the page', disabled: busy || !list.some(v => v.syllables.length), run: () => readWords(true) } : null,
      { label: 'Play the page', disabled: !list.some(v => v.syllables.length || (mensural(v) && (v.mensural || []).length)), run: () => listen(null) },
      { label: 'Read the whole page', disabled: !list.length || busy, run: () => readNotes(true) },
      // (two pages side by side: which face each other)
      global.CGApp ? { label: `${global.CGApp.state.spread ? '✓ ' : ''}Two pages side by side`, key: 'D', run: () => global.CGApp.setSpread(!global.CGApp.state.spread) } : null,
      global.CGApp && global.CGApp.state.spread ? { label: global.CGApp.state.firstAlone ? 'Pair pages 1-2, 3-4 … (the first not alone)' : 'Pair pages 2-3, 4-5 … (the first alone, as a book)', title: 'Which pages face each other: a book\'s first page is a right-hand one, alone', run: () => global.CGApp.setSpread(true, !global.CGApp.state.firstAlone) } : null,
      { label: 'Add a staff: drag a box around it', disabled: true, run: () => {} },
      '-',
      { label: 'Undo', key: 'Ctrl+Z', disabled: !history.undo.length, run: undo },
      { label: 'Redo', key: 'Ctrl+Y', disabled: !history.redo.length, run: redo },
    ], x, y);
  }
  // Which note of a neume is under a point on the page (counting notes, not accidentals, from 0): the glyph nearest
  // along the staff, and of its notes (a ligature has several) the nearest in pitch.
  function noteUnder(st, it, p) {
    const sh = N.itemShapes(it.g, false), sc = N.scaleOf(st.lines), here = pitchAt(st, p[0], p[1]).p;
    let k = 0, n = 0, best = Infinity;
    for (const v of sh.list) {
      if (v.sign || !v.notes.length) continue;
      const x0 = it.box[0] + v.dx * sc, x1 = x0 + v.w * sc, dx = p[0] < x0 ? x0 - p[0] : p[0] > x1 ? p[0] - x1 : 0;
      for (const m of v.notes) {
        const d = dx / (pitchAt(st, p[0], p[1]).step || 1) * 4 + Math.abs(m.p - here);
        if (d < best) { best = d; k = n; }
        n++;
      }
    }
    return k;
  }
  // the selected neume cut in two before its note k: the second part where its notes were drawn
  function splitNeume(k) {
    const st = staffOf(selected), it = itemOf();
    if (!st || !it || !it.box) return;
    const parts = C.splitAt(it.g, k);
    if (!parts) return;
    const sh = N.itemShapes(it.g, false), sc = N.scaleOf(st.lines);
    let n = 0, dx = 0;
    for (const v of sh.list) { if (v.sign || !v.notes.length) continue; if (n <= k && k < n + v.notes.length) { dx = v.dx; break; } n += v.notes.length; }
    const before = snapshot(), fresh = { g: parts[1], box: [it.box[0] + dx * sc, 0, 0, 0], checked: 'edited' };
    it.g = parts[0]; it.checked = 'edited';
    st.syllables[item.s].items.splice(item.i + 1, 0, fresh);
    N.fitBox(st, it); N.fitBox(st, fresh);
    commit(before);
    draw();
  }
  // the selected neume and the next one in its syllable as one
  function joinNext() {
    const st = staffOf(selected), it = itemOf(), items = st && item ? st.syllables[item.s].items : [], nxt = items[item ? item.i + 1 : 0];
    if (!it || !nxt || C.kind(it.g) !== 'neume' || C.kind(nxt.g) !== 'neume') return;
    const before = snapshot();
    it.g = C.joinG(it.g, nxt.g); it.checked = 'edited';
    items.splice(item.i + 1, 1);
    if (it.box) N.fitBox(st, it);
    commit(before);
    draw();
  }
  // ---------------------------------------------------------------- hearing it
  // The page as played (CGChant.perform, its staves in order), from a place on it (a staff, syllable and item) or from
  // the start; the neume sounding marked on the page as it plays.
  let playing = null;
  function performance(from) {
    const all = C.perform(page().staves);
    if (!from) return all;
    const order = page().staves.map(v => v.id), k = all.findIndex(e => {
      const a = order.indexOf(e.staff), b = order.indexOf(from.staff);
      return a > b || (a === b && (e.s > from.s || (e.s === from.s && e.i >= from.i)));
    });
    return k < 0 ? [] : all.slice(k);
  }
  // Mensural staves as played (CGMensural.perform: their rhythm as white notation reads it, a beat a minim), one voice:
  // the staff's voice through the document, or (a staff with none) the page's mensural staves without one; from a
  // place (an item) or the first. In sequence (no times).
  function mPerformance(from, voice) {
    const list = voice ? (M.voices(ctx.state.doc).find(v => v.voice === voice) || { staves: [] }).staves : page().staves.filter(v => mensural(v) && !v.voice);
    const all = M.perform(list, M.scoredBeats(ctx.state.doc)).map(e => { delete e.at; return e; });
    if (!from) return all;
    const order = list.map(v => v.id), b = order.indexOf(from.staff);
    const k = all.findIndex(e => { const a = order.indexOf(e.staff); return a > b || (a === b && e.i >= (from.i || 0)); });
    return k < 0 ? [] : all.slice(k);
  }
  // Every voice together, from the moment the place (in its voice) is reached: [events at their times], and what
  // the voices' lengths say (if they differ, one is likely misread).
  function mTogether(from, voice) {
    const { events, lengths } = M.together(ctx.state.doc);
    let t0 = 0;
    if (from) {
      const e = events.find(v => v.voice === voice && v.staff === from.staff && v.i >= (from.i || 0)) || events.find(v => v.voice === voice && v.staff === from.staff);
      if (e) t0 = e.at;
    }
    const out = events.filter(e => e.at >= t0 - 1e-9).map(e => Object.assign({}, e, { at: e.at - t0 }));
    const sb = m => Math.round(m / 2 * 100) / 100, most = Math.max(...lengths.map(v => v.minims));
    const short = lengths.filter(v => most - v.minims > 1e-6);
    const note = `${lengths.map(v => `${v.voice} ${sb(v.minims)}`).join(', ')} semibreves` +
      (short.length ? `: ${short.map(v => `${v.voice} is ${sb(most - v.minims)} short`).join(', ')}. A note or rest misread, or a rule this reading doesn't know.` : ', all alike.');
    return { events: out, note, even: !short.length };
  }
  // what is marked as it sounds: one item (or neume), or one in each voice
  let sounding = new Map();
  function mark(e) {
    if (!e) {
      playing = null; sounding = new Map();
      for (const r of ctx.svg.querySelectorAll('.neume.playing, .mitem.playing')) r.classList.remove('playing');
      return;
    }
    const key = e.voice || '', was = sounding.get(key);
    if (was) { const r = ctx.svg.querySelector(was); if (r) r.classList.remove('playing'); }
    if (!e.voice) for (const r of ctx.svg.querySelectorAll('.neume.playing, .mitem.playing')) r.classList.remove('playing');
    playing = { staff: e.staff, s: e.s, i: e.i };
    const sel = 'n' in e ? `.mitem[data-staff="${e.staff}"][data-i="${e.i}"]` : `.neume[data-staff="${e.staff}"][data-s="${e.s}"][data-i="${e.i}"]`;
    sounding.set(key, sel);
    const r = ctx.svg.querySelector(sel);
    if (r) r.classList.add('playing');
  }
  // played from a place (null: the page's start); the app's player does the sounding. A place on a mensural staff
  // plays mensural notation: with voices named, every voice together (alone: its own only); with none, the page's
  // mensural staves. With no place, a page whose staves are all mensural plays them, else its chant.
  function listen(from, alone = false) {
    const st = from && staffOf(from.staff), list = page().staves;
    const mens = st ? mensural(st) : list.length > 0 && list.every(mensural);
    if (!mens) {
      const events = performance(from);
      if (!events.length) { ctx.say('Nothing to play here yet: read the notes or place a chant first.', true); return; }
      if (ctx.play) ctx.play(events);
      return;
    }
    const start = st || list.find(v => (v.mensural || []).length), voice = start && start.voice;
    const named = M.voices(ctx.state.doc).filter(v => v.voice).length;
    if (voice && !alone && named > 1) {
      const r = mTogether(from || (start && { staff: start.id, i: 0 }), voice);
      if (!r.events.length) { ctx.say('Nothing to play here yet: put notes on the mensural staves first.', true); return; }
      if (ctx.play) ctx.play(r.events);
      ctx.say(`Playing ${named} voices together. ${r.note}`, !r.even);
      return;
    }
    const events = mPerformance(from, voice);
    if (!events.length) { ctx.say('Nothing to play here yet: put notes on the mensural staves first.', true); return; }
    if (ctx.play) ctx.play(events);
  }
  // a mensural staff's voice (a name: Cantus, Altus, Tenor, Bassus …; empty: none)
  function setVoice(st, name) {
    const before = snapshot(), v = String(name || '').trim().slice(0, 40);
    if (v) st.voice = v; else delete st.voice;
    commit(before);
    draw();
    ctx.say(v ? `This staff is the ${v}. Staves of the same voice are played one after another, every voice together.` : 'This staff belongs to no voice now.');
  }
  // where Play starts: the selected neume (or mensural item), else the selected staff, else the page's start
  const playFrom = () => item && selected ? { staff: selected, s: item.s, i: item.i }
    : mitem && selected ? { staff: selected, i: mitem.i }
    : selected && staffOf(selected) ? { staff: selected, s: 0, i: 0 } : null;

  // The selected item's GABC written anew: a neume, a clef, a bar, anything GABC writes (several, "fg h", become
  // several, after it). Clefs and notes keep their places on the staff: GABC's letters are places, not pitches, so a
  // clef changed reads the same notes as other pitches. False, and said, if it isn't GABC this can take.
  const focusItem = () => { const f = document.getElementById('itemG'); if (f) { f.focus(); f.select(); } };
  function setItem(text) {
    const st = staffOf(selected), it = itemOf();
    if (!st || !it) return false;
    const parts = String(text || '').replace(/[()]/g, ' ').trim().split(/\s+/).filter(Boolean).flatMap(c => C.groups(c));
    const bad = parts.find(g => C.kind(g) === 'break' || (C.kind(g) === 'neume' && (/[^a-npA-NP0-9vVwos~<>\/!@\[\]:._'`\-+xy#=qrR?;, ]/.test(g) || !C.notes(g).some(n => !n.acc))));
    if (!parts.length || bad) { ctx.say(parts.length ? `"${bad}" isn't something this can put here.` : 'Write its GABC: fgh, c3, f3, ::', true); return false; }
    if (parts.length === 1 && parts[0] === it.g) return true;
    const before = snapshot(), items = st.syllables[item.s].items, sc = N.scaleOf(st.lines);
    it.g = parts[0]; it.checked = 'edited';
    if (it.box) N.fitBox(st, it);
    let x = it.box ? it.box[0] + it.box[2] + 0.8 * N.STEP * sc : null;
    parts.slice(1).forEach((g, k) => {
      const fresh = { g, checked: 'edited' };
      if (x !== null) { fresh.box = [x, 0, 0, 0]; N.fitBox(st, fresh); x = fresh.box[0] + fresh.box[2] + 0.8 * N.STEP * sc; }
      items.splice(item.i + 1 + k, 0, fresh);
    });
    commit(before);
    draw();
    return true;
  }
  // the selected neume's note k given a shape; its falling notes as inclinata
  function reshape(k, shape) {
    const st = staffOf(selected), it = itemOf();
    if (!st || !it) return;
    const before = snapshot();
    if (setG(it, C.reshape(it.g, k, shape))) { N.fitBox(st, it); commit(before); }
    draw();
  }
  function climacus() {
    const st = staffOf(selected), it = itemOf();
    if (!st || !it) return;
    const before = snapshot(), n = C.notes(it.g).filter(v => !v.acc).length;
    let g = it.g;
    for (let k = 1; k < n; k++) g = C.reshape(g, k, 'inclinatum');
    if (setG(it, g)) { N.fitBox(st, it); commit(before); }
    draw();
  }
  // the selected staff without its bends (its ends kept)
  function straighten() {
    const st = staffOf(selected);
    if (!st || S.count(st.lines[0]) <= 2) return;
    const before = snapshot();
    st.lines = st.lines.map(l => [l[0], l[1], l[l.length - 2], l[l.length - 1]]);
    settle(st);
    commit(before);
    draw();
  }

  // ---------------------------------------------------------------- voice areas (mensural)
  // Where each voice is on a page (a choirbook's Cantus top left, Tenor below it, Altus and Bassus on the facing page;
  // a partbook's page all one voice): areas marked by hand, a box or drawn freehand round it, each named for a voice
  // (page.regions: [{ id, voice, points: [[x, y] …] }], page units). A staff whose middle is in an area is that voice:
  // the staves found or added in it are named so. Marked on one page, the areas can be copied to the pages after (a
  // book laid out alike on every opening), so finding the staves on every page names their voices too.
  let areaTool = null;                                      // 'box' or 'free' while marking an area
  const VOICE_NAMES = ['Cantus', 'Altus', 'Tenor', 'Bassus', 'Quintus', 'Sextus'];
  function inside(pts, x, y) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  const middleOf = st => [st.box[0] + st.box[2] / 2, st.box[1] + st.box[3] / 2];
  const areaAt = (pg, x, y) => (pg.regions || []).slice().reverse().find(r => inside(r.points, x, y)) || null;
  function voiceFromArea(st, pg = page()) {
    if (C.notationOf(ctx.state.doc, st) !== 'mensural' || !st.box) return;
    const r = areaAt(pg, ...middleOf(st));
    if (r && r.voice) st.voice = r.voice;
  }
  // (the tool marks one area, then lets go: a drag afterwards moves notes and staves again, as before it; the pointer a
  // crosshair while it is on)
  function setAreaTool(kind, quiet) {
    areaTool = areaTool === kind ? null : kind;
    for (const [id, k] of [['voiceArea', 'box'], ['voiceFree', 'free']]) { const b = document.getElementById(id); if (b) b.setAttribute('aria-pressed', String(areaTool === k)); }
    if (ctx.svg) ctx.svg.classList.toggle('marking', !!areaTool);
    if (!quiet) ctx.say(!areaTool ? 'Done marking voice areas.' : areaTool === 'box'
      ? 'Drag a box round where one voice is on the page (all its staves), then say which voice it is. (Esc: no area.)'
      : 'Draw round where one voice is on the page (all its staves), then say which voice it is. (Esc: no area.)');
    draw();
  }
  // a new area: kept at once (unnamed), its voice asked for where it was drawn
  function newArea(points, x, y) {
    const before = snapshot(), pg = page();
    const r = { id: `a${Date.now().toString(36)}`, voice: '', points: points.map(q => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]) };
    (pg.regions = pg.regions || []).push(r);
    commit(before);
    draw();
    areaMenu(r, x, y, true);
  }
  function nameArea(r, v) {
    const before = snapshot(), pg = page();
    r.voice = String(v || '').trim().slice(0, 40);
    let named = 0;
    for (const st of pg.staves) if (mensural(st) && inside(r.points, ...middleOf(st))) { if (r.voice) st.voice = r.voice; else delete st.voice; named++; }
    commit(before);
    draw();
    return named;
  }
  // the staves in an area found (the page's, those already marked left as they are) and named for its voice
  async function findInArea(r) {
    if (busy) return;
    busy = true;
    const pg = ctx.state.page;
    ctx.say(`Finding the staves${r.voice ? ` of the ${r.voice}` : ''} …`);
    try {
      const found = await findOn(pg, () => ctx.state.page !== pg);
      if (found) {
        const mid = lines => { const xs = lines.flatMap(S.xsOf), ys = lines.flatMap(l => l.filter((v, i) => i & 1)); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; };
        const mine = found.filter(lines => inside(r.points, ...mid(lines)));
        const before = snapshot();
        addFound(pg, mine);
        commit(before);
        draw();
        const all = page().staves.filter(st => inside(r.points, ...middleOf(st))).length;
        ctx.say(mine.length ? `${mine.length} ${mine.length === 1 ? 'staff' : 'staves'} found${r.voice ? ` for the ${r.voice}` : ''} (${all} in the area). Drag a box round any it missed.`
          : all ? `No more staves found in the area (${all} there).` : 'No staves found in the area: drag a box round each to add it.');
      }
    } catch (e) { ctx.say(`Couldn't read the page: ${e.message || e}`, true); }
    busy = false;
    info();
  }
  // the page's areas copied to the pages after it (every one, or every other: the same side of each opening) that
  // have none, fitted to each page's size
  function copyAreas(every) {
    const doc = ctx.state.doc, from = page(), list = from.regions || [];
    if (!list.length) return;
    const before = snapshotAll();
    let n = 0;
    for (let i = ctx.state.page + every; i < doc.pages.length; i += every) {
      const pg = doc.pages[i];
      if ((pg.regions || []).length) continue;
      const sx = pg.size[0] / from.size[0], sy = pg.size[1] / from.size[1];
      pg.regions = list.map((r, k) => ({ id: `${r.id}p${pg.n}`, voice: r.voice, points: r.points.map(([x, y]) => [Math.round(x * sx * 10) / 10, Math.round(y * sy * 10) / 10]) }));
      for (const st of pg.staves) voiceFromArea(st, pg);
      n++;
    }
    commit(before);
    draw();
    ctx.say(n ? `The areas copied to ${n} ${n === 1 ? 'page' : 'pages'}${every === 2 ? ' (every other page: the same side of each opening)' : ''}. Find the staves on all pages (⇊) and each is named for its voice; move an area if a page is laid out otherwise.`
      : 'The pages after this one have areas of their own already.');
  }
  function removeArea(r) {
    const before = snapshot(), pg = page();
    pg.regions = (pg.regions || []).filter(v => v !== r);
    if (!pg.regions.length) delete pg.regions;
    commit(before);
    draw();
  }
  function areaMenu(r, x, y, fresh) { ctx.menu(areaItems(r, fresh), x, y); }
  function areaItems(r, fresh) {
    const names = [...new Set([...VOICE_NAMES.slice(0, 4), ...M.voices(ctx.state.doc).map(v => v.voice).filter(Boolean), ...(r.voice ? [r.voice] : [])])];
    const pick = v => { const n = nameArea(r, v); if (fresh && v) findInArea(r); else ctx.say(v ? `The area is the ${v}${n ? `: ${n} ${n === 1 ? 'staff' : 'staves'} in it named so` : ''}.` : 'The area has no voice now.'); };
    return [
      { title: fresh ? 'Which voice is here?' : `Voice area${r.voice ? `: ${r.voice}` : ' (no voice yet)'}` },
      { shapes: names.map(v => ({ label: v, on: r.voice === v, title: `The ${v} is here${fresh ? ': its staves found and named so' : ''}`, run: () => pick(v) }))
        .concat([{ label: 'Other…', title: 'Another name (Superius, Contratenor, Quintus …)', run: () => { const v = global.prompt ? global.prompt('The voice\'s name', r.voice || '') : null; if (v !== null) pick(v); } }]) },
      fresh ? null : { label: 'Find its staves', disabled: busy, title: 'Find the staves in this area and name them for its voice', run: () => findInArea(r) },
      '-',
      { label: 'Copy the areas to every page after this', disabled: ctx.state.page >= ctx.state.doc.pages.length - 1, title: 'For a book laid out alike on every page (partbooks; a choirbook photographed an opening to an image)', run: () => copyAreas(1) },
      { label: 'Copy the areas to every other page after this', disabled: ctx.state.page >= ctx.state.doc.pages.length - 2, title: 'For a choirbook photographed a page to an image: the same side of each opening (left pages, or right)', run: () => copyAreas(2) },
      '-',
      { label: fresh ? 'Cancel: no area here' : 'Delete the area', run: () => removeArea(r) },
    ];
  }

  // ---------------------------------------------------------------- the pointer
  function down(e) {
    if (e.button !== 0 || !ctx.state.doc) return;
    const t = e.target.closest('[data-act]');
    const act = t ? t.dataset.act : 'new', p = at(e);
    e.preventDefault();
    try { ctx.svg.setPointerCapture(e.pointerId); } catch (err) { }
    if (areaTool && act !== 'alert') { drag = { act: 'area', kind: areaTool, from: p, to: p, pts: [p], moved: false }; return; }
    if (act === 'new') { drag = { act, from: p, to: p }; return; }
    if (act === 'alert') { goTo(alerts[+t.dataset.k]); return; }
    const id = t.dataset.staff;
    if (act === 'syl') {
      selected = id; word = +t.dataset.s; item = null; mitem = null;
      const syl = sylOf();
      drag = { act, from: p, box: wordBox(word), had: syl.box ? syl.box.slice() : null, checked: syl.checked, before: snapshot(), moved: false };
      draw();
      return;
    }
    if (act === 'mitem') {
      // a mensural item: along the staff as it is dragged, up or down by steps (a ligature: the note under the pointer,
      // or with Shift all of it)
      selected = id; item = null; word = null;
      const st = staffOf(id), i = +t.dataset.i, it = st.mensural[i];
      mitem = { i, n: it.k === 'lig' ? ligNote(st, i, p[0]) : null };
      drag = { act, from: p, start: JSON.stringify(it), all: e.shiftKey, before: snapshot(), moved: false };
      draw();
      return;
    }
    if (act === 'neume') {
      selected = id; item = { s: +t.dataset.s, i: +t.dataset.i }; word = null; mitem = null;
      const st = staffOf(id), it = itemOf();
      // Shift: only the note nearest the pointer
      let note = null;
      if (e.shiftKey && C.kind(it.g) === 'neume') note = noteUnder(st, it, p);
      drag = { act, from: p, g: it.g, box: it.box.slice(), checked: it.checked, note, before: snapshot(), moved: false };
      draw();
      return;
    }
    letGo();
    if (selected !== id) { selected = id; draw(); }
    const st = staffOf(id);
    drag = { act, from: p, start: JSON.stringify(st.lines), boxes: boxesOf(st), before: snapshot(), knot: +t.dataset.knot, line: +t.dataset.line, moved: false };
  }

  function move(e) {
    if (!drag) return;
    const p = at(e), dx = p[0] - drag.from[0], dy = p[1] - drag.from[1];
    if (!drag.moved && Math.hypot(dx, dy) < MIN_DRAG * unit()) return;
    drag.moved = true;
    if (drag.act === 'new') { drag.to = p; draw(); return; }
    if (drag.act === 'area') {
      drag.to = p;
      const q = drag.pts[drag.pts.length - 1];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 3 * unit()) drag.pts.push(p);
      draw(); return;
    }
    if (drag.act === 'syl') {
      const syl = sylOf();
      if (!syl || !drag.box) return;
      syl.box = [drag.box[0] + dx, drag.box[1] + dy, drag.box[2], drag.box[3]].map(v => Math.round(v * 100) / 100);
      syl.checked = 'edited';
      draw(true);
      return;
    }
    if (drag.act === 'mitem') {
      const st = staffOf(selected), it = mOf();
      if (!st || !it) return;
      const was = JSON.parse(drag.start), step = M.geometry(st.lines).s / 2, k = Math.round(-dy / step);
      Object.assign(it, was);
      if (Number.isFinite(was.x)) it.x = Math.round((was.x + dx) * 10) / 10;
      if (it.k === 'lig') it.notes = was.notes.map((n, j) => Object.assign({}, n, drag.all || j === mitem.n ? { p: n.p + k } : {}));
      else if (it.k === 'clef') it.line = Math.max(1, Math.min(5, was.line + Math.round(k / 2)));
      else if ('p' in was) it.p = was.p + k;
      draw(true);
      return;
    }
    if (drag.act === 'neume') {
      // along the staff as it goes; up or down by whole steps, which rewrites its letters
      const st = staffOf(selected), it = itemOf();
      if (!st || !it) return;
      it.box = [drag.box[0] + dx, drag.box[1], drag.box[2], drag.box[3]];
      const k = Math.round(-dy / pitchAt(st, it.box[0], p[1]).step);
      const g = C.transpose(drag.g, k, drag.note);
      it.g = g || it.g;
      it.checked = 'edited';
      N.fitBox(st, it);
      draw(true);
      return;
    }
    const st = staffOf(selected), start = JSON.parse(drag.start);
    if (!st) return;
    const xi = 2 * drag.knot, yi = xi + 1;
    if (drag.act === 'body') { st.lines = shift(start, dx, dy); shiftChant(st, drag.boxes, dx, dy); }
    else if (drag.act === 'knot') st.lines = start.map(l => { const m = l.slice(); m[xi] += dx; m[yi] += dy; return m; });
    else if (drag.act === 'point') st.lines = start.map((l, i) => { const m = l.slice(); if (i === drag.line) m[yi] += dy; return m; });
    // a staff can't be turned inside out, nor its points pass one another
    const xs = S.xsOf(st.lines[0]), t = st.lines[0], b = st.lines[st.lines.length - 1];
    if (xs.some((x, k) => k && x - xs[k - 1] < 4 * unit()) || xs.some((x, k) => b[2 * k + 1] <= t[2 * k + 1])) st.lines = start;
    draw(true);
  }

  function up(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.act === 'area') {
      draw();
      if (!d.moved) return;
      const [a, b] = [d.from, d.to];
      const pts = d.kind === 'box' ? [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])], [Math.min(a[0], b[0]), Math.max(a[1], b[1])]] : d.pts.concat([d.to]);
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      if (pts.length < 3 || Math.max(...xs) - Math.min(...xs) < 20 * unit() || Math.max(...ys) - Math.min(...ys) < 10 * unit()) { ctx.say(d.kind === 'box' ? 'Drag a larger box, round all of one voice\'s staves.' : 'Draw right round all of one voice\'s staves.'); return; }
      setAreaTool(areaTool, true);                         // (one area a time: the tool let go)
      newArea(pts, e.clientX, e.clientY);
      return;
    }
    if (d.act === 'new') {
      if (!d.moved) { if (selected) { selected = null; letGo(); draw(); } return; }
      const x = Math.min(d.from[0], d.to[0]), y = Math.min(d.from[1], d.to[1]);
      const rect = [x, y, Math.abs(d.to[0] - d.from[0]), Math.abs(d.to[1] - d.from[1])];
      draw();
      if (rect[2] < 4 * MIN_DRAG * unit()) { ctx.say('Drag across the whole staff, from its first note to its last.'); return; }
      addStaff(rect);
      return;
    }
    // (a note clicked while playing or paused: played from there, as Serenissima Press does)
    if (!d.moved && (d.act === 'mitem' || d.act === 'neume') && ctx.playing && ctx.playing()) { draw(); const f = playFrom(); if (f) listen(f); return; }
    if (!d.moved) { draw(); return; }
    if (d.act === 'syl') {
      const syl = sylOf();
      // moved and put back: as it was
      if (syl && Math.hypot(syl.box[0] - d.box[0], syl.box[1] - d.box[1]) < unit()) {
        if (d.had) syl.box = d.had; else delete syl.box;
        if (d.checked === undefined) delete syl.checked; else syl.checked = d.checked;
      }
      commit(d.before);
      draw();
      return;
    }
    if (d.act === 'mitem') {
      const it = mOf();
      if (it) delete it.conf;
      commit(d.before);
      draw();
      return;
    }
    if (d.act === 'neume') {
      const it = itemOf();
      // moved and put back: as it was, checked or not
      if (it && it.g === d.g && Math.abs(it.box[0] - d.box[0]) < unit()) { it.box = d.box; if (d.checked === undefined) delete it.checked; else it.checked = d.checked; }
      commit(d.before);
      draw();
      return;
    }
    const st = staffOf(selected);
    if (st) settle(st);
    commit(d.before);
    draw();
  }

  // ---------------------------------------------------------------- the keyboard (app.js asks first)
  // true if the key was the editor's
  function key(e) {
    if (!ctx || !ctx.state.doc) return false;
    const mod = e.ctrlKey || e.metaKey, k = e.key;
    if (mod && !e.altKey && (k === 'z' || k === 'Z')) { (e.shiftKey ? redo : undo)(); return true; }
    if (mod && !e.altKey && (k === 'y' || k === 'Y')) { redo(); return true; }
    if (mod || e.altKey) return false;
    if (areaTool && k === 'Escape') { setAreaTool(areaTool); return true; }
    const u = unit() * (e.shiftKey ? 10 : 1);
    // Shift+Enter: the staff accepted; [ and ]: the selected syllable to the line before, or the next
    if (k === 'Enter' && e.shiftKey && selected) { acceptStaff(); return true; }
    if ((k === '[' || k === ']') && (sylOf() || itemOf())) { moveLine(k === ']' ? 1 : -1); return true; }
    // a syllable selected: the keys are its
    if (sylOf()) {
      if (k === 'Escape') { word = null; draw(); return true; }
      if (k === 'ArrowUp') { nudgeWord(0, -u); return true; }
      if (k === 'ArrowDown') { nudgeWord(0, u); return true; }
      if (k === 'ArrowLeft') { nudgeWord(-u, 0); return true; }
      if (k === 'ArrowRight') { nudgeWord(u, 0); return true; }
      if (k === 'Tab') { nextWord(e.shiftKey ? -1 : 1); return true; }
      if (k === 'Enter') { acceptWord(); return true; }
      return false;
    }
    // a mensural staff: music typed in (letters, digits, r, - # n N, [ ]); a mensural item selected: the keys are its
    {
      const mst = staffOf(selected);
      if (mst && mensural(mst) && !itemOf() && !sylOf()) {
        if (/^[a-gA-G]$/.test(k)) { mTypeNote(k); return true; }
        if (/^[0-9]$/.test(k)) return mDigit(+k);
        if (k === 'r') { mTypeRest(); return true; }
      }
    }
    if (mOf()) {
      const all = e.shiftKey;
      if (k === 'Escape') { mitem = null; draw(); return true; }
      if (k === 'ArrowUp') { mShift(1, all); return true; }
      if (k === 'ArrowDown') { mShift(-1, all); return true; }
      if (k === 'ArrowLeft') { mNudge(-unit() * 3); return true; }
      if (k === 'ArrowRight') { mNudge(unit() * 3); return true; }
      if (k === 'Tab') { mNext(e.shiftKey ? -1 : 1); return true; }
      if (k === 'Delete') { mRemove(); return true; }
      // (Backspace, as when typing: this one gone, the one before selected)
      if (k === 'Backspace') { const i = mitem.i; mRemove(); if (i > 0) { mitem = { i: i - 1, n: null }; draw(); } return true; }
      if (k === '-') { mAccidental('b'); return true; }
      if (k === '#') { mAccidental('#'); return true; }
      if (k === 'n') { mAccidental('n'); return true; }
      if (k === 'N') { mAccidental(null); return true; }
      if (k === '[') { mLigature(true); return true; }
      if (k === ']') { mLigature(false); return true; }
      if (k === 'k' || k === 'K') { mBlack(); return true; }
      if (k === 's' || k === 'S') { mStem(); return true; }
      if (k === 'R') { mRest(); return true; }
      if (k === '.') { mDot(); return true; }
      if (k === 'j' || k === 'J') { mJoin(); return true; }
      if (k === 'o' || k === 'O') { mOblique(); return true; }
      return false;
    }
    // a neume selected: the keys are its
    if (itemOf()) {
      if (k === 'Escape') { item = null; draw(); return true; }
      if (k === 'ArrowUp') { shiftNeume(1); return true; }
      if (k === 'ArrowDown') { shiftNeume(-1); return true; }
      if (k === 'ArrowLeft') { nudgeNeume(-u); return true; }
      if (k === 'ArrowRight') { nudgeNeume(u); return true; }
      if (k === 'Tab') { nextNeume(e.shiftKey ? -1 : 1); return true; }
      if (k === 'Enter') { acceptNeume(); return true; }
      if (k === 'Delete' || k === 'Backspace') { removeNeume(); return true; }
      if (k === 'j' || k === 'J') { joinNext(); return true; }
      if (k === 'g' || k === 'G') { focusItem(); return true; }
      if (k === 't' || k === 'T') { textHere(); return true; }
      return false;
    }
    if (!selected) return false;
    if (k === 'Escape') { selected = null; draw(); return true; }
    if (k === 'Delete' || k === 'Backspace') { remove(); return true; }
    if (k === 'f' || k === 'F') { refit(); return true; }
    if (k === 'b' || k === 'B') { toggleBegins(); return true; }
    if (k === 'e' || k === 'E') { evenly(); return true; }
    if (k === 'ArrowUp') { nudge(0, -u); return true; }
    if (k === 'ArrowDown') { nudge(0, u); return true; }
    if (k === 'ArrowLeft') { nudge(-u, 0); return true; }
    if (k === 'ArrowRight') { nudge(u, 0); return true; }
    if (k === 'Tab') { const st = staffOf(selected); if (st && mensural(st) && (st.mensural || []).length) mNext(e.shiftKey ? -1 : 1); else cycle(e.shiftKey ? -1 : 1); return true; }
    return false;
  }

  function cycle(d) {
    const list = page().staves;
    if (!list.length) return;
    const i = list.findIndex(s => s.id === selected);
    selected = list[(i + d + list.length) % list.length].id;
    draw();
  }

  // ---------------------------------------------------------------- drawing
  // fast: while dragging, only the overlay is redrawn, not the side panel
  // a voice's colour (its hue): the usual four apart, any other name by its letters
  function areaHue(v) {
    const known = { cantus: 4, superius: 4, discantus: 4, altus: 140, contratenor: 140, tenor: 215, bassus: 280 }, n = String(v || '').toLowerCase();
    if (!n) return 35;
    const k = Object.keys(known).find(w => n.startsWith(w));
    return k ? known[k] : [...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  }
  // (target: { svg, page }, another page drawn as it stands, to look at: the facing page of a two-page view; nothing
  // on it selected or dragged, its checks' marks its own)
  function draw(fast, target) {
    const svg = target ? target.svg : ctx.svg, pg = target ? ctx.state.doc.pages[target.page] : page();
    if (!pg) return;
    svg.setAttribute('viewBox', `0 0 ${pg.size[0]} ${pg.size[1]}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.replaceChildren();
    const u = unit(), r = HANDLE * u;
    const el = (name, attrs, parent = svg) => { const x = document.createElementNS(SVG, name); for (const k in attrs) x.setAttribute(k, attrs[k]); parent.appendChild(x); return x; };
    el('rect', { x: 0, y: 0, width: pg.size[0], height: pg.size[1], class: 'bg' });
    // the voice areas, under the staves, each in its voice's colour with its name (the name grabs it: right-click)
    const areaClefs = (pg.regions || []).length ? M.clefsOf(ctx.state.doc).clefs : new Map();
    if (C.notationOf(ctx.state.doc) === 'mensural' || (pg.regions || []).length) (pg.regions || []).forEach((r, k) => {
      const hue = areaHue(r.voice), xs = r.points.map(q => q[0]), ys = r.points.map(q => q[1]);
      el('polygon', { points: r.points.map(q => q.join(',')).join(' '), class: 'varea', style: `--hue:${hue}` });
      const t = el('text', { x: Math.min(...xs) + 6 * u, y: Math.min(...ys) + 16 * u, 'font-size': 14 * u, class: 'varea-name', style: `--hue:${hue}`, 'data-act': 'area', 'data-k': k });
      const same = (pg.regions || []).filter(v => v.voice && v.voice === r.voice), clef = r.voice && areaClefs.get(r.voice);
      t.textContent = r.voice ? `${r.voice}${same.length > 1 ? ` (${same.indexOf(r) + 1})` : ''}${clef ? ` · ${clef.toUpperCase()}` : ''}` : 'Which voice? (right-click)';
    });
    if (!target && drag && drag.act === 'area' && drag.moved) {
      const [a, b] = [drag.from, drag.to];
      if (drag.kind === 'box') el('rect', { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), class: 'varea drawing' });
      else el('polyline', { points: drag.pts.concat([drag.to]).map(q => q.join(',')).join(' '), class: 'varea drawing' });
    }
    for (const st of pg.staves) {
      const sel = st.id === selected, g = el('g', { class: 'staff' + (sel ? ' sel' : '') + (mensural(st) ? ' mensural' : '') });
      const l = st.lines, s = S.spacing(l) / 2, n = S.count(l[0]);
      const pts = (line, dy) => { const out = []; for (let k = 0; k < n; k++) out.push([line[2 * k], line[2 * k + 1] + dy]); return out; };
      // the staff's area: its lines, half a space beyond the outer ones; grabbing it moves the staff
      el('polygon', { points: pts(l[0], -s).concat(pts(l[l.length - 1], s).reverse()).map(q => q.join(',')).join(' '), class: 'area', 'data-act': 'body', 'data-staff': st.id }, g);
      for (const ln of l) el('polyline', { points: pts(ln, 0).map(q => q.join(',')).join(' '), class: 'line', 'data-act': 'body', 'data-staff': st.id }, g);
      // a chant begins here: a mark before the staff
      if (st.begins === true) {
        const x = l[0][0] - 1.6 * s, y0 = l[0][1] - 2 * s, y1 = l[l.length - 1][1] + 2 * s;
        const m = el('g', { class: 'begins' }, g);
        el('line', { x1: x, y1: y0, x2: x, y2: y1 }, m);
        el('polygon', { points: `${x},${y0} ${x + 2.4 * s},${y0 + 1.2 * s} ${x},${y0 + 2.4 * s}` }, m);
        el('title', {}, m).textContent = 'A chant begins here';
      }
      // a chant begins part way along: a flag at the point
      if (typeof st.beginsAt === 'number') {
        const x = st.beginsAt, y0 = S.yAt(l[0], x) - 2 * s, y1 = S.yAt(l[l.length - 1], x) + 2 * s;
        const m = el('g', { class: 'begins mid' }, g);
        el('line', { x1: x, y1: y0, x2: x, y2: y1 }, m);
        el('polygon', { points: `${x},${y0} ${x + 2.4 * s},${y0 + 1.2 * s} ${x},${y0 + 2.4 * s}` }, m);
        el('title', {}, m).textContent = 'A chant begins here, part way along the staff';
      }
      // a mensural staff's voice, named above its start
      if (mensural(st) && st.voice) {
        const t = el('text', { x: l[0][0], y: l[0][1] - 1.2 * s, 'font-size': 2.2 * s, class: 'mvoice' }, g);
        t.textContent = st.voice;
      }
      // a mensural staff's contents: Serenissima's glyphs, and the shapes drawn for ligatures and signs
      if (mensural(st) && (st.mensural || []).length) {
        const L = M.layout(st), mg = el('g', { class: 'mensural-notes' }, g);
        const doubt = v => { const it = st.mensural[v.item]; return it && it.conf !== undefined && it.conf < DOUBT ? ' doubt' : ''; };
        for (const v of L.shapes) el('path', { d: v.d, class: 'mshape' + (v.fill === true ? ' fill' : v.fill === 'outline' ? ' outline' : '') + doubt(v), 'stroke-width': L.pen * (v.fill === 'outline' ? 1.4 : 1) }, mg);
        for (const v of L.signs) el('path', { d: v.d, class: 'msign' + doubt(v), transform: M.transform(v, L.angle) }, mg);
        for (const v of L.texts) {
          const t = el('text', { x: v.x, y: v.y, 'font-size': v.size, class: 'mnum', transform: `rotate(${L.angle.toFixed(3)} ${v.x} ${v.y})` }, mg);
          t.textContent = v.text;
        }
        // each item's box, to grab it by; the selected one outlined (and in a ligature, its note)
        L.boxes.forEach((b, i) => el('rect', { x: b[0], y: b[1], width: Math.max(b[2], 8 * u), height: b[3], class: 'mitem' + (sel && mitem && mitem.i === i ? ' on' : ''), 'data-act': 'mitem', 'data-staff': st.id, 'data-i': i }, g));
        const cell = sel && mitem && mitem.n !== null && (L.cells[mitem.i] || [])[mitem.n];
        if (cell) { const b = L.boxes[mitem.i]; el('rect', { x: cell[0], y: b[1], width: cell[1] - cell[0], height: b[3], class: 'mcell' }, g); }
      }
      // the chant: its glyphs where they are, along the staff (tilted with it); its words under it
      if (st.syllables.some(syl => syl.items.some(it => it.box))) {
        const L = N.layout(st), ch = el('g', { class: 'chant' }, g);
        const isSel = (s, i) => sel && item && item.s === s && item.i === i;
        for (const v of L.glyphs) {
          const cu = isCustos(st.syllables[v.syllable].items[v.item]);
          const cls = 'glyph' + (cu ? ' custos' : v.checked ? ' ok' : v.conf !== undefined && v.conf < DOUBT ? ' doubt' : '') + (isSel(v.syllable, v.item) ? ' on' : '');
          const t = el('text', { x: v.x, y: v.y, 'font-size': L.size, class: cls, transform: `rotate(${v.angle.toFixed(3)} ${v.x} ${v.y})` }, ch);
          t.textContent = v.ch;
        }
        for (const v of L.texts) {
          const on = sel && word === v.syllable, syl = st.syllables[v.syllable];
          const cls = 'syl' + (v.checked ? ' ok' : doubtful(syl) ? ' doubt' : '') + (on ? ' on' : '');
          const t = el('text', { x: v.x, y: v.y, 'font-size': L.textSize, class: cls, 'data-act': 'syl', 'data-staff': st.id, 'data-s': v.syllable }, ch);
          t.textContent = v.text.replace(/<[^>]*>/g, '');
        }
      }
      // each neume's box, to grab it by (at least a few pixels wide, for a bar); the selected one outlined
      st.syllables.forEach((syl, s) => syl.items.forEach((it, i) => {
        if (!it.box) return;
        const w = Math.max(it.box[2], 8 * u), x = it.box[0] + it.box[2] / 2 - w / 2;
        el('rect', { x, y: it.box[1], width: w, height: it.box[3], class: 'neume' + (sel && item && item.s === s && item.i === i ? ' on' : '') + (playing && playing.staff === st.id && playing.s === s && playing.i === i ? ' playing' : ''), 'data-act': 'neume', 'data-staff': st.id, 'data-s': s, 'data-i': i }, g);
      }));
      if (!sel || item || word !== null) continue;
      // the dots no bigger than a third of a space, so the bar between them can still be grabbed
      const rr = Math.max(2.5 * u, Math.min(r, S.spacing(l) / 3));
      // at each point (the ends, and any bends): a bar through all four lines, and a dot on each line
      for (let k = 0; k < n; k++) {
        const xi = 2 * k;
        const bar = { x1: l[0][xi], y1: l[0][xi + 1] - s, x2: l[l.length - 1][xi], y2: l[l.length - 1][xi + 1] + s };
        el('line', Object.assign({ class: k && k < n - 1 ? 'end bend' : 'end' }, bar), g);
        el('line', Object.assign({ class: 'hit', 'data-act': 'knot', 'data-staff': st.id, 'data-knot': k }, bar), g);
        l.forEach((ln, i) => el('circle', { cx: ln[xi], cy: ln[xi + 1], r: rr, class: 'handle', 'data-act': 'point', 'data-staff': st.id, 'data-knot': k, 'data-line': i }, g));
      }
    }
    // the checks' findings on this page: a mark over each place (a whole staff's at its start), to click
    if (!fast && !target) alerts = K.check(ctx.state.doc).concat(clefAlerts());
    for (const [k, a] of alerts.entries()) {
      if (a.page !== (target ? target.page : ctx.state.page)) continue;
      const st = pg.staves.find(v => v.id === a.staff), it = st && a.i !== null && st.syllables[a.s] && st.syllables[a.s].items[a.i];
      if (!st) continue;
      const x = it && it.box ? it.box[0] + it.box[2] / 2 : S.xsOf(st.lines[0])[0], top = S.yAt(st.lines[0], x) - 2.2 * S.spacing(st.lines);
      const r2 = 0.55 * S.spacing(st.lines), m = el('g', { class: 'mark ' + a.level, 'data-act': 'alert', 'data-k': k });
      el('circle', { cx: x, cy: top, r: r2 }, m);
      const t = el('text', { x, y: top + 0.35 * r2 * 2, 'font-size': 1.3 * r2 }, m);
      t.textContent = '!';
      el('title', {}, m).textContent = a.text;
    }
    if (!target && drag && drag.act === 'new' && drag.moved) {
      const [a, b] = [drag.from, drag.to];
      el('rect', { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), class: 'band' });
    }
    if (target) return;
    if (!fast) info();
    // (the facing page too, in a two-page view: a voice named here, a clef changed, shows on it)
    if (!fast && ctx.facing && ctx.facing.page !== ctx.state.page) draw(true, ctx.facing);
  }
  // the facing page of a two-page view drawn into its own layer (svg), or none (null)
  function setFacing(f) { ctx.facing = f; if (f) draw(true, f); }

  // The notation the tools work in, shown (the toolbar's switch, the rail's chip, the accent's colour) and only its
  // tools offered: the chant card, words and chant starts for chant; the mensural card for mensural. A staff marked as
  // the other notation brings its own tools while it is selected (or while the page has such staves).
  function modeShown(list, st) {
    const doc = C.notationOf(ctx.state.doc), set = (id, on) => { const e = document.getElementById(id); if (e) e.hidden = !on; };
    document.body.dataset.mode = doc;
    for (const b of document.querySelectorAll('#modeGroup [data-notation]')) b.setAttribute('aria-pressed', String(b.dataset.notation === doc));
    const chip = document.getElementById('modeChip');
    if (chip) chip.textContent = doc === 'mensural' ? 'Mensural' : 'Chant';
    const kind = document.getElementById('staffKind');
    if (kind) kind.textContent = st ? (mensural(st) ? 'mensural staff' : 'chant staff') : '';
    const chantHere = (st ? !mensural(st) : doc === 'chant') || list.some(v => !mensural(v)) && doc === 'chant';
    const mensHere = st ? mensural(st) : doc === 'mensural' || list.some(v => mensural(v));
    set('chantGroup', doc === 'chant' || chantHere);
    set('mensGroup', doc === 'mensural' || mensHere);
    const chantStaves = list.some(v => !mensural(v));
    set('readText', doc === 'chant' || chantStaves);
    set('acceptStaff', doc === 'chant' || chantStaves);
    set('beginsRow', !st || !mensural(st));
    set('voiceArea', doc === 'mensural'); set('voiceFree', doc === 'mensural');
    if (doc !== 'mensural' && areaTool) areaTool = null;
    const anyMens = C.staves(ctx.state.doc).some(v => mensural(v)), anyChant = C.staves(ctx.state.doc).some(v => !mensural(v));
    set('mensExport', doc === 'mensural' || anyMens); set('mensExportHint', doc === 'mensural' || anyMens);
    set('chantExport', doc === 'chant' || anyChant);
  }
  // the side panel: how many staves, and the selected one's measurements
  function info() {
    const out = document.getElementById('staffInfo');
    if (!out || !ctx || !ctx.state.doc) return;
    const list = page().staves, st = staffOf(selected);
    const n = list.length;
    let text = n ? `${n} ${n === 1 ? 'staff' : 'staves'} on this page.` : 'No staves on this page yet: Find staves, or drag a box around one.';
    if (st) {
      const bends = S.count(st.lines[0]) - 2;
      text += ` Staff ${list.indexOf(st) + 1} selected: lines ${S.spacing(st.lines).toFixed(1)} apart, tilted ${S.tilt(st.lines).toFixed(2)}°` +
        (bends ? `, bent at ${bends} ${bends === 1 ? 'point' : 'points'}.` : '.');
    }
    out.textContent = text;
    modeShown(list, st);
    checkList();
    for (const id of ['refit', 'evenly', 'remove']) document.getElementById(id).disabled = !st;
    document.getElementById('findStaves').disabled = busy;
    document.getElementById('findEverywhere').hidden = busy || ctx.state.doc.pages.length < 2;
    document.getElementById('stopFinding').hidden = !busy || ctx.state.doc.pages.length < 2;
    // (only the tools for what's selected: a staff's, or a neume's and its syllable's)
    const sylTools = document.getElementById('sylTools');
    if (sylTools) {
      document.getElementById('staffTools').hidden = document.getElementById('staffRow').hidden = !st || !!itemOf() || !!sylOf();
      sylTools.hidden = !itemOf() && !sylOf();
    }
    const begins = document.getElementById('beginsHere');
    if (begins) { begins.disabled = !st; begins.checked = !!(st && st.begins === true); }
    const place = document.getElementById('placeChant');
    if (place) {
      place.disabled = !st || mensural(st);
      document.getElementById('clearChant').disabled = !st || !st.syllables.length;
      document.getElementById('readStaff').disabled = !st || busy;
      document.getElementById('readPage').disabled = !list.length || busy;
      document.getElementById('readText').disabled = !list.some(v => v.syllables.length) || busy;
      document.getElementById('readBreaks').disabled = !st || !ctx.state.doc.chants.some(c => c.staves.includes(st.id) && c.staves.length > 1);
      document.getElementById('downloadGabc').disabled = !ctx.state.doc.chants.length && !list.some(s => s.syllables.length);
      const chant = st && ctx.state.doc.chants.find(c => c.staves.includes(st.id)), it = itemOf(), syl = sylOf();
      wordPanel(syl);
      const ip = document.getElementById('itemPanel'), ig = document.getElementById('itemG');
      if (ip) { ip.hidden = !it; if (it && document.activeElement !== ig) ig.value = it.g; }
      document.getElementById('splitHere').disabled = !it || item.i === 0;
      document.getElementById('linePrev').disabled = document.getElementById('lineNext').disabled = !it && !syl;
      document.getElementById('acceptStaff').disabled = !st || !st.syllables.length;
      document.getElementById('chantInfo').textContent = it ? neumeInfo(st, it) : syl ? '' : !st ? ''
        : mensural(st) ? (mOf() ? mDescribe(st, mOf()) : `A mensural staff${st.voice ? `, the ${st.voice}` : ' (no voice named: right-click it to say which)'}: Read the notes, or click an item to select it, drag it, or right-click for more; right-click the staff to add one.`)
        : st.syllables.length ? progress(st)
        : chant ? `This staff has ${chant.headers.name ? `"${chant.headers.name}"` : 'a chant'} on it (${chant.staves.length} ${chant.staves.length === 1 ? 'staff' : 'staves'}).`
        : 'This staff has no chant yet.';
    }
    const mt = document.getElementById('mensText');
    if (mt) {
      const on = !!(st && mensural(st));
      document.getElementById('putMens').disabled = !on;
      if (on && document.activeElement !== mt) mt.value = st.mensural ? M.text(st.mensural) : '';
      document.getElementById('mensGroup').open = document.getElementById('mensGroup').open || on;
    }
    document.getElementById('undo').disabled = !history.undo.length;
    document.getElementById('redo').disabled = !history.redo.length;
    bookInfo();
  }

  // the book panel: which page of the book this is, and the chants the index lists for it (a click places one on the
  // selected staff)
  function bookInfo() {
    const body = document.getElementById('bookBody'), idx = ctx.state.book;
    if (!body) return;
    body.hidden = !idx;
    if (!idx) return;
    const bp = bookPage(), b = ctx.state.doc.book, field = document.getElementById('bookPage');
    if (document.activeElement !== field) field.value = bp ? bp.label : '';
    const src = idx.source || {};
    document.getElementById('bookInfo').textContent = `${src.title || 'The book'}${src.year ? ` (${src.year})` : ''}: ${idx.pages.length} pages, ${idx.chants.length} chants in its index. ` +
      (!b || !Number.isInteger(b.first) ? 'Say which page of the book this scan page is.' : !bp ? 'This scan page is outside the book\'s pages.'
        : bp.chants.length ? `On page ${bp.label} the index has ${bp.chants.length === 1 ? 'this chant' : 'these chants'}, in order (click one to place it on the selected staff):` : `The index has no chant beginning on page ${bp.label}.`);
    const list = document.getElementById('bookChants');
    list.textContent = '';
    const placed = new Set(ctx.state.doc.chants.map(c => String(c.headers && c.headers.gregobase)));
    for (const c of bp ? bp.chants : []) {
      const li = document.createElement('li'), btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'cg-link' + (placed.has(String(c.id)) ? ' placed' : '');
      btn.textContent = `${[PART[c.office_part], c.mode].filter(Boolean).join(' ')}${PART[c.office_part] || c.mode ? ': ' : ''}${c.incipit}${c.extent > 1 ? ` (runs over ${c.extent} pages)` : ''}`;
      btn.disabled = !selected;
      btn.title = selected ? 'Place it on the selected staff (and the staves after it, down to where the next chant begins)' : 'Select the staff it begins on first';
      btn.addEventListener('click', () => placeOne(c.id));
      li.appendChild(btn); list.appendChild(li);
    }
    document.getElementById('placePage').disabled = !bp || !bp.chants.length || busy;
  }
  // GregoBase's office parts, as the books print them over the initial
  const PART = { an: 'Ant.', in: 'Intr.', gr: 'Grad.', al: 'Allel.', tr: 'Tract.', of: 'Offert.', co: 'Comm.', re: 'Resp.',
    rb: 'R. br.', hy: 'Hymn.', se: 'Seq.', ca: 'Cant.', ps: 'Ps.', ky: 'Kyrie', pa: 'Prosa', im: 'Improp.', va: '', or: '', pr: '', su: '', tp: '', rh: '' };

  // a finding gone to: its page, its staff, and its neume or syllable
  function goTo(a) {
    if (!a) return;
    const show = a.page !== ctx.state.page;
    selected = a.staff; letGo();
    const st = ctx.state.doc.pages[a.page].staves.find(v => v.id === a.staff);
    if (a.i !== null && st && st.syllables[a.s] && st.syllables[a.s].items[a.i]) item = { s: a.s, i: a.i };
    if (a.kind === 'clef' && st && mensural(st)) { const k = (st.mensural || []).findIndex(it => it.k === 'clef'); if (k >= 0) mitem = { i: k, n: null }; }
    if (show) ctx.show(a.page); else draw();
    ctx.say(a.text, a.level === 'warn');
  }

  // a mensural staff that begins with another clef than its voice's other staves: likely misread
  function clefAlerts() {
    const doc = ctx.state.doc, pageOf = new Map();
    doc.pages.forEach((pg, k) => pg.staves.forEach(st => pageOf.set(st, k)));
    return M.clefsOf(doc).odd.map(o => ({ staff: o.staff.id, page: pageOf.get(o.staff), s: null, i: null, kind: 'clef', level: 'note',
      text: `This ${o.voice} staff begins with ${o.clef.toUpperCase()}, the ${o.voice}'s others with ${o.usual.toUpperCase()}: a voice keeps its clef, as a rule. Misread? (Right-click the staff to use the ${o.voice}'s.)` }));
  }
  // the findings listed in the side panel, page by page
  function checkList() {
    const list = document.getElementById('checkList');
    if (!list) return;
    list.replaceChildren();
    const doc = ctx.state.doc;
    alerts.forEach(a => {
      const li = document.createElement('li'), b = document.createElement('button');
      const pg = doc.pages[a.page], n = pg.staves.findIndex(v => v.id === a.staff) + 1;
      b.type = 'button'; b.className = 'cg-link ' + a.level;
      b.textContent = `Page ${pg.n}, staff ${n}: ${a.text}`;
      b.addEventListener('click', () => goTo(a));
      li.appendChild(b); list.appendChild(li);
    });
    document.getElementById('checkCount').textContent = alerts.length ? `(${alerts.length})` : '';
    if (!alerts.length) { const li = document.createElement('li'); li.className = 'cg-hint'; li.textContent = doc.chants.length ? 'Nothing found.' : 'Place a chant on the staves to check it.'; list.appendChild(li); }
  }

  // how far a staff has been checked
  function progress(st) {
    const its = st.syllables.flatMap(syl => syl.items.filter(it => it.box && !isCustos(it))), words = st.syllables.filter(syl => syl.text);
    const done = its.filter(it => it.checked).length + words.filter(w => w.checked).length, all = its.length + words.length;
    const doubts = its.filter(doubtful).length + words.filter(doubtful).length;
    return `${done} of ${all} neumes and syllables checked` + (doubts ? `; ${doubts} doubtful (orange) to look at.` : '.');
  }

  // the side panel's fields for the selected syllable (kept as they are while being typed in)
  function wordPanel(syl) {
    const panel = document.getElementById('wordPanel');
    if (!panel) return;
    panel.hidden = !syl;
    if (!syl) return;
    const set = (id, v) => { const f = document.getElementById(id); if (document.activeElement !== f) f.value = v; };
    set('sylText', syl.text);
    set('sylDipl', syl.dipl || '');
    document.getElementById('sylStart').checked = !syl.join;
    document.getElementById('joinPrev').disabled = word === 0;
    const how = { item: 'Checked.', edited: 'Changed by you (so checked).', staff: 'Checked with its staff.' }[syl.checked] || 'Not checked yet.';
    document.getElementById('sylInfo').textContent = how;
  }

  // what the side panel says of a neume: its GABC, its syllable, its notes by name, and whether it's been checked
  function neumeInfo(st, it) {
    const syl = st.syllables[item.s], kind = C.kind(it.g);
    const clef = (C.withClefs(st).find(v => v.syllable === item.s && v.item === item.i) || {}).clef;
    const names = kind === 'neume' || kind === 'custos' ? C.notes(it.g).filter(n => !n.acc).map(n => { const q = C.pitch(n.p, clef); return q ? q.step + q.octave : n.p; }).join(' ') : '';
    const how = { item: 'checked', edited: 'changed by you (so checked)', staff: 'checked with its staff' }[it.checked] || 'not checked yet';
    const read = it.read === undefined ? '' : it.read ? ` The recognizer reads (${it.read}) here.` : ' The recognizer saw nothing here.';
    return `Neume (${it.g})` + (syl.text ? ` over "${syl.text.replace(/<[^>]*>/g, '')}"` : '') + (names ? `: ${names}` : '') + `. ${how[0].toUpperCase() + how.slice(1)}.` + read;
  }

  global.CGEditor = {
    init, reset, draw, setFacing, key, setNotation, setAreaTool, toggleNotation, putMensural, mensuralMei, mensuralMusicXml, setVoice, undo, redo, refit, evenly, remove, addStaff, placeChant, beginsAt, clearChant, gabc, findHere, findEverywhere, stop, findBeginnings, toggleBegins,
    setText, setDipl, setWordStart, splitHere, joinPrev, splitNeume, joinNext, gabcFiles, setItem, textHere, joinBack, performance, mark, listen, playFrom, readWords, wordsInto, acceptStaff, acceptWord, volpiano, mei, moveLine, placePage, placeOne, bookPage, readBreaks, readNotes,
    get alerts() { return alerts.slice(); },
    get selected() { return selected; }, set selected(id) { selected = id; letGo(); draw(); },
    get word() { return word; }, selectWord(id, s) { selected = id; word = s; item = null; draw(); },
    get neume() { return item && Object.assign({}, item); }, selectNeume(id, s, i) { selected = id; item = { s, i }; word = null; mitem = null; draw(); },
    get mensuralItem() { return mitem && Object.assign({}, mitem); }, selectMensural(id, i, n = null) { selected = id; item = null; word = null; mitem = { i, n }; draw(); },
  };
})(window);
