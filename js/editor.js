// The editing layer over the page: staves, and the chant on them. Drag across a staff to add it (its four lines are
// found in the ink, bent if the page is, or spread evenly if they can't be found); select one to move it, drag a
// line's point up or down, or the bar through all four lines at a point (an end, or a bend) to move it; double-click
// a staff to bend it there, or a bend's bar to straighten it; find its lines again, space them evenly, or delete it.
// A staff's chant is drawn on it; a neume (a GABC group: all that stands over a syllable in it) is dragged up or down
// by steps, which rewrites its GABC, or along the staff; Shift-drag moves one note of it. Every change can be undone.
// Everything is drawn in the page's own units (the overlay's viewBox is the page), so it lines up at any zoom.
(function (global) {
  'use strict';
  const S = global.CGStaves, N = global.CGNeumes, C = global.CGChant;
  const SVG = 'http://www.w3.org/2000/svg';
  const HANDLE = 6, MIN_DRAG = 6;   // in screen pixels

  let ctx = null;            // { state, svg, say, changed, pixels(page) }
  let selected = null;       // the selected staff's id
  let item = null;           // the selected neume (an item of the selected staff): { s: syllable, i: item }, by index
  let drag = null;           // what the pointer is doing
  const history = { undo: [], redo: [] };

  function init(c) {
    ctx = c;
    ctx.svg.addEventListener('pointerdown', down);
    ctx.svg.addEventListener('pointermove', move);
    ctx.svg.addEventListener('pointerup', up);
    ctx.svg.addEventListener('dblclick', dbl);
    ctx.svg.addEventListener('pointercancel', () => { if (drag && drag.before) restore(drag.before); drag = null; draw(); });
  }

  // a new document: nothing selected, nothing to undo
  function reset() { selected = null; item = null; drag = null; history.undo.length = history.redo.length = 0; info(); }

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
  const snapshot = () => ({ page: ctx.state.page, staves: JSON.stringify(page().staves), chants: JSON.stringify(ctx.state.doc.chants) });
  function restore(snap) {
    const doc = ctx.state.doc;
    doc.pages[snap.page].staves = JSON.parse(snap.staves);
    doc.chants = JSON.parse(snap.chants);
  }
  function commit(before) {
    const after = snapshot();
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
    if (selected && !ctx.state.doc.pages[h[which].page].staves.some(s => s.id === selected)) selected = null;
    if (!itemOf()) item = null;
    ctx.changed();
    if (h[which].page !== ctx.state.page) ctx.show(h[which].page); else draw();
  }
  const undo = () => step(history.undo, history.redo, 'before');
  const redo = () => step(history.redo, history.undo, 'after');

  // after any change to a staff's lines: its box, its chant's boxes (up and down, to follow its notes), and the
  // staves in reading order
  function settle(st) {
    st.lines = S.roundLines(st.lines);
    st.box = S.box(st.lines, page().size);
    for (const syl of st.syllables) for (const it of syl.items) if (it.box) N.fitBox(st, it);
    page().staves.sort((a, b) => S.middle(a.lines) - S.middle(b.lines));
  }

  function newId() {
    const n = page().n, used = new Set(ctx.state.doc.pages.flatMap(p => p.staves.map(s => s.id)));
    let k = 1 + Math.max(0, ...page().staves.map(s => +(/s(\d+)$/.exec(s.id) || [0, 0])[1]));
    while (used.has(`p${n}s${k}`)) k++;
    return `p${n}s${k}`;
  }

  // ---------------------------------------------------------------- finding lines in the ink
  // region: [x, y, w, h] in page units. The lines found, in page units, or null.
  async function find(region) {
    const px = await ctx.pixels(ctx.state.page);
    const r = S.fitStaff(px.gray, px.w, px.h, region.map(v => v * px.scale));
    return r && r.lines.map(l => l.map(v => v / px.scale));
  }

  async function addStaff(rect) {
    const pg = ctx.state.page, grow = rect[3] * 0.05;
    let lines = null;
    ctx.say('Finding the lines …');
    try { lines = await find([rect[0], rect[1] - grow, rect[2], rect[3] + 2 * grow]); } catch (e) { ctx.say(`Couldn't read the page: ${e.message || e}`, true); }
    if (ctx.state.page !== pg) return;
    const before = snapshot();   // taken now, not before the search, in case another staff was added meanwhile
    const st = { id: newId(), lines: lines || S.even(rect), syllables: [] };
    page().staves.push(st);
    settle(st);
    selected = st.id;
    commit(before);
    ctx.say(!lines ? 'Couldn\'t find four lines there, so they are spread evenly over the box. Drag them into place.'
      : S.count(lines[0]) > 2 ? 'Staff added. It bends, so it has a point at each bend; drag them if they are off.' : 'Staff added. Drag its lines to adjust them if they are off.');
    draw();
  }

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
    item = null;
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
  const boxesOf = st => st.syllables.map(syl => syl.items.map(it => it.box ? it.box.slice() : null));
  function shiftChant(st, boxes, dx, dy) {
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
  // the staff position (a = 0) at a point on the page, on the selected staff, and the size of a step there
  function pitchAt(st, x, y) {
    const b = S.yAt(st.lines[3], x), t = S.yAt(st.lines[0], x), step = (b - t) / 6;
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
    page().staves.forEach(st => st.syllables.forEach((syl, s) => syl.items.forEach((it, i) => { if (it.box) list.push({ id: st.id, s, i }); })));
    if (!list.length) return;
    const at = list.findIndex(v => v.id === selected && item && v.s === item.s && v.i === item.i);
    const v = list[at < 0 ? (d > 0 ? 0 : list.length - 1) : (at + d + list.length) % list.length];
    selected = v.id; item = { s: v.s, i: v.i };
    draw();
  }

  // ---------------------------------------------------------------- the chant on a staff
  // GABC placed on the selected staff: a line of it on each staff from there down the page, as many as its line
  // breaks (z) say. Each staff's chant is laid out along it, its gaps stretched to fill the staff; the chant is
  // listed in the document's chants under its name. Returns false (and says why) if it can't be placed.
  function placeChant(src) {
    const st = staffOf(selected);
    if (!st) { ctx.say('Select the staff the chant begins on first.', true); return false; }
    let r;
    try { r = C.fromGabc(src); } catch (e) { ctx.say(e.message, true); return false; }
    const list = page().staves, from = list.indexOf(st), targets = list.slice(from, from + r.staves.length);
    const before = snapshot();
    item = null;
    targets.forEach((t, k) => {
      t.syllables = JSON.parse(JSON.stringify(r.staves[k].syllables));
      N.place(t);
    });
    const ids = targets.map(t => t.id);
    for (const c of ctx.state.doc.chants) c.staves = (c.staves || []).filter(id => !ids.includes(id));
    ctx.state.doc.chants = ctx.state.doc.chants.filter(c => c.staves.length);
    ctx.state.doc.chants.push({ headers: r.headers, staves: ids });
    commit(before);
    draw();
    const name = r.headers.name ? `${r.headers.name}: ` : '';
    if (r.staves.length > targets.length)
      ctx.say(`${name}placed on ${targets.length} ${targets.length === 1 ? 'staff' : 'staves'}, but it has ${r.staves.length} lines; the last ${r.staves.length - targets.length} had no staff below to go on. Mark more staves and place it again.`, true);
    else ctx.say(`${name}placed on ${targets.length === 1 ? 'the staff' : `${targets.length} staves`}. Hold H to compare it with the page.`);
    return true;
  }

  // the chant taken off the selected staff
  function clearChant() {
    const st = staffOf(selected);
    if (!st || !st.syllables.length) return;
    const before = snapshot();
    st.syllables = [];
    item = null;
    for (const c of ctx.state.doc.chants) c.staves = (c.staves || []).filter(id => id !== st.id);
    ctx.state.doc.chants = ctx.state.doc.chants.filter(c => c.staves.length);
    commit(before);
    draw();
  }

  // the chant the selected staff belongs to (or the first), as GABC with the source's line breaks
  function gabc() {
    const doc = ctx.state.doc;
    const chant = doc.chants.find(c => c.staves.includes(selected)) || doc.chants[0];
    return chant ? { name: chant.headers.name || '', text: C.toGabc(doc, { chant, lines: true }) } : null;
  }

  // a bend added where a staff is double-clicked; a bend's bar double-clicked takes it away
  function dbl(e) {
    const t = e.target.closest('[data-act]');
    if (!t || !t.dataset.staff) return;
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

  // ---------------------------------------------------------------- the pointer
  function down(e) {
    if (e.button !== 0 || !ctx.state.doc) return;
    const t = e.target.closest('[data-act]');
    const act = t ? t.dataset.act : 'new', p = at(e);
    e.preventDefault();
    try { ctx.svg.setPointerCapture(e.pointerId); } catch (err) { }
    if (act === 'new') { drag = { act, from: p, to: p }; return; }
    const id = t.dataset.staff;
    if (act === 'neume') {
      selected = id; item = { s: +t.dataset.s, i: +t.dataset.i };
      const st = staffOf(id), it = itemOf();
      // Shift: only the note nearest the pointer
      let note = null;
      if (e.shiftKey && C.kind(it.g) === 'neume') {
        const here = pitchAt(st, p[0], p[1]).p, ns = C.notes(it.g).filter(n => !n.acc);
        let best = Infinity;
        ns.forEach((n, k) => { const d = Math.abs(n.p.charCodeAt(0) - 97 - here); if (d < best) { best = d; note = k; } });
      }
      drag = { act, from: p, g: it.g, box: it.box.slice(), checked: it.checked, note, before: snapshot(), moved: false };
      draw();
      return;
    }
    item = null;
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
    const xs = S.xsOf(st.lines[0]), t = st.lines[0], b = st.lines[3];
    if (xs.some((x, k) => k && x - xs[k - 1] < 4 * unit()) || xs.some((x, k) => b[2 * k + 1] <= t[2 * k + 1])) st.lines = start;
    draw(true);
  }

  function up(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.act === 'new') {
      if (!d.moved) { if (selected) { selected = null; item = null; draw(); } return; }
      const x = Math.min(d.from[0], d.to[0]), y = Math.min(d.from[1], d.to[1]);
      const rect = [x, y, Math.abs(d.to[0] - d.from[0]), Math.abs(d.to[1] - d.from[1])];
      draw();
      if (rect[2] < 4 * MIN_DRAG * unit()) { ctx.say('Drag across the whole staff, from its first note to its last.'); return; }
      addStaff(rect);
      return;
    }
    if (!d.moved) { draw(); return; }
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
    const u = unit() * (e.shiftKey ? 10 : 1);
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
      return false;
    }
    if (!selected) return false;
    if (k === 'Escape') { selected = null; draw(); return true; }
    if (k === 'Delete' || k === 'Backspace') { remove(); return true; }
    if (k === 'f' || k === 'F') { refit(); return true; }
    if (k === 'e' || k === 'E') { evenly(); return true; }
    if (k === 'ArrowUp') { nudge(0, -u); return true; }
    if (k === 'ArrowDown') { nudge(0, u); return true; }
    if (k === 'ArrowLeft') { nudge(-u, 0); return true; }
    if (k === 'ArrowRight') { nudge(u, 0); return true; }
    if (k === 'Tab') { cycle(e.shiftKey ? -1 : 1); return true; }
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
  function draw(fast) {
    const svg = ctx.svg, pg = page();
    svg.setAttribute('viewBox', `0 0 ${pg.size[0]} ${pg.size[1]}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.replaceChildren();
    const u = unit(), r = HANDLE * u;
    const el = (name, attrs, parent = svg) => { const x = document.createElementNS(SVG, name); for (const k in attrs) x.setAttribute(k, attrs[k]); parent.appendChild(x); return x; };
    el('rect', { x: 0, y: 0, width: pg.size[0], height: pg.size[1], class: 'bg' });
    for (const st of pg.staves) {
      const sel = st.id === selected, g = el('g', { class: 'staff' + (sel ? ' sel' : '') });
      const l = st.lines, s = S.spacing(l) / 2, n = S.count(l[0]);
      const pts = (line, dy) => { const out = []; for (let k = 0; k < n; k++) out.push([line[2 * k], line[2 * k + 1] + dy]); return out; };
      // the staff's area: its lines, half a space beyond the outer ones; grabbing it moves the staff
      el('polygon', { points: pts(l[0], -s).concat(pts(l[3], s).reverse()).map(q => q.join(',')).join(' '), class: 'area', 'data-act': 'body', 'data-staff': st.id }, g);
      for (const ln of l) el('polyline', { points: pts(ln, 0).map(q => q.join(',')).join(' '), class: 'line', 'data-act': 'body', 'data-staff': st.id }, g);
      // the chant: its glyphs where they are, along the staff (tilted with it); its words under it
      if (st.syllables.some(syl => syl.items.some(it => it.box))) {
        const L = N.layout(st), ch = el('g', { class: 'chant' }, g);
        const isSel = (s, i) => sel && item && item.s === s && item.i === i;
        for (const v of L.glyphs) {
          const cls = 'glyph' + (v.conf !== undefined && v.conf < 0.8 && !v.checked ? ' doubt' : '') + (isSel(v.syllable, v.item) ? ' on' : '');
          const t = el('text', { x: v.x, y: v.y, 'font-size': L.size, class: cls, transform: `rotate(${v.angle.toFixed(3)} ${v.x} ${v.y})` }, ch);
          t.textContent = v.ch;
        }
        for (const v of L.texts) {
          const t = el('text', { x: v.x, y: v.y, 'font-size': L.textSize, class: 'syl' }, ch);
          t.textContent = v.text.replace(/<[^>]*>/g, '');
        }
      }
      // each neume's box, to grab it by (at least a few pixels wide, for a bar); the selected one outlined
      st.syllables.forEach((syl, s) => syl.items.forEach((it, i) => {
        if (!it.box) return;
        const w = Math.max(it.box[2], 8 * u), x = it.box[0] + it.box[2] / 2 - w / 2;
        el('rect', { x, y: it.box[1], width: w, height: it.box[3], class: 'neume' + (sel && item && item.s === s && item.i === i ? ' on' : ''), 'data-act': 'neume', 'data-staff': st.id, 'data-s': s, 'data-i': i }, g);
      }));
      if (!sel || item) continue;
      // the dots no bigger than a third of a space, so the bar between them can still be grabbed
      const rr = Math.max(2.5 * u, Math.min(r, S.spacing(l) / 3));
      // at each point (the ends, and any bends): a bar through all four lines, and a dot on each line
      for (let k = 0; k < n; k++) {
        const xi = 2 * k;
        const bar = { x1: l[0][xi], y1: l[0][xi + 1] - s, x2: l[3][xi], y2: l[3][xi + 1] + s };
        el('line', Object.assign({ class: k && k < n - 1 ? 'end bend' : 'end' }, bar), g);
        el('line', Object.assign({ class: 'hit', 'data-act': 'knot', 'data-staff': st.id, 'data-knot': k }, bar), g);
        l.forEach((ln, i) => el('circle', { cx: ln[xi], cy: ln[xi + 1], r: rr, class: 'handle', 'data-act': 'point', 'data-staff': st.id, 'data-knot': k, 'data-line': i }, g));
      }
    }
    if (drag && drag.act === 'new' && drag.moved) {
      const [a, b] = [drag.from, drag.to];
      el('rect', { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), class: 'band' });
    }
    if (!fast) info();
  }

  // the side panel: how many staves, and the selected one's measurements
  function info() {
    const out = document.getElementById('staffInfo');
    if (!out || !ctx || !ctx.state.doc) return;
    const list = page().staves, st = staffOf(selected);
    const n = list.length;
    let text = n ? `${n} ${n === 1 ? 'staff' : 'staves'} on this page.` : 'No staves on this page yet.';
    if (st) {
      const bends = S.count(st.lines[0]) - 2;
      text += ` Staff ${list.indexOf(st) + 1} is selected: lines ${S.spacing(st.lines).toFixed(1)} apart, tilted ${S.tilt(st.lines).toFixed(2)}°` +
        (bends ? `, bent at ${bends} ${bends === 1 ? 'point' : 'points'} (up to ${S.bend(st.lines).toFixed(1)} spaces off straight).` : '.');
    }
    out.textContent = text;
    for (const id of ['refit', 'evenly', 'remove']) document.getElementById(id).disabled = !st;
    const place = document.getElementById('placeChant');
    if (place) {
      place.disabled = !st;
      document.getElementById('clearChant').disabled = !st || !st.syllables.length;
      document.getElementById('downloadGabc').disabled = !ctx.state.doc.chants.length;
      const chant = st && ctx.state.doc.chants.find(c => c.staves.includes(st.id)), it = itemOf();
      document.getElementById('chantInfo').textContent = it ? neumeInfo(st, it) : !st ? 'Select the staff the chant begins on.'
        : chant ? `This staff has ${chant.headers.name ? `"${chant.headers.name}"` : 'a chant'} on it (${chant.staves.length} ${chant.staves.length === 1 ? 'staff' : 'staves'}).`
        : 'This staff has no chant yet.';
    }
    document.getElementById('undo').disabled = !history.undo.length;
    document.getElementById('redo').disabled = !history.redo.length;
  }

  // what the side panel says of a neume: its GABC, its syllable, its notes by name, and whether it's been checked
  function neumeInfo(st, it) {
    const syl = st.syllables[item.s], kind = C.kind(it.g);
    const clef = (C.withClefs(st).find(v => v.syllable === item.s && v.item === item.i) || {}).clef;
    const names = kind === 'neume' || kind === 'custos' ? C.notes(it.g).filter(n => !n.acc).map(n => { const q = C.pitch(n.p, clef); return q ? q.step + q.octave : n.p; }).join(' ') : '';
    const how = { item: 'checked', edited: 'changed by you (so checked)', staff: 'checked with its staff' }[it.checked] || 'not checked yet';
    return `(${it.g})` + (syl.text ? ` over "${syl.text.replace(/<[^>]*>/g, '')}"` : '') + (names ? `: ${names}` : '') + `. ${how[0].toUpperCase() + how.slice(1)}.` +
      ' Drag it, or use the arrow keys; Shift-drag moves one note; Enter accepts it and goes on; Tab skips; Delete takes it out.';
  }

  global.CGEditor = {
    init, reset, draw, key, undo, redo, refit, evenly, remove, addStaff, placeChant, clearChant, gabc,
    get selected() { return selected; }, set selected(id) { selected = id; item = null; draw(); },
    get neume() { return item && Object.assign({}, item); }, selectNeume(id, s, i) { selected = id; item = { s, i }; draw(); },
  };
})(window);
