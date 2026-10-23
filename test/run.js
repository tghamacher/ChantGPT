// Runs the cases in cases.js, one at a time. A browser case loads the app in the frame with test scans and checks
// it. The summary goes in the page title too (PASS n/n or FAIL k/n), and a plain report in #report, for a headless
// browser's --dump-dom. ?only=part of a name runs just those cases.
(function () {
  'use strict';
  const frame = document.getElementById('frame'), only = new URLSearchParams(location.search).get('only');
  const report = document.getElementById('report');
  const line = (cls, text) => { const li = document.createElement('li'); li.className = cls; li.textContent = text; report.appendChild(li); };

  // loads index.html with these sources; resolves when the first page is drawn (or at once, with none).
  // shown(i) waits for page i to be drawn again.
  function app(...sources) {
    return new Promise((resolve, reject) => {
      const q = sources.map(s => 'source=' + encodeURIComponent('test/pages/' + s.split('/').pop())).join('&');
      const timer = setTimeout(() => reject(new Error('The app did not show a page in time.')), 15000);
      frame.onload = () => {
        const w = frame.contentWindow;
        const shown = i => new Promise((ok, no) => {
          const t = setTimeout(() => no(new Error(`Page ${i + 1} was not drawn in time.`)), 10000);
          w.document.addEventListener('cg-shown', function f(e) { if (e.detail.page === i) { clearTimeout(t); w.document.removeEventListener('cg-shown', f); ok(); } });
        });
        if (!sources.length) { clearTimeout(timer); resolve({ w, shown }); return; }
        shown(0).then(() => { clearTimeout(timer); resolve({ w, shown }); }, reject);
      };
      frame.src = '../index.html' + (q ? '?' + q : '');
    });
  }

  (async () => {
    let failed = 0, run = 0;
    for (const c of window.CASES) {
      if (only && !c.name.includes(only)) continue;
      run++;
      let bad;
      try { bad = await c.unit(app); } catch (e) { bad = ['Threw: ' + (e.message || e)]; }
      if (bad.length) { failed++; line('fail', `FAIL ${c.name}: ${bad.join(' | ')}`); }
      else line('ok', `ok ${c.name}`);
    }
    const sum = failed ? `FAIL ${failed}/${run}` : `PASS ${run}/${run}`;
    document.title = sum;
    document.getElementById('summary').textContent = sum;
  })();
})();
