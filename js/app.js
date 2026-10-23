// Wires the controls to the viewer and draws the document over the page.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const V = window.CGViewer, C = window.CGChant;
  const SVG = 'http://www.w3.org/2000/svg';
  const MAX_PIXELS = 24e6;   // the largest canvas drawn; a bigger zoom is drawn at this and stretched

  // src: the open source (viewer.js); doc: its document (chant.js); page: the page shown, from 0;
  // zoom: 'width' or 'page' (fitted to the window) or a number (page units to CSS pixels)
  const state = { src: null, doc: null, page: 0, zoom: 'width' };
  window.CGApp = { state, open, show };

  // ---------------------------------------------------------------- status
  function say(msg, err) {
    const s = $('status');
    s.textContent = msg || '';
    s.classList.toggle('err', !!err);
  }

  // ---------------------------------------------------------------- opening
  async function open(files) {
    say('Opening …');
    let src;
    try { src = await V.open(files, (done, total) => say(`Reading page ${done} of ${total} …`)); }
    catch (e) { say(e.message || String(e), true); return false; }
    if (state.src) state.src.close();
    state.src = src;
    state.doc = C.newDocument({ name: src.name, type: src.type, sizes: src.sizes });
    state.page = 0;
    say(`${src.name}: ${src.count} ${src.count === 1 ? 'page' : 'pages'}.`);
    $('pageCount').textContent = src.count;
    $('pageNo').max = src.count;
    $('pageGroup').hidden = false;
    $('empty').hidden = true;
    $('page').hidden = false;
    await show(0);
    return true;
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
    drawOverlay(i);
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

  // ---------------------------------------------------------------- the document over the page
  // Drawn in the page's own units, so it lines up at any zoom: each staff's area and lines, and each item's box,
  // the doubtful ones (confidence under 0.8) marked.
  function drawOverlay(i) {
    const svg = $('overlay'), page = state.doc.pages[i];
    svg.setAttribute('viewBox', `0 0 ${page.size[0]} ${page.size[1]}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.replaceChildren();
    const el = (name, attrs) => { const e = document.createElementNS(SVG, name); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.appendChild(e); return e; };
    const rect = (b, cls) => el('rect', { x: b[0], y: b[1], width: b[2], height: b[3], class: cls });
    for (const st of page.staves) {
      if (st.box) rect(st.box, 'staff');
      for (const l of st.lines || []) el('line', { x1: l[0], y1: l[1], x2: l[2], y2: l[3], class: 'line' });
      for (const syl of st.syllables) for (const it of syl.items) if (it.box) rect(it.box, 'item' + (it.conf !== undefined && it.conf < 0.8 ? ' doubt' : ''));
    }
  }

  // ---------------------------------------------------------------- controls
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
    if (!state.src || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
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
