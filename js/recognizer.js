// The recognizer: reads the notes on a staff from the scan. The staff is cut out and straightened along its own lines,
// at the size the model learnt from (training/staffdata.py does the same), and the model (training/recognizer.py,
// run here with ONNX Runtime) reads it as a sequence of tokens: clefs, notes (staff position and shape), bars, custos,
// and the breaks between glyphs (/) and between neumes (|). Each neume read has its GABC, where it lies along the staff
// and how sure the model is of it. Nothing leaves the browser.
(function (global) {
  'use strict';
  const S = () => global.CGStaves;
  // models/chant.onnx and models/chant.json (its tokens and how it cuts a staff): printed books; models/chant-ms.*:
  // manuscripts (a page whose staves are ruled in red, as viewer.js's pixels() tells), if there is one
  // models/mensural.*: mensural notation (CGMensural's text form, a token to an item, a ligature's brackets and joins
  // apart), five-line staves cut as training/fivestaves.py and mensuralsynth.py cut them
  const BASES = { print: 'models/chant', ms: 'models/chant-ms', text: 'models/text', mensural: 'models/mensural' };

  // ---------------------------------------------------------------- the staff, straightened
  // gray: the page in grey (w × h), lines: the staff's four lines in the same pixels; meta: as models/chant.json says.
  // Returns { data (ink, 0 to 1, height rows of W), W, x0 (the image's first column on the page), step (page pixels to
  // a column) }.
  function straighten(gray, w, h, lines, meta) {
    // (a staff of five lines, as the 16th-18th-century choirbooks rule them: its top line at row 14, not 20, so that
    // its fifth, at 46, leaves room below; the model has learnt both, from training/fivestaves.py's strips)
    const n = lines.length, H = meta.height, sp = meta.space, top = n === 5 ? (meta.top5 || 14) : meta.top;
    const xs = [0, n - 1].map(i => S().xsOf(lines[i]));
    const midX = (xs[0][0] + xs[0][xs[0].length - 1]) / 2;
    const g = (S().yAt(lines[n - 1], midX) - S().yAt(lines[0], midX)) / (n - 1);
    const x0 = xs[0][0] - meta.left * g, x1 = xs[0][xs[0].length - 1] + meta.right * g;
    const W = Math.max(1, Math.round((x1 - x0) / g * sp)), step = g / sp;
    const data = new Float32Array(H * W);
    // (beyond the staff's ends its lines run on straight from the last point, as numpy's interp holds them level)
    const at = (l, x) => { const v = S().xsOf(l); return S().yAt(l, Math.min(v[v.length - 1], Math.max(v[0], x))); };
    // (between the lines, from line to line: a hand-ruled staff's spaces can differ a good deal; beyond them, at the
    // staff's mean space)
    for (let u = 0; u < W; u++) {
      const cx = x0 + (u + 0.5) * step, ys = lines.map(l => at(l, cx)), mean = (ys[n - 1] - ys[0]) / (n - 1);
      for (let v = 0; v < H; v++) {
        const s = (v + 0.5 - top) / sp, k = Math.max(0, Math.min(n - 2, Math.floor(s)));
        const py = s < 0 ? ys[0] + s * mean : s > n - 1 ? ys[n - 1] + (s - (n - 1)) * mean : ys[k] + (s - k) * (ys[k + 1] - ys[k]);
        data[v * W + u] = 1 - sample(gray, w, h, cx, py) / 255;
      }
    }
    return { data, W, x0, step };
  }
  // The words under a staff, cut as a strip the text reader reads: rows from meta.from to meta.to staff spaces below
  // the top line (the bottom line is 3; the words' baseline is about 5), following the staff's slope and bends; the
  // columns at meta.across to a staff space (fewer than the rows have: letters are taller than a note is wide).
  const TEXT = { height: 64, from: 3.3, to: 6.3, across: 12, left: 0.6, right: 0.4 };
  function textBand(gray, w, h, lines, meta = TEXT) {
    // (five lines: the words a space lower, under the fifth)
    const n = lines.length, below = n - 4, H = meta.height, xs = S().xsOf(lines[n - 1]);
    const mid = (xs[0] + xs[xs.length - 1]) / 2, g = (S().yAt(lines[n - 1], mid) - S().yAt(lines[0], mid)) / (n - 1);
    const x0 = xs[0] - meta.left * g, x1 = xs[xs.length - 1] + meta.right * g;
    const W = Math.max(1, Math.round((x1 - x0) / g * meta.across)), step = g / meta.across;
    const data = new Float32Array(H * W);
    const at = (l, x) => { const v = S().xsOf(l); return S().yAt(l, Math.min(v[v.length - 1], Math.max(v[0], x))); };
    for (let u = 0; u < W; u++) {
      const cx = x0 + (u + 0.5) * step, top = at(lines[0], cx), bot = at(lines[n - 1], cx), sp = (bot - top) / (n - 1);
      for (let v = 0; v < H; v++) {
        const s = below + meta.from + (v + 0.5) / H * (meta.to - meta.from);
        data[v * W + u] = 1 - sample(gray, w, h, cx, top + s * sp) / 255;
      }
    }
    return { data, W, x0, step };
  }
  function sample(img, w, h, px, py) {
    if (px < 0 || px > w - 1 || py < 0 || py > h - 1) return 255;
    const x0 = Math.min(w - 2, Math.floor(px)), y0 = Math.min(h - 2, Math.floor(py)), fx = px - x0, fy = py - y0;
    const a = img[y0 * w + x0] * (1 - fx) + img[y0 * w + x0 + 1] * fx, b = img[(y0 + 1) * w + x0] * (1 - fx) + img[(y0 + 1) * w + x0 + 1] * fx;
    return a * (1 - fy) + b * fy;
  }

  // ---------------------------------------------------------------- reading the model's scores
  // scores: (tokens + 1) × T, the blank first. The best token at each step, repeats merged, blanks dropped: each with
  // the steps it spans and its probability (the best of its steps').
  function decode(scores, T, vocab) {
    const C = vocab.length + 1, out = [];
    let prev = 0;
    for (let t = 0; t < T; t++) {
      let best = 0, bv = -Infinity, sum = 0;
      for (let c = 0; c < C; c++) { const v = scores[c * T + t]; if (v > bv) { bv = v; best = c; } }
      for (let c = 0; c < C; c++) sum += Math.exp(scores[c * T + t] - bv);
      const p = 1 / sum;
      if (best !== 0 && best !== prev) out.push({ t: vocab[best - 1], from: t, to: t, p });
      else if (best !== 0 && out.length) { const o = out[out.length - 1]; o.to = t; o.p = Math.max(o.p, p); }
      prev = best;
    }
    return out;
  }

  const isClef = t => /^[cf]b?[1-5]$/.test(t), isBar = t => /^(::|:|;|,|`)$/.test(t), isCustos = t => /^[a-np]\+$/.test(t);
  // The tokens read gathered into neumes (GABC groups, as they stand over a syllable): split at |; a clef, bar or custos
  // always a group of its own. Each: { g, from, to (steps), conf (its least sure token's probability) }.
  function groups(read) {
    const out = [];
    let cur = null;
    const close = () => { if (cur && cur.g) { cur.g = cur.g.replace(/\/+$/, ''); if (cur.g) out.push(cur); } cur = null; };
    for (const r of read) {
      if (r.t === '|') { close(); continue; }
      if (isClef(r.t) || isBar(r.t) || isCustos(r.t)) { close(); out.push({ g: r.t, from: r.from, to: r.to, conf: r.p }); continue; }
      if (!cur) cur = { g: '', from: r.from, to: r.to, conf: 1 };
      if (r.t === '/' && (!cur.g || cur.g.endsWith('/'))) continue;
      cur.g += r.t; cur.to = r.to; cur.conf = Math.min(cur.conf, r.p);
    }
    close();
    return out;
  }

  // ---------------------------------------------------------------- the model
  const loaded = {};
  let meta = null;
  function script(src) {
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error(`Couldn't load ${src}`)); document.head.appendChild(s); });
  }
  // a model ('print' or 'ms'), loaded the first time it's wanted; the manuscript one falls back to the printed one
  function load(kind = 'print') {
    if (loaded[kind]) return loaded[kind];
    const p = loaded[kind] = (async () => {
      if (!global.ort) await script('vendor/onnxruntime/ort.wasm.min.js');
      global.ort.env.wasm.wasmPaths = new URL('vendor/onnxruntime/', document.baseURI).href;
      if (!global.crossOriginIsolated) global.ort.env.wasm.numThreads = 1;
      const r = await fetch(BASES[kind] + '.json');
      if (!r.ok) {
        if (kind === 'text') throw new Error('No text reader here yet (models/text.json).');
        if (kind === 'mensural') throw new Error('No reader of mensural notation here yet (models/mensural.json).');
        if (kind !== 'print') return load('print');
        throw new Error('No recognizer model here yet (models/chant.json).');
      }
      const m = await r.json();
      const session = await global.ort.InferenceSession.create(BASES[kind] + '.onnx', { executionProviders: ['wasm'] });
      if (kind === 'print') meta = m;
      return { session, meta: m };
    })();
    p.catch(() => { delete loaded[kind]; });
    return p;
  }

  // The neumes on a staff, read: px, the page's pixels (viewer.js: { gray, w, h, scale, lines }); lines in page units.
  // Returns [{ g, x0, x1 (page units), conf }], in order along the staff. kind: 'print' or 'ms' (which model), or
  // 'auto': a page ruled in red is read by the manuscript model.
  async function read(px, lines, kind = 'auto') {
    const { session: s, meta: m } = await load(kind === 'auto' ? (px.lines ? 'ms' : 'print') : kind);
    const L = lines.map(l => l.map(v => v * px.scale));
    const st = straighten(px.gray, px.w, px.h, L, m);
    const W = st.W + ((-st.W) % m.stride + m.stride) % m.stride, data = new Float32Array(m.height * W);
    for (let v = 0; v < m.height; v++) data.set(st.data.subarray(v * st.W, (v + 1) * st.W), v * W);
    const out = await s.run({ staff: new global.ort.Tensor('float32', data, [1, 1, m.height, W]) });
    const sc = out.scores, T = sc.dims[2];
    const T0 = Math.floor(st.W / m.stride);
    const gs = groups(decode(sc.data, T, m.vocab).filter(r => r.from < T0));
    // a step's columns, back on the page
    const xOf = t => (st.x0 + (t * m.stride + m.stride / 2) * st.step) / px.scale;
    const half = 0.5 * m.stride * st.step / px.scale;
    return gs.map(v => ({ g: v.g, x0: xOf(v.from) - half, x1: xOf(v.to) + half, conf: Math.round(v.conf * 100) / 100 }));
  }

  // The words under a staff, read: each letter (a space between words) with where it is along the page (x, page
  // units) and how sure the reader is of it; and the staff's space, in page units.
  async function readText(px, lines) {
    const { session: s, meta: m } = await load('text');
    const L = lines.map(l => l.map(v => v * px.scale));
    const tb = textBand(px.gray, px.w, px.h, L);
    const W = tb.W + ((-tb.W) % m.stride + m.stride) % m.stride, data = new Float32Array(m.height * W);
    for (let v = 0; v < m.height; v++) data.set(tb.data.subarray(v * tb.W, (v + 1) * tb.W), v * W);
    const out = await s.run({ staff: new global.ort.Tensor('float32', data, [1, 1, m.height, W]) });
    const sc = out.scores, T = sc.dims[2], T0 = Math.floor(tb.W / m.stride);
    const xOf = t => (tb.x0 + (t * m.stride + m.stride / 2) * tb.step) / px.scale;
    // (letters and spaces only: the reader also knows a few marks — a hyphen, a dagger, the Nidaros print's
    // abbreviation signs — that aren't words to put under notes)
    const letters = decode(sc.data, T, m.vocab).filter(r => r.from < T0 && (r.t === ' ' || /^[A-Za-zÀ-ɏ]$/.test(r.t))).map(r => ({ t: r.t, x: xOf((r.from + r.to) / 2), p: Math.round(r.p * 100) / 100 }));
    return { letters, space: TEXT.across * tb.step / px.scale };
  }

  // The tokens of a mensural reading gathered into items (CGMensural's): each token one, but a ligature's, from its [ to
  // its ] (or ]*, blackened), with ~ joining two of its notes into an oblique. Each: { item, from, to (steps), conf }.
  // A token the text form doesn't take (a ligature broken off, say) is left out.
  function mensuralItems(read) {
    const M = global.CGMensural, out = [];
    let lig = null;
    for (const r of read) {
      if (r.t === '[') { lig = { toks: [], from: r.from, to: r.to, conf: r.p }; continue; }
      if (lig) {
        lig.to = r.to; lig.conf = Math.min(lig.conf, r.p);
        if (r.t === ']' || r.t === ']*') {
          try { const it = M.parse('[' + lig.toks.join(' ').replace(/ ~ /g, '~') + r.t)[0]; out.push({ item: it, from: lig.from, to: lig.to, conf: lig.conf }); } catch (e) { }
          lig = null;
        } else lig.toks.push(r.t);
        continue;
      }
      if (r.t === ']' || r.t === ']*' || r.t === '~') continue;
      try { const it = M.parse(r.t)[0]; if (it) out.push({ item: it, from: r.from, to: r.to, conf: r.p }); } catch (e) { }
    }
    return out;
  }
  // The mensural notation on a staff (five lines), read: [{ item (CGMensural's, its x where it was seen, page units),
  // x0, x1, conf }], in order along the staff.
  async function readMensural(px, lines) {
    const { session: s, meta: m } = await load('mensural');
    const L = lines.map(l => l.map(v => v * px.scale));
    const st = straighten(px.gray, px.w, px.h, L, m);
    const W = st.W + ((-st.W) % m.stride + m.stride) % m.stride, data = new Float32Array(m.height * W);
    for (let v = 0; v < m.height; v++) data.set(st.data.subarray(v * st.W, (v + 1) * st.W), v * W);
    const out = await s.run({ staff: new global.ort.Tensor('float32', data, [1, 1, m.height, W]) });
    const sc = out.scores, T = sc.dims[2], T0 = Math.floor(st.W / m.stride);
    const xOf = t => (st.x0 + (t * m.stride + m.stride / 2) * st.step) / px.scale, half = 0.5 * m.stride * st.step / px.scale;
    const g = st.step * m.space / px.scale;                     // (a staff space, in page units)
    return mensuralItems(decode(sc.data, T, m.vocab).filter(r => r.from < T0)).map(v => {
      const x0 = xOf(v.from) - half, x1 = xOf(v.to) + half;
      // (where it is drawn: on its ink, near where the reader saw it; its left edge where its middle comes so)
      const mid = onInk(st, m, (v.from + v.to + 1) / 2 * m.stride, v.item);
      const x = mid === null ? x0 : (st.x0 + mid * st.step) / px.scale - global.CGMensural.itemWidth(v.item) * g / 2;
      return { item: Object.assign(v.item, { x: Math.round(x * 10) / 10 }), x0, x1, conf: Math.round(v.conf * 100) / 100 };
    });
  }
  // Where a sign the reader read is, along its straightened staff (st: straighten()'s, in its columns): the reader says
  // when it read the sign, which comes a little after the sign (by about a third of a space) and wanders; so the ink
  // nearest that, within a space and a quarter (the staff's lines left out): the middle of the strongest run of inked
  // columns there. null for a ligature (several notes: drawn from where the reader began it) or with no ink near.
  function onInk(st, m, u, item) {
    if (!item || item.k === 'lig') return null;
    if (!st.ink) {
      const H = m.height, sp = m.space, top = m.top5 || 14, lineRow = new Uint8Array(H);
      for (let k = 0; k < 5; k++) for (let d = -1; d <= 1; d++) { const r = Math.round(top + k * sp) + d; if (r >= 0 && r < H) lineRow[r] = 1; }
      const col = new Float32Array(st.W);
      for (let v = 0; v < H; v++) if (!lineRow[v]) for (let x = 0; x < st.W; x++) if (st.data[v * st.W + x] > 0.5) col[x]++;
      st.ink = col.map((c, x) => (col[Math.max(0, x - 1)] + c + col[Math.min(st.W - 1, x + 1)]) / 3);
    }
    const r = Math.round(1.25 * m.space), a = Math.max(0, Math.round(u - r)), b = Math.min(st.W - 1, Math.round(u + r));
    let k = -1;
    for (let x = a; x <= b; x++) if (k < 0 || st.ink[x] > st.ink[k]) k = x;
    if (k < 0 || st.ink[k] < 2) return null;
    let lo = k, hi = k, t = 0, wsum = 0;
    while (lo > a && st.ink[lo - 1] > 0.3 * st.ink[k]) lo--;
    while (hi < b && st.ink[hi + 1] > 0.3 * st.ink[k]) hi++;
    for (let x = lo; x <= hi; x++) { t += x * st.ink[x]; wsum += st.ink[x]; }
    return t / wsum + 0.5;
  }

  const api = { straighten, textBand, TEXT, decode, groups, read, readText, readMensural, mensuralItems, onInk, load, get meta() { return meta; } };
  global.CGRecognizer = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
