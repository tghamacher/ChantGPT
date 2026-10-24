// Wires the controls to the viewer and to the editing layer (editor.js), and saves and opens documents.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const V = window.CGViewer, C = window.CGChant, E = window.CGEditor;
  const MAX_PIXELS = 24e6;   // the largest canvas drawn; a bigger zoom is drawn at this and stretched

  // src: the open source (viewer.js); doc: its document (chant.js); page: the page shown, from 0;
  // zoom: 'width' or 'page' (fitted to the window) or a number (page units to CSS pixels);
  // dirty: changed since it was last saved
  const state = { src: null, doc: null, page: 0, zoom: 'width', dirty: false };
  window.CGApp = { state, open, show, save };

  // ---------------------------------------------------------------- status
  function say(msg, err) {
    const s = $('status');
    s.textContent = msg || '';
    s.classList.toggle('err', !!err);
  }

  // ---------------------------------------------------------------- opening
  // files: a scan (a PDF or page images), or a saved document (.json), or both together
  const isDoc = f => /\.json$/i.test(f.name) || f.type === 'application/json';
  async function open(files) {
    files = [...files];
    const docs = files.filter(isDoc), scans = files.filter(f => !isDoc(f));
    if (docs.length > 1) { say('Open one document at a time.', true); return false; }
    if (scans.length) {
      if (state.dirty && !confirm('The staves you have marked on this scan aren\'t saved. Open another anyway?')) return false;
      say('Opening …');
      let src;
      try { src = await V.open(scans, (done, total) => say(`Reading page ${done} of ${total} …`)); }
      catch (e) { say(e.message || String(e), true); return false; }
      if (state.src) state.src.close();
      state.src = src;
      pixelCache = null;
      state.doc = C.newDocument({ name: src.name, type: src.type, sizes: src.sizes });
      state.page = 0;
      state.dirty = false;
      E.reset();
      say(`${src.name}: ${src.count} ${src.count === 1 ? 'page' : 'pages'}.`);
      $('pageCount').textContent = src.count;
      $('pageNo').max = src.count;
      for (const id of ['pageGroup', 'staffGroup', 'chantGroup', 'docGroup']) $(id).hidden = false;
      $('empty').hidden = true;
      $('page').hidden = false;
    }
    if (docs.length) {
      if (!state.src) { say('Open the scan first, then its document (or choose both together).', true); return false; }
      if (!scans.length && state.dirty && !confirm('Your changes to this document aren\'t saved. Open the other one anyway?')) return false;
      if (!(await openDoc(docs[0]))) return false;
    }
    await show(docs.length ? state.page : 0);
    return true;
  }

  // a saved document, for the scan that is open: it must have as many pages, of the same sizes
  async function openDoc(file) {
    let doc;
    try { doc = JSON.parse(await file.text()); } catch (e) { say(`${file.name} isn't a ChantGPT document.`, true); return false; }
    const bad = C.check(doc);
    if (bad.length) { say(`${file.name} can't be opened: ${bad.slice(0, 3).join(' ')}`, true); return false; }
    const src = state.src, same = (a, b) => Math.abs(a - b) <= Math.max(1, 0.005 * b);
    if (doc.pages.length !== src.count || doc.pages.some((p, i) => !same(p.size[0], src.sizes[i][0]) || !same(p.size[1], src.sizes[i][1]))) {
      say(`${file.name} belongs to ${doc.source.name || 'another scan'} (${doc.pages.length} pages), not to the scan that is open (${src.count} pages).`, true);
      return false;
    }
    state.doc = doc;
    state.dirty = false;
    E.reset();
    const n = C.staves(doc).length;
    say(`${file.name}: ${n} ${n === 1 ? 'staff' : 'staves'} on ${doc.pages.filter(p => p.staves.length).length} pages.` +
      (doc.source.name && doc.source.name !== src.name ? ` It was made for ${doc.source.name}; the pages match.` : ''));
    return true;
  }

  // ---------------------------------------------------------------- saving
  function save() {
    if (!state.doc) return;
    const name = (state.src.name.replace(/\.[^.]+$/, '').replace(/ \(.*$/, '') || 'chant') + '.chantgpt.json';
    download(new Blob([JSON.stringify(state.doc, null, 1) + '\n'], { type: 'application/json' }), name);
    state.dirty = false;
    say(`Saved as ${name}. To go on later, open the scan and this file together.`);
  }
  // a file handed to the browser to save
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

  // the page in grey for finding lines, one page kept at a time
  let pixelCache = null;
  function pixels(i) {
    if (!pixelCache || pixelCache.page !== i) pixelCache = { page: i, promise: state.src.pixels(i) };
    const c = pixelCache;
    c.promise.catch(() => { if (pixelCache === c) pixelCache = null; });
    return c.promise;
  }

  // ---------------------------------------------------------------- showing a page
  let showing = 0;
  async function show(i) {
    const src = state.src;
    if (!src) return;
    i = Math.max(0, Math.min(src.count - 1, i));
    state.page = i;
    $('pageNo').value = i + 1;
    $('prev').disabled = i === 0;
    $('next').disabled = i === src.count - 1;
    const [w, h] = src.sizes[i];
    const scale = scaleFor(w, h), ratio = window.devicePixelRatio || 1;
    const draw = Math.min(scale * ratio, Math.sqrt(MAX_PIXELS / (w * h)));
    const box = $('page');
    box.style.width = `${w * scale}px`;
    box.style.height = `${h * scale}px`;
    E.draw();
    const name = src.names ? ` · ${src.names[i]}` : '';
    $('pageInfo').textContent = `${Math.round(w)} × ${Math.round(h)} ${src.type === 'pdf' ? 'points' : 'pixels'}${name}`;
    const n = ++showing;
    try {
      const done = await src.render(i, $('canvas'), draw);
      if (done && n === showing) document.dispatchEvent(new CustomEvent('cg-shown', { detail: { page: i } }));
    } catch (e) { say(`Couldn't draw page ${i + 1}: ${e.message || e}`, true); }
  }

  function scaleFor(w, h) {
    if (typeof state.zoom === 'number') return state.zoom;
    const stage = $('stage'), cs = getComputedStyle(stage);
    const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ah = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const fitW = Math.max(0.05, aw / w);
    return state.zoom === 'page' ? Math.max(0.05, Math.min(fitW, ah / h)) : fitW;
  }

  function zoom(z) {
    if (z === 'in' || z === 'out') {
      const [w, h] = state.src.sizes[state.page];
      z = Math.max(0.05, Math.min(20, scaleFor(w, h) * (z === 'in' ? 1.25 : 0.8)));
    }
    state.zoom = z;
    for (const b of document.querySelectorAll('[data-zoom]')) b.setAttribute('aria-pressed', String(b.dataset.zoom === z));
    show(state.page);
  }

  // ---------------------------------------------------------------- controls
  E.init({ state, svg: $('overlay'), say, pixels, show, changed: () => { state.dirty = true; } });
  $('refit').addEventListener('click', () => E.refit());
  $('evenly').addEventListener('click', () => E.evenly());
  $('remove').addEventListener('click', () => E.remove());
  $('undo').addEventListener('click', () => E.undo());
  $('redo').addEventListener('click', () => E.redo());
  $('save').addEventListener('click', save);
  $('placeChant').addEventListener('click', () => E.placeChant($('gabcText').value));
  $('clearChant').addEventListener('click', () => E.clearChant());
  $('downloadGabc').addEventListener('click', () => {
    const g = E.gabc();
    if (!g) return;
    download(new Blob([g.text], { type: 'text/plain' }), (g.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'chant') + '.gabc');
  });
  // how see-through the notation is (kept for next time)
  const opacity = v => { $('overlay').style.setProperty('--notation', v); try { localStorage.setItem('cg-notation', v); } catch (e) { } };
  try { const v = localStorage.getItem('cg-notation'); if (v) $('opacity').value = v; } catch (e) { }
  opacity($('opacity').value);
  $('opacity').addEventListener('input', e => opacity(e.target.value));
  $('openDoc').addEventListener('change', e => { if (e.target.files.length) open(e.target.files); e.target.value = ''; });

  $('file').addEventListener('change', e => { if (e.target.files.length) open(e.target.files); e.target.value = ''; });
  $('drop').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
  // a drop anywhere on the window opens the files
  let depth = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); depth++; $('drop').classList.add('over'); });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('drop').classList.remove('over'); } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault(); depth = 0; $('drop').classList.remove('over');
    if (e.dataTransfer.files.length) open(e.dataTransfer.files);
  });

  $('prev').addEventListener('click', () => show(state.page - 1));
  $('next').addEventListener('click', () => show(state.page + 1));
  $('pageNo').addEventListener('change', e => show((parseInt(e.target.value, 10) || 1) - 1));
  for (const b of document.querySelectorAll('[data-zoom]')) b.addEventListener('click', () => zoom(b.dataset.zoom));
  $('zoomIn').addEventListener('click', () => zoom('in'));
  $('zoomOut').addEventListener('click', () => zoom('out'));
  document.addEventListener('keydown', e => {
    if (!state.src || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); return; }
    if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) { peek(true); e.preventDefault(); return; }
    if (E.key(e)) { e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown') show(state.page + 1);
    else if (k === 'ArrowLeft' || k === 'PageUp') show(state.page - 1);
    else if (k === 'Home') show(0);
    else if (k === 'End') show(state.src.count - 1);
    else if (k === '+' || k === '=') zoom('in');
    else if (k === '-') zoom('out');
    else return;
    e.preventDefault();
  });
  // holding H hides the layer, to see the page under it
  const peek = on => $('overlay').classList.toggle('peek', on);
  document.addEventListener('keyup', e => { if (e.key === 'h' || e.key === 'H') peek(false); });
  window.addEventListener('blur', () => peek(false));

  let resizing = 0;
  window.addEventListener('resize', () => {
    if (!state.src || typeof state.zoom === 'number') return;
    clearTimeout(resizing);
    resizing = setTimeout(() => show(state.page), 150);
  });

  // the theme: light, dark, or the system's
  const theme = $('theme');
  try { theme.value = localStorage.getItem('cg-theme') || 'system'; } catch (e) { }
  theme.addEventListener('change', () => {
    const t = theme.value;
    if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    try { localStorage.setItem('cg-theme', t); } catch (e) { }
  });

  // a link like index.html?source=scans/p1.png&source=scans/p2.png opens those files
  const urls = new URLSearchParams(location.search).getAll('source');
  if (urls.length) V.fetchFiles(urls).then(open, e => say(e.message, true));
})();
