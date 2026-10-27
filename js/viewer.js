// Opens a source, a PDF or a set of page images, and draws one page at a time on a canvas. Everything stays in the
// browser: pdf.js (vendored in vendor/pdfjs) reads the PDF here, and nothing is sent anywhere.
// A source: { name, type: 'pdf' | 'images' | 'iiif', count, sizes: [[w, h], ...], render(index, canvas, scale),
// pixels(index), close() }; a IIIF one also its url (the manifest's). Sizes are in the page's own units, which the document's boxes use too: PDF points (1/72 inch) or image
// pixels. pixels() gives a page in grey for finding things in it: { gray, w, h, scale }, scale being pixels per unit.
(function (global) {
  'use strict';

  const base = () => new URL('vendor/pdfjs/', document.baseURI).href;
  let pdfjs = null;
  async function loadPdfjs() {
    if (!pdfjs) {
      pdfjs = await import(base() + 'pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = base() + 'pdf.worker.min.mjs';
    }
    return pdfjs;
  }

  const ANALYSIS_PIXELS = 24e6;   // the largest page image pixels() makes
  // a canvas drawn by draw(ctx, w, h) at w × h, in grey
  function greyOf(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    return Promise.resolve(draw(c, ctx)).then(() => ({ gray: global.CGStaves.grey(ctx.getImageData(0, 0, w, h).data), w, h }));
  }

  const isPdf = f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
  const isTiff = f => /\.tiff?$/i.test(f.name) || f.type === 'image/tiff';
  const isImage = f => !isTiff(f) && (/^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
  // page images in the order a person would expect: page2 before page10
  const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  // files: from a file input or a drop. One PDF, or any number of images (each a page). progress(done, total), if
  // given, hears how far the reading has got: a long book takes a moment to measure.
  async function open(files, progress = () => {}) {
    files = [...files];
    const pdfs = files.filter(isPdf), images = files.filter(isImage);
    if (pdfs.length > 1 || (pdfs.length && images.length)) throw new Error('Open one PDF, or page images, not both at once.');
    if (pdfs.length) return openPdf(pdfs[0], progress);
    if (images.length) return openImages(images.sort((a, b) => natural.compare(a.name, b.name)), progress);
    if (files.some(isTiff)) throw new Error('Browsers can\'t open TIFF images. Save the pages as PNG or JPEG, or as one PDF.');
    throw new Error('Choose a PDF, or page images (JPEG, PNG or WebP).');
  }

  async function openPdf(file, progress) {
    const lib = await loadPdfjs();
    const pdf = await lib.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      wasmUrl: base() + 'wasm/', standardFontDataUrl: base() + 'standard_fonts/',
      isEvalSupported: false
    }).promise;
    const pages = [], sizes = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i), vp = page.getViewport({ scale: 1 });
      pages.push(page);
      sizes.push([Math.round(vp.width * 100) / 100, Math.round(vp.height * 100) / 100]);
      if (i % 20 === 0) progress(i, pdf.numPages);
    }
    let task = null;
    return {
      name: file.name, type: 'pdf', count: pdf.numPages, sizes,
      async render(i, canvas, scale) {
        if (task) task.cancel();
        const vp = pages[i].getViewport({ scale });
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        task = pages[i].render({ canvas, viewport: vp });
        try { await task.promise; } catch (e) { if (e && e.name === 'RenderingCancelledException') return false; throw e; } finally { task = null; }
        return true;
      },
      // at 300 dots an inch, or less for a very large page
      async pixels(i) {
        const [w, h] = sizes[i], scale = Math.min(300 / 72, Math.sqrt(ANALYSIS_PIXELS / (w * h)));
        const vp = pages[i].getViewport({ scale });
        const g = await greyOf(Math.round(vp.width), Math.round(vp.height), canvas => pages[i].render({ canvas, viewport: vp }).promise);
        return Object.assign(g, { scale: g.w / w });
      },
      close() { pdf.destroy(); }
    };
  }

  async function openImages(files, progress) {
    const bitmaps = [];
    for (const f of files) {
      try { bitmaps.push(await createImageBitmap(f)); } catch (e) { bitmaps.forEach(b => b.close()); throw new Error(`Can't read ${f.name} as an image.`); }
      progress(bitmaps.length, files.length);
    }
    return {
      name: files.length === 1 ? files[0].name : `${files.length} images (${files[0].name} …)`,
      type: 'images', count: files.length, names: files.map(f => f.name),
      sizes: bitmaps.map(b => [b.width, b.height]),
      async render(i, canvas, scale) {
        const b = bitmaps[i];
        canvas.width = Math.round(b.width * scale); canvas.height = Math.round(b.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(b, 0, 0, canvas.width, canvas.height);
        return true;
      },
      // the image's own pixels (fewer for a very large one)
      async pixels(i) {
        const b = bitmaps[i], scale = Math.min(1, Math.sqrt(ANALYSIS_PIXELS / (b.width * b.height)));
        const w = Math.round(b.width * scale), h = Math.round(b.height * scale);
        const g = await greyOf(w, h, (c, ctx) => ctx.drawImage(b, 0, 0, w, h));
        return Object.assign(g, { scale: w / b.width });
      },
      close() { bitmaps.forEach(b => b.close()); }
    };
  }

  // A manuscript a library puts online with IIIF (Gallica, the Bayerische Staatsbibliothek, e-codices …): its manifest
  // gives each page (canvas) its label and size, and an image service; a page's image is fetched when it is wanted,
  // at the size wanted, straight from the library (which must allow it: most IIIF servers do).
  async function openIiif(url, progress = () => {}) {
    const r = await fetch(url).catch(() => null);
    if (!r || !r.ok) throw new Error(`Couldn't load the IIIF manifest ${url}${r ? ` (${r.status})` : ' (the library may not allow it from here)'}.`);
    const m = await r.json();
    const text = v => typeof v === 'string' ? v : Array.isArray(v) ? text(v[0]) : v && typeof v === 'object' ? text(v['@value'] || v.none || v.en || Object.values(v)[0]) : '';
    const serviceOf = s => { s = Array.isArray(s) ? s[0] : s; return s && (s['@id'] || s.id); };
    const canvases = m.sequences ? m.sequences[0].canvases : (m.items || []);
    const pages = canvases.map((c, i) => {
      const body = c.images ? c.images[0].resource : c.items && c.items[0].items[0].body;
      const service = body && serviceOf(body.service);
      return { label: text(c.label) || String(i + 1), w: c.width, h: c.height, service: service && service.replace(/\/$/, ''), image: body && (body['@id'] || body.id), v3: !m.sequences };
    }).filter(p => p.w && p.h && (p.service || p.image));
    if (!pages.length) throw new Error('That manifest has no pages with images.');
    progress(pages.length, pages.length);
    const cache = new Map();                    // the last few images fetched: "page width" -> bitmap
    async function image(i, width) {
      const p = pages[i];
      width = Math.min(p.w, Math.ceil(width / 256) * 256);
      const key = `${i} ${width}`;
      if (!cache.has(key)) {
        const src = p.service ? `${p.service}/full/${width === p.w ? (p.v3 ? 'max' : 'full') : width + ','}/0/default.jpg` : p.image;
        cache.set(key, (async () => {
          const res = await fetch(src);
          if (!res.ok) throw new Error(`Couldn't load page ${p.label} from the library (${res.status}).`);
          return createImageBitmap(await res.blob());
        })());
        cache.get(key).catch(() => cache.delete(key));
        while (cache.size > 6) { const [k, v] = cache.entries().next().value; cache.delete(k); v.then(b => b.close(), () => {}); }
      }
      return cache.get(key);
    }
    return {
      name: text(m.label) || url, type: 'iiif', url, count: pages.length, names: pages.map(p => p.label),
      sizes: pages.map(p => [p.w, p.h]),
      async render(i, canvas, scale) {
        const b = await image(i, pages[i].w * scale);
        canvas.width = Math.round(pages[i].w * scale); canvas.height = Math.round(pages[i].h * scale);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(b, 0, 0, canvas.width, canvas.height);
        return true;
      },
      async pixels(i) {
        const p = pages[i], b = await image(i, p.w * Math.min(1, Math.sqrt(ANALYSIS_PIXELS / (p.w * p.h))));
        const g = await greyOf(b.width, b.height, (c, ctx) => ctx.drawImage(b, 0, 0));
        return Object.assign(g, { scale: b.width / p.w });
      },
      // the page's image as the library has it, at full size (for saving): { data: Uint8Array, type }
      async original(i) {
        const p = pages[i], res = await fetch(p.service ? `${p.service}/full/${p.v3 ? 'max' : 'full'}/0/default.jpg` : p.image);
        if (!res.ok) throw new Error(`Couldn't load page ${p.label} from the library (${res.status}).`);
        return { data: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') || 'image/jpeg' };
      },
      close() { cache.forEach(v => v.then(b => b.close(), () => {})); cache.clear(); }
    };
  }

  // files at addresses (for links like ?source=... and for the tests)
  async function fetchFiles(urls) {
    return Promise.all(urls.map(async u => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`Couldn't load ${u} (${r.status}).`);
      const blob = await r.blob();
      return new File([blob], decodeURIComponent(u.split('/').pop().split('?')[0]), { type: blob.type });
    }));
  }

  global.CGViewer = { open, openIiif, fetchFiles, isPdf, isImage };
})(window);
