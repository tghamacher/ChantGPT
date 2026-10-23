// Opens a source, a PDF or a set of page images, and draws one page at a time on a canvas. Everything stays in the
// browser: pdf.js (vendored in vendor/pdfjs) reads the PDF here, and nothing is sent anywhere.
// A source: { name, type: 'pdf' | 'images', count, sizes: [[w, h], ...], render(index, canvas, scale), close() }.
// Sizes are in the page's own units, which the document's boxes use too: PDF points (1/72 inch) or image pixels.
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
      close() { bitmaps.forEach(b => b.close()); }
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

  global.CGViewer = { open, fetchFiles, isPdf, isImage };
})(window);
