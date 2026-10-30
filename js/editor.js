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
  const S = global.CGStaves, N = global.CGNeumes, C = global.CGChant, K = global.CGChecks, X = global.CGExport, R = global.CGRecognizer;
  const SVG = 'http://www.w3.org/2000/svg';
  const HANDLE = 6, MIN_DRAG = 6;   // in screen pixels

  let ctx = null;            // { state, svg, say, changed, pixels(page) }
  let selected = null;       // the selected staff's id
  let item = null;           // the selected neume (an item of the selected staff): { s: syllable, i: item }, by index
  let word = null;           // or the selected syllable's words: the syllable's index on the selected staff
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
  const snapshot = () => ({ page: ctx.state.page, staves: JSON.stringify(page().staves), chants: JSON.stringify(ctx.state.doc.chants) });
  const snapshotAll = () => ({ page: null, staves: JSON.stringify(ctx.state.doc.pages.map(p => p.staves)), chants: JSON.stringify(ctx.state.doc.chants) });
  function restore(snap) {
    const doc = ctx.state.doc;
    if (snap.page === null) JSON.parse(snap.staves).forEach((list, k) => { doc.pages[k].staves = list; });
    else doc.pages[snap.page].staves = JSON.parse(snap.staves);
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

  // ---------------------------------------------------------------- finding lines in the ink
  // region: [x, y, w, h] in page units. The lines found, in page units, or null.
  async function find(region) {
    const px = await ctx.pixels(ctx.state.page);
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
    const st = { id: newId(), lines: lines || S.even(rect), syllables: [] };
    page().staves.push(st);
    settle(st);
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
    const found = S.findStaves(px.gray, px.w, px.h, { skip, lines: px.lines });
    return stale() ? null : found.map(r => r.lines.map(l => l.map(v => v / px.scale)));
  }
  function addFound(pg, found) {
    const p = ctx.state.doc.pages[pg];
    for (const lines of found) {
      const st = { id: newId(p), lines, syllables: [] };
      p.staves.push(st);
      settle(st, p);
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
  // the selected syllable, or null
  function sylOf() {
    const st = staffOf(selected);
    return st && word !== null && st.syllables[word] || null;
  }
  // nothing selected within the staff
  const letGo = () => { item = null; word = null; };
  const DOUBT = 0.8;
  const doubtful = x => x.conf !== undefined && x.conf < DOUBT && !x.checked;

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
  async function readNotes(all) {
    const list = all ? page().staves.slice() : [staffOf(selected)].filter(Boolean);
    if (!list.length) { ctx.say(all ? 'No staves on this page: find them first.' : 'Select a staff first.', true); return; }
    if (busy) return;
    busy = true;
    ctx.say('Reading the notes … (the first time, the recognizer is loaded)');
    const before = snapshot(), pg = ctx.state.page, tally = { put: 0, same: 0, differ: 0, unseen: 0, extra: 0 };
    let ok = 0;
    for (const st of list) {
      const r = await readStaff(st, pg);
      if (!r) break;
      ok++;
      for (const k in r) tally[k] += r[k];
    }
    busy = false;
    if (!ok) { info(); return; }
    commit(before);
    letGo();
    draw();
    const parts = [];
    if (tally.put) parts.push(`${tally.put} neumes read onto ${list.length === 1 ? 'the staff' : 'staves without chant'}`);
    if (tally.same + tally.differ + tally.unseen) parts.push(`of the chant's neumes, ${tally.same} read as written, ${tally.differ} read otherwise, ${tally.unseen} not seen`);
    if (tally.extra) parts.push(`${tally.extra} more seen on the page than the chant has`);
    ctx.say(`${ok === 1 ? 'Staff' : `${ok} staves`} read: ${parts.join('; ') || 'nothing found'}. Where they differ, the neume is marked in orange; select it to see what was read.`);
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

  // ---------------------------------------------------------------- the right-click menu
  // What's under the pointer selected, and what can be done with it offered (app.js shows the menu): a neume, a
  // syllable's words, a staff, or the page.
  const SHAPES = [['punctum', 'Punctum'], ['virga', 'Virga'], ['inclinatum', 'Inclinatum'], ['quilisma', 'Quilisma'], ['oriscus', 'Oriscus']];
  function contextMenu(e) {
    if (!ctx.state.doc || !ctx.menu) return;
    e.preventDefault();
    const t = e.target.closest('[data-act]'), act = t ? t.dataset.act : 'page', p = at(e), x = e.clientX, y = e.clientY;
    if (act === 'alert') { goTo(alerts[+t.dataset.k]); return; }
    if (act === 'neume') {
      selected = t.dataset.staff; item = { s: +t.dataset.s, i: +t.dataset.i }; word = null; draw();
      const st = staffOf(selected), it = itemOf(), kd = C.kind(it.g);
      const ns = kd === 'neume' ? C.notes(it.g).filter(n => !n.acc) : [];
      // the note under the pointer, whose shape the row sets
      const k = ns.length ? noteUnder(st, it, p) : 0, now = ns.length ? C.shapeOf(ns[k]) : null;
      const falls = ns.length >= 3 && ns.every((n, j) => !j || n.p < ns[j - 1].p);
      const nxt = st.syllables[item.s].items[item.i + 1];
      ctx.menu([
        { title: `Neume (${it.g})${ns.length > 1 ? `, note ${k + 1} of ${ns.length}` : ''}` },
        ns.length ? { shapes: SHAPES.map(([sh, label]) => ({ label, on: now === sh, title: `This note as a ${sh}`, run: () => reshape(k, sh) })) } : null,
        falls ? { label: 'Climacus: the falling notes as diamonds', run: () => climacus() } : null,
        '-',
        ns.length > 1 ? { label: k ? `Split the neume before note ${k + 1}` : 'Split the neume (point at a later note)', disabled: !k, title: 'Two neumes from here: the notes before this one, and this one on', run: () => splitNeume(k) } : null,
        { label: 'Join to the next neume', key: 'J', disabled: !nxt || kd !== 'neume' || C.kind(nxt.g) !== 'neume', title: 'This neume and the next one in the syllable as one', run: joinNext },
        { label: 'Accept', key: 'Enter', run: acceptNeume },
        { label: 'Next doubtful', key: 'Tab', run: () => nextNeume(1) },
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
        { label: 'Read the notes', disabled: busy, run: () => readNotes(false) },
        { label: 'Accept the staff', key: 'Shift+Enter', disabled: !st.syllables.length, run: acceptStaff },
        { label: st.begins === true ? 'A chant begins on this staff ✓' : 'A chant begins on this staff', key: 'B', run: () => toggleBegins() },
        typeof st.beginsAt === 'number' ? { label: 'Take off the mid-line chant start', run: () => beginsAt(null) }
          : { label: 'A chant begins here, at this point', title: 'Part way along the staff, where you clicked (before an initial, say)', run: () => beginsAt(p[0]) },
        '-',
        { label: 'Find its lines again', key: 'F', run: refit },
        { label: 'Space the lines evenly', key: 'E', run: evenly },
        { label: 'Straighten', disabled: !bent, run: straighten },
        { label: 'Take its chant off', disabled: !st.syllables.length, run: clearChant },
        { label: 'Delete the staff', key: 'Del', run: remove },
      ], x, y);
      return;
    }
    // the page
    if (selected) { selected = null; letGo(); draw(); }
    const list = page().staves;
    ctx.menu([
      { title: `Page ${ctx.state.page + 1}` },
      { label: 'Find the staves', disabled: busy, run: findHere },
      { label: 'Read the whole page', disabled: !list.length || busy, run: () => readNotes(true) },
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

  // ---------------------------------------------------------------- the pointer
  function down(e) {
    if (e.button !== 0 || !ctx.state.doc) return;
    const t = e.target.closest('[data-act]');
    const act = t ? t.dataset.act : 'new', p = at(e);
    e.preventDefault();
    try { ctx.svg.setPointerCapture(e.pointerId); } catch (err) { }
    if (act === 'new') { drag = { act, from: p, to: p }; return; }
    if (act === 'alert') { goTo(alerts[+t.dataset.k]); return; }
    const id = t.dataset.staff;
    if (act === 'syl') {
      selected = id; word = +t.dataset.s; item = null;
      const syl = sylOf();
      drag = { act, from: p, box: wordBox(word), had: syl.box ? syl.box.slice() : null, checked: syl.checked, before: snapshot(), moved: false };
      draw();
      return;
    }
    if (act === 'neume') {
      selected = id; item = { s: +t.dataset.s, i: +t.dataset.i }; word = null;
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
    if (drag.act === 'syl') {
      const syl = sylOf();
      if (!syl || !drag.box) return;
      syl.box = [drag.box[0] + dx, drag.box[1] + dy, drag.box[2], drag.box[3]].map(v => Math.round(v * 100) / 100);
      syl.checked = 'edited';
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
    const xs = S.xsOf(st.lines[0]), t = st.lines[0], b = st.lines[3];
    if (xs.some((x, k) => k && x - xs[k - 1] < 4 * unit()) || xs.some((x, k) => b[2 * k + 1] <= t[2 * k + 1])) st.lines = start;
    draw(true);
  }

  function up(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.act === 'new') {
      if (!d.moved) { if (selected) { selected = null; letGo(); draw(); } return; }
      const x = Math.min(d.from[0], d.to[0]), y = Math.min(d.from[1], d.to[1]);
      const rect = [x, y, Math.abs(d.to[0] - d.from[0]), Math.abs(d.to[1] - d.from[1])];
      draw();
      if (rect[2] < 4 * MIN_DRAG * unit()) { ctx.say('Drag across the whole staff, from its first note to its last.'); return; }
      addStaff(rect);
      return;
    }
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
      // a chant begins here: a mark before the staff
      if (st.begins === true) {
        const x = l[0][0] - 1.6 * s, y0 = l[0][1] - 2 * s, y1 = l[3][1] + 2 * s;
        const m = el('g', { class: 'begins' }, g);
        el('line', { x1: x, y1: y0, x2: x, y2: y1 }, m);
        el('polygon', { points: `${x},${y0} ${x + 2.4 * s},${y0 + 1.2 * s} ${x},${y0 + 2.4 * s}` }, m);
        el('title', {}, m).textContent = 'A chant begins here';
      }
      // a chant begins part way along: a flag at the point
      if (typeof st.beginsAt === 'number') {
        const x = st.beginsAt, y0 = S.yAt(l[0], x) - 2 * s, y1 = S.yAt(l[3], x) + 2 * s;
        const m = el('g', { class: 'begins mid' }, g);
        el('line', { x1: x, y1: y0, x2: x, y2: y1 }, m);
        el('polygon', { points: `${x},${y0} ${x + 2.4 * s},${y0 + 1.2 * s} ${x},${y0 + 2.4 * s}` }, m);
        el('title', {}, m).textContent = 'A chant begins here, part way along the staff';
      }
      // the chant: its glyphs where they are, along the staff (tilted with it); its words under it
      if (st.syllables.some(syl => syl.items.some(it => it.box))) {
        const L = N.layout(st), ch = el('g', { class: 'chant' }, g);
        const isSel = (s, i) => sel && item && item.s === s && item.i === i;
        for (const v of L.glyphs) {
          const cls = 'glyph' + (v.checked ? ' ok' : v.conf !== undefined && v.conf < DOUBT ? ' doubt' : '') + (isSel(v.syllable, v.item) ? ' on' : '');
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
        el('rect', { x, y: it.box[1], width: w, height: it.box[3], class: 'neume' + (sel && item && item.s === s && item.i === i ? ' on' : ''), 'data-act': 'neume', 'data-staff': st.id, 'data-s': s, 'data-i': i }, g);
      }));
      if (!sel || item || word !== null) continue;
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
    // the checks' findings on this page: a mark over each place (a whole staff's at its start), to click
    if (!fast) alerts = K.check(ctx.state.doc);
    for (const [k, a] of alerts.entries()) {
      if (a.page !== ctx.state.page) continue;
      const st = pg.staves.find(v => v.id === a.staff), it = st && a.i !== null && st.syllables[a.s] && st.syllables[a.s].items[a.i];
      if (!st) continue;
      const x = it && it.box ? it.box[0] + it.box[2] / 2 : S.xsOf(st.lines[0])[0], top = S.yAt(st.lines[0], x) - 2.2 * S.spacing(st.lines);
      const r2 = 0.55 * S.spacing(st.lines), m = el('g', { class: 'mark ' + a.level, 'data-act': 'alert', 'data-k': k });
      el('circle', { cx: x, cy: top, r: r2 }, m);
      const t = el('text', { x, y: top + 0.35 * r2 * 2, 'font-size': 1.3 * r2 }, m);
      t.textContent = '!';
      el('title', {}, m).textContent = a.text;
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
    let text = n ? `${n} ${n === 1 ? 'staff' : 'staves'} on this page.` : 'No staves on this page yet: Find staves, or drag a box around one.';
    if (st) {
      const bends = S.count(st.lines[0]) - 2;
      text += ` Staff ${list.indexOf(st) + 1} selected: lines ${S.spacing(st.lines).toFixed(1)} apart, tilted ${S.tilt(st.lines).toFixed(2)}°` +
        (bends ? `, bent at ${bends} ${bends === 1 ? 'point' : 'points'}.` : '.');
    }
    out.textContent = text;
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
      place.disabled = !st;
      document.getElementById('clearChant').disabled = !st || !st.syllables.length;
      document.getElementById('readStaff').disabled = !st || busy;
      document.getElementById('readPage').disabled = !list.length || busy;
      document.getElementById('readBreaks').disabled = !st || !ctx.state.doc.chants.some(c => c.staves.includes(st.id) && c.staves.length > 1);
      document.getElementById('downloadGabc').disabled = !ctx.state.doc.chants.length;
      const chant = st && ctx.state.doc.chants.find(c => c.staves.includes(st.id)), it = itemOf(), syl = sylOf();
      wordPanel(syl);
      document.getElementById('splitHere').disabled = !it || item.i === 0;
      document.getElementById('linePrev').disabled = document.getElementById('lineNext').disabled = !it && !syl;
      document.getElementById('acceptStaff').disabled = !st || !st.syllables.length;
      document.getElementById('chantInfo').textContent = it ? neumeInfo(st, it) : syl ? '' : !st ? ''
        : st.syllables.length ? progress(st)
        : chant ? `This staff has ${chant.headers.name ? `"${chant.headers.name}"` : 'a chant'} on it (${chant.staves.length} ${chant.staves.length === 1 ? 'staff' : 'staves'}).`
        : 'This staff has no chant yet.';
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
    if (show) ctx.show(a.page); else draw();
    ctx.say(a.text, a.level === 'warn');
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
    const its = st.syllables.flatMap(syl => syl.items.filter(it => it.box)), words = st.syllables.filter(syl => syl.text);
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
    init, reset, draw, key, undo, redo, refit, evenly, remove, addStaff, placeChant, beginsAt, clearChant, gabc, findHere, findEverywhere, stop, findBeginnings, toggleBegins,
    setText, setDipl, setWordStart, splitHere, joinPrev, splitNeume, joinNext, acceptStaff, acceptWord, volpiano, mei, moveLine, placePage, placeOne, bookPage, readBreaks, readNotes,
    get alerts() { return alerts.slice(); },
    get selected() { return selected; }, set selected(id) { selected = id; letGo(); draw(); },
    get word() { return word; }, selectWord(id, s) { selected = id; word = s; item = null; draw(); },
    get neume() { return item && Object.assign({}, item); }, selectNeume(id, s, i) { selected = id; item = { s, i }; word = null; draw(); },
  };
})(window);
