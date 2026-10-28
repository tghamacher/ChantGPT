// Wires the controls to the viewer and to the editing layer (editor.js), and saves and opens documents.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const V = window.CGViewer, C = window.CGChant, E = window.CGEditor;
  const MAX_PIXELS = 24e6;   // the largest canvas drawn; a bigger zoom is drawn at this and stretched

  // src: the open source (viewer.js); doc: its document (chant.js); page: the page shown, from 0;
  // zoom: 'width' or 'page' (fitted to the window) or a number (page units to CSS pixels);
  // dirty: changed since it was last saved
  // book: a book's index from GregoBase (made by training/gregobase.py book), if one is open
  const state = { src: null, doc: null, page: 0, zoom: 'width', dirty: false, book: null };
  window.CGApp = { state, open, openIiif, savePages, show, save };

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
    // a book's index, among them, is opened as that
    const books = [];
    for (const f of files.filter(isDoc)) { try { if (JSON.parse(await f.text()).format === 'chantgpt-book') books.push(f); } catch (e) { } }
    files = files.filter(f => !books.includes(f));
    if (books.length) { if (!(await openBook(books[0]))) return false; if (!files.length) { if (state.src) await show(state.page); return true; } }
    const docs = files.filter(isDoc), scans = files.filter(f => !isDoc(f));
    if (docs.length > 1) { say('Open one document at a time.', true); return false; }
    if (scans.length && !(await useScan(progress => V.open(scans, progress)))) return false;
    if (docs.length) {
      if (!state.src) { say('Open the scan first, then its document (or choose both together).', true); return false; }
      if (!scans.length && state.dirty && !confirm('Your changes to this document aren\'t saved. Open the other one anyway?')) return false;
      if (!(await openDoc(docs[0]))) return false;
    }
    await show(docs.length ? state.page : 0);
    return true;
  }

  // a manuscript online: its IIIF manifest's address
  async function openIiif(url) {
    try { url = new URL(url.trim(), document.baseURI).href; } catch (e) { url = ''; }
    if (!/^https?:\/\//.test(url)) { say('Give the address of a IIIF manifest (https://…/manifest.json).', true); return false; }
    if (!(await useScan(progress => V.openIiif(url, progress)))) return false;
    await show(0);
    return true;
  }

  // a scan to work on (load(progress) opens it): a new, empty document for it
  async function useScan(load) {
    if (state.dirty && !confirm('The staves you have marked on this scan aren\'t saved. Open another anyway?')) return false;
    say('Opening …');
    let src;
    try { src = await load((done, total) => say(`Reading page ${done} of ${total} …`)); }
    catch (e) { say(e.message || String(e), true); return false; }
    if (state.src) state.src.close();
    state.src = src;
    pixelCache = null;
    state.doc = C.newDocument({ name: src.name, type: src.type, sizes: src.sizes, url: src.url });
    if (state.book) state.doc.book = bookOf(state.book);
    state.page = 0;
    state.dirty = false;
    E.reset();
    say(`${src.name}: ${src.count} ${src.count === 1 ? 'page' : 'pages'}.`);
    $('pageCount').textContent = src.count;
    $('pageNo').max = src.count;
    for (const id of ['pageGroup', 'staffGroup', 'chantGroup', 'checkGroup', 'docGroup']) $(id).hidden = false;
    $('empty').hidden = true;
    $('page').hidden = false;
    $('saveGroup').hidden = !src.original;
    $('saveFrom').max = $('saveTo').max = src.count;
    return true;
  }

  // An online manuscript's pages from … to … (from 1), saved as zips of their full-size images, a hundred pages to a
  // zip, each zip downloaded as soon as it is full: a page at a time with a pause between, and longer waits when the
  // library asks for them (429, 503) or a page fails (tried five times, then left out and said so).
  let saving = null;
  const BATCH = 100;
  async function savePages(from, to) {
    const src = state.src;
    if (!src || !src.original) return false;
    from = Math.max(1, Math.round(from)); to = Math.min(src.count, Math.round(to));
    if (!(to >= from)) { say('Give the first and last page to save.', true); return false; }
    const run = saving = { stop: false }, missed = [];
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const base = src.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'pages';
    $('stopSaving').hidden = false; $('savePages').disabled = true;
    let saved = 0, zips = 0;
    try {
      for (let a = from; a <= to; a += BATCH) {
        const b = Math.min(to, a + BATCH - 1), files = [];
        for (let i = a - 1; i < b; i++) {
          let img = null;
          for (let k = 0; k < 5 && !img; k++) {
            if (run.stop) { say(`Stopped after ${saved} pages${zips ? `, in ${zips} zips` : ''}.`); return false; }
            say(`Fetching page ${i + 1} (${i - from + 2} of ${to - from + 1}) …${k ? ` (try ${k + 1})` : ''}`);
            try { img = await src.original(i); }
            catch (e) {
              const busy = /\((429|503)\)/.test(e.message);
              say(`${e.message} Waiting ${busy ? 60 * (k + 1) : 10 * (k + 1)} s …`);
              await wait((busy ? 60 : 10) * (k + 1) * 1000);
            }
          }
          if (!img) { missed.push(i + 1); continue; }
          const ext = /png/.test(img.type) ? 'png' : 'jpg';
          const label = String(src.names[i]).replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_|_$/g, '');
          files.push({ name: `${String(i + 1).padStart(4, '0')}${label ? ' ' + label : ''}.${ext}`, data: img.data });
          saved++;
          if (i < to - 1) await wait(1000);
        }
        // (with source.txt, the manifest they came from)
        if (files.length) { files.push({ name: 'source.txt', data: new TextEncoder().encode(src.url + '\n') }); download(CGExport.zip(files), `${base} ${a}-${b}.zip`); zips++; }
      }
      say(`${saved} ${saved === 1 ? 'page' : 'pages'} saved, in ${zips} ${zips === 1 ? 'zip' : 'zips'}.` + (missed.length ? ` Not saved (the library wouldn't give them): ${missed.join(', ')}.` : ''), missed.length > 0);
      return true;
    } catch (e) { say(e.message || String(e), true); return false; }
    finally { if (saving === run) saving = null; $('stopSaving').hidden = true; $('savePages').disabled = false; }
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

  // A book's index: its pages as the book numbers them, and the chants on each from GregoBase. The document keeps which
  // book it is and which scan page is the book's first (book.first), once said.
  async function openBook(file) {
    let idx;
    try { idx = JSON.parse(await file.text()); } catch (e) { idx = null; }
    if (!idx || idx.format !== 'chantgpt-book' || !Array.isArray(idx.pages) || !Array.isArray(idx.chants)) { say(`${file.name} isn't a book's index.`, true); return false; }
    state.book = idx;
    if (state.doc && !(state.doc.book && state.doc.book.gregobase === bookOf(idx).gregobase)) { state.doc.book = bookOf(idx); state.dirty = true; }
    const s = idx.source || {};
    say(`The index of ${s.title || file.name}${s.year ? ` (${s.year})` : ''}: ${idx.pages.length} pages, ${idx.chants.length} chants.` + (state.src ? ' Go to a page of the book and say which page it is (in the Chant panel).' : ' Now open the scan of the book.'));
    return true;
  }
  const bookOf = idx => ({ title: (idx.source && idx.source.title) || '', gregobase: idx.source && idx.source.gregobase });
  // the shown scan page is the book's page called label: so the book's pages are matched to the scan's
  function setBookPage(label) {
    const idx = state.book;
    if (!idx || !state.doc) return;
    const k = idx.pages.findIndex(p => p.toLowerCase() === String(label).trim().toLowerCase());
    if (k < 0) { say(`The book has no page "${label}". Its pages run ${idx.pages[0]} … ${idx.pages[idx.pages.length - 1]}.`, true); return; }
    state.doc.book = Object.assign(state.doc.book || bookOf(idx), { first: state.page - k });
    state.dirty = true;
    say(`Scan page ${state.page + 1} is the book's page ${idx.pages[k]}; the other pages follow from it.`);
    E.draw();
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
  // which recognizer reads the notes (remembered)
  try { const v = localStorage.getItem('cg-model'); if (v) $('readModel').value = v; } catch (e) { }
  $('readModel').addEventListener('change', () => { try { localStorage.setItem('cg-model', $('readModel').value); } catch (e) { } });
  E.init({ state, svg: $('overlay'), say, pixels, show, model: () => $('readModel').value, changed: () => { state.dirty = true; } });
  $('savePages').addEventListener('click', () => savePages(+$('saveFrom').value, +$('saveTo').value));
  $('stopSaving').addEventListener('click', () => { if (saving) saving.stop = true; });
  $('iiifForm').addEventListener('submit', e => { e.preventDefault(); openIiif($('iiifUrl').value); });
  $('refit').addEventListener('click', () => E.refit());
  $('findStaves').addEventListener('click', () => E.findHere());
  $('findEverywhere').addEventListener('click', () => E.findEverywhere());
  $('stopFinding').addEventListener('click', () => E.stop());
  $('evenly').addEventListener('click', () => E.evenly());
  $('remove').addEventListener('click', () => E.remove());
  $('undo').addEventListener('click', () => E.undo());
  $('redo').addEventListener('click', () => E.redo());
  $('save').addEventListener('click', save);
  $('placeChant').addEventListener('click', () => E.placeChant($('gabcText').value));
  $('openBook').addEventListener('change', e => { if (e.target.files.length) open(e.target.files); e.target.value = ''; });
  $('setBookPage').addEventListener('click', () => setBookPage($('bookPage').value));
  $('bookPage').addEventListener('keydown', e => { if (e.key === 'Enter') { setBookPage(e.target.value); e.target.blur(); } });
  $('placePage').addEventListener('click', () => E.placePage());
  $('findBeginnings').addEventListener('click', () => E.findBeginnings());
  $('beginsHere').addEventListener('change', e => E.toggleBegins(e.target.checked));
  $('clearChant').addEventListener('click', () => E.clearChant());
  $('readBreaks').addEventListener('click', () => E.readBreaks());
  $('readStaff').addEventListener('click', () => E.readNotes(false));
  $('readPage').addEventListener('click', () => E.readNotes(true));
  $('showVolpiano').addEventListener('click', () => {
    const v = E.volpiano();
    if (!v) return;
    $('volpianoBox').hidden = false;
    $('volpianoText').value = v.text;
    $('volpianoNote').textContent = v.problems.join(' ');
  });
  $('copyVolpiano').addEventListener('click', async () => {
    $('volpianoText').select();
    try { await navigator.clipboard.writeText($('volpianoText').value); say('Volpiano copied.'); } catch (e) { document.execCommand('copy'); }
  });
  $('downloadMei').addEventListener('click', () => {
    const m = E.mei();
    if (m) download(new Blob([m.text], { type: 'application/xml' }), m.name);
  });
  $('sylText').addEventListener('change', e => E.setText(e.target.value));
  $('sylDipl').addEventListener('change', e => E.setDipl(e.target.value));
  $('sylStart').addEventListener('change', e => E.setWordStart(e.target.checked));
  $('splitHere').addEventListener('click', () => { E.splitHere(); $('sylText').focus(); });
  $('joinPrev').addEventListener('click', () => E.joinPrev());
  $('linePrev').addEventListener('click', () => E.moveLine(-1));
  $('lineNext').addEventListener('click', () => E.moveLine(1));
  $('acceptStaff').addEventListener('click', () => E.acceptStaff());
  // Enter in a syllable's field: done with it, back to the page
  for (const id of ['sylText', 'sylDipl']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.target.blur(); } });
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
  // (and ?iiif=<manifest> a manuscript online)
  const urls = new URLSearchParams(location.search).getAll('source'), iiif = new URLSearchParams(location.search).get('iiif');
  if (urls.length) V.fetchFiles(urls).then(open, e => say(e.message, true));
  // (with &save=29-49, those pages saved as soon as it is open)
  else if (iiif) {
    $('iiifUrl').value = iiif;
    const range = (new URLSearchParams(location.search).get('save') || '').match(/^(\d+)-(\d+)$/);
    openIiif(iiif).then(ok => { if (ok && range) { $('saveFrom').value = range[1]; $('saveTo').value = range[2]; savePages(+range[1], +range[2]); } });
  }
})();
