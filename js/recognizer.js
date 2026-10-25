// The recognizer: reads the notes on a staff from the scan. The staff is cut out and straightened along its own lines,
// at the size the model learnt from (training/staffdata.py does the same), and the model (training/recognizer.py,
// run here with ONNX Runtime) reads it as a sequence of tokens: clefs, notes (staff position and shape), bars, custos,
// and the breaks between glyphs (/) and between neumes (|). Each neume read has its GABC, where it lies along the staff
// and how sure the model is of it. Nothing leaves the browser.
(function (global) {
  'use strict';
  const S = () => global.CGStaves;
  const BASE = 'models/chant';      // models/chant.onnx and models/chant.json (its tokens and how it cuts a staff)

  // ---------------------------------------------------------------- the staff, straightened
  // gray: the page in grey (w × h), lines: the staff's four lines in the same pixels; meta: as models/chant.json says.
  // Returns { data (ink, 0 to 1, height rows of W), W, x0 (the image's first column on the page), step (page pixels to
  // a column) }.
  function straighten(gray, w, h, lines, meta) {
    const H = meta.height, sp = meta.space, top = meta.top;
    const xs = [0, 3].map(i => S().xsOf(lines[i]));
    const g = (S().yAt(lines[3], (xs[0][0] + xs[0][xs[0].length - 1]) / 2) - S().yAt(lines[0], (xs[0][0] + xs[0][xs[0].length - 1]) / 2)) / 3;
    const x0 = xs[0][0] - meta.left * g, x1 = xs[0][xs[0].length - 1] + meta.right * g;
    const W = Math.max(1, Math.round((x1 - x0) / g * sp)), step = g / sp;
    const data = new Float32Array(H * W);
    // (beyond the staff's ends its lines run on straight from the last point, as numpy's interp holds them level)
    const at = (l, x) => { const v = S().xsOf(l); return S().yAt(l, Math.min(v[v.length - 1], Math.max(v[0], x))); };
    for (let u = 0; u < W; u++) {
      const cx = x0 + (u + 0.5) * step, yt = at(lines[0], cx), yb = at(lines[3], cx);
      for (let v = 0; v < H; v++) {
        const py = yt + (v + 0.5 - top) / (3 * sp) * (yb - yt);
        data[v * W + u] = 1 - sample(gray, w, h, cx, py) / 255;
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

  const isClef = t => /^[cf]b?[1-5]$/.test(t), isBar = t => /^(::|:|;|,|`)$/.test(t), isCustos = t => /^[a-m]\+$/.test(t);
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
  let session = null, meta = null, loading = null;
  function script(src) {
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error(`Couldn't load ${src}`)); document.head.appendChild(s); });
  }
  // the model, loaded the first time it's wanted
  function load() {
    if (loading) return loading;
    loading = (async () => {
      if (!global.ort) await script('vendor/onnxruntime/ort.wasm.min.js');
      global.ort.env.wasm.wasmPaths = new URL('vendor/onnxruntime/', document.baseURI).href;
      if (!global.crossOriginIsolated) global.ort.env.wasm.numThreads = 1;
      const r = await fetch(BASE + '.json');
      if (!r.ok) throw new Error('No recognizer model here yet (models/chant.json).');
      meta = await r.json();
      session = await global.ort.InferenceSession.create(BASE + '.onnx', { executionProviders: ['wasm'] });
      return { session, meta };
    })();
    loading.catch(() => { loading = null; });
    return loading;
  }

  // The neumes on a staff, read: px, the page's pixels (viewer.js: { gray, w, h, scale }); lines in page units.
  // Returns [{ g, x0, x1 (page units), conf }], in order along the staff.
  async function read(px, lines) {
    const { session: s, meta: m } = await load();
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

  const api = { straighten, decode, groups, read, load, get meta() { return meta; } };
  global.CGRecognizer = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
