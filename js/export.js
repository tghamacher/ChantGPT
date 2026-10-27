// The chant written out in other formats: Volpiano (the CANTUS database's melodic encoding) for a chant, and MEI
// (with the Neumes module, as DDMAL's Neon edits it) for a page, each element tied to its place on the page.
(function (global) {
  'use strict';
  const C = () => global.CGChant, N = () => global.CGNeumes, S = () => global.CGStaves, K = () => global.CGChecks;
  const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

  // ---------------------------------------------------------------- Volpiano
  // On a treble staff: the letters from G3 to D6 (no i), capitals for liquescents; flats y w i x z (B3 E4 B4 E5 B5),
  // their capitals naturals; '1---' the clef; within a neume no hyphen, between neumes one, syllables two, words
  // three; '---3' a barline, '---4' a double one; '7' a line break. As music21 reads and writes it.
  const PITCHES = '9abcdefghjklmnopqrs', LIQUESCENT = ')ABCDEFGHJKLMNOPQRS', G3 = 7 * 3 + 4;
  const FLAT_AT = { 2: 'y', 5: 'w', 9: 'i', 12: 'x', 16: 'z' };   // letter index -> flat token

  // A chant as Volpiano, put in the octave CANTUS writes it in (its last note between C4 and B4). Returns { text,
  // problems } (notes it couldn't write, as sentences).
  function volpiano(doc, chant) {
    const entry = K().chants(doc).find(v => v.chant === chant) || K().chants(doc)[0];
    if (!entry) return { text: '', problems: ['There is no chant to write.'] };
    // the notes, in order, with what comes before each
    let clef = null;
    const ev = [];
    entry.staves.forEach((v, k) => {
      if (k) ev.push({ t: 'line' });
      v.staff.syllables.forEach((syl, s) => {
        ev.push({ t: 'syl', join: !!syl.join, first: s === 0 && k === 0 });
        syl.items.forEach((it, i) => {
          const kind = C().kind(it.g);
          if (kind === 'clef') { clef = it.g; return; }
          if (kind === 'bar') { ev.push({ t: 'bar', g: it.g }); return; }
          if (kind !== 'neume' && kind !== 'accidental') return;
          ev.push({ t: 'item' });
          for (const n of N().parse(it.g)) {
            const d = K().diatonic(String.fromCharCode(97 + n.p), clef);
            if (n.acc) { ev.push({ t: 'acc', acc: n.acc, d }); continue; }
            if (n.sep && n.sep !== '!') ev.push({ t: 'neume' });
            ev.push({ t: 'note', d, liq: !!n.liq });
          }
        });
      });
    });
    const notes = ev.filter(e => e.t === 'note' && e.d !== null);
    if (!notes.length) return { text: '1---', problems: notes.length < ev.filter(e => e.t === 'note').length ? ['The notes have no clef before them.'] : [] };
    const fin = notes[notes.length - 1].d, shift = 7 * Math.ceil((28 - fin) / 7);
    const problems = [];
    // the hyphens owed before the next note: the most any break since the last note asked for (none straight after
    // the clef or a barline, which bring their own)
    let out = '1---', owed = 0;
    const put = tok => { if (!/-$/.test(out)) out += '-'.repeat(owed); out += tok; owed = 0; };
    for (const e of ev) {
      if (e.t === 'syl') { if (!e.first) owed = Math.max(owed, e.join ? 2 : 3); }
      else if (e.t === 'item' || e.t === 'neume') owed = Math.max(owed, 1);
      else if (e.t === 'line') out += '7';
      else if (e.t === 'bar') {
        if (e.g === '::') { out += '---4'; owed = 0; }
        else if (e.g === ':' || /^;/.test(e.g)) { out += '---3'; owed = 0; }
      } else if (e.t === 'acc' && e.d !== null) {
        const k = e.d + shift - G3;
        if (FLAT_AT[k] && e.acc !== '#') put(e.acc === 'x' ? FLAT_AT[k] : FLAT_AT[k].toUpperCase());
        else problems.push(`A ${e.acc === 'x' ? 'flat' : e.acc === 'y' ? 'natural' : 'sharp'} Volpiano can't write was left out.`);
      } else if (e.t === 'note') {
        if (e.d === null) { problems.push('A note with no clef before it was left out.'); continue; }
        const k = e.d + shift - G3;
        if (k < 0 || k >= PITCHES.length) { problems.push(`A note outside Volpiano's range (G3 to D6) was left out.`); continue; }
        put((e.liq ? LIQUESCENT : PITCHES)[k]);
      }
    }
    if (!/[34]$/.test(out)) out += '---';
    return { text: out, problems: [...new Set(problems)] };
  }

  // ---------------------------------------------------------------- MEI
  // A page as MEI 5 with the Neumes module, the structure Neon reads: a facsimile with a zone for every staff (turned
  // as the staff is), clef, neume note, custos, accidental, bar and syllable text, in the page's own units (PDF points
  // or image pixels); then the staves' contents in one layer, each staff begun by a system break pointing to its
  // zone. Pitches are written as Neon writes them: a C clef's line is C3. Note shapes: an inclinatum tilt="se", a
  // virga tilt="s", a reversed virga tilt="n", liquescents curve and <liquescent/>, quilisma and oriscus as elements.
  function mei(doc, pageIndex) {
    const page = doc.pages[pageIndex];
    let n = 0;
    const id = p => `${p}-${(++n).toString(36).padStart(4, '0')}`;
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const zones = [];
    const zone = (x0, y0, x1, y1, rotate) => {
      const z = id('zone');
      zones.push(`<zone xml:id="${z}" ulx="${Math.round(x0)}" uly="${Math.round(y0)}" lrx="${Math.round(x1)}" lry="${Math.round(y1)}"${rotate ? ` rotate="${rotate.toFixed(4)}"` : ''}/>`);
      return z;
    };
    const pitch = (p, clef) => {
      const q = C().pitch(String.fromCharCode(97 + p), clef);
      return q ? `pname="${q.step.toLowerCase()}" oct="${q.octave - 1}"` : '';
    };
    // the clef the page starts with: the clef in force before its first staff
    let clef = null, firstClef = null;
    const before = K().chants(doc).flatMap(v => v.staves).filter(v => v.page < pageIndex);
    for (const v of before) for (const syl of v.staff.syllables) for (const it of syl.items) if (C().kind(it.g) === 'clef') clef = it.g;
    const body = [];
    const indent = '              ';
    page.staves.forEach((st, k) => {
      const lines = st.lines, xs = S().xsOf(lines[0]), x0 = xs[0], x1 = xs[xs.length - 1];
      const top = Math.min(...lines[0].filter((v, i) => i & 1)), bot = Math.max(...lines[3].filter((v, i) => i & 1));
      body.push(`${indent}<sb xml:id="${id('sb')}" n="${k + 1}" facs="#${zone(x0, top, x1, bot, S().tilt(lines))}"/>`);
      const sc = N().scaleOf(lines), step = S().spacing(lines) / 2;
      const yOf = (x, p) => N().yOf(lines, x, p);
      // a zone for an item's whole box, and for each of its notes (placed along its glyphs)
      const boxZone = it => it.box ? zone(it.box[0], it.box[1], it.box[0] + it.box[2], it.box[1] + it.box[3]) : null;
      const syls = st.syllables;
      syls.forEach((syl, s) => {
        const items = syl.items.filter(it => it.box);
        const hasNeumes = items.some(it => ['neume', 'accidental'].includes(C().kind(it.g)) && C().notes(it.g).some(x => !x.acc));
        const out = [];
        for (const it of items) {
          const kind = C().kind(it.g), facs = boxZone(it), f = facs ? ` facs="#${facs}"` : '';
          if (kind === 'clef') {
            const m = /^([cf])b?([1-5])$/.exec(it.g);
            clef = it.g; if (!firstClef) firstClef = it.g;
            out.push(`<clef xml:id="${id('clef')}"${f} shape="${m[1].toUpperCase()}" line="${m[2]}"/>`);
          } else if (kind === 'bar') {
            const form = it.g === '::' ? 'finalis' : it.g === ':' ? 'maior' : /^;/.test(it.g) ? 'minor' : /^,/.test(it.g) ? 'minima' : 'virgula';
            out.push(`<divLine xml:id="${id('divLine')}"${f} form="${form}"/>`);
          } else if (kind === 'custos') {
            out.push(`<custos xml:id="${id('custos')}"${f} ${pitch(it.g.charCodeAt(0) - 97, clef)}/>`);
          } else if (kind === 'neume' || kind === 'accidental') {
            // its glyphs as drawn, and each note's place along them
            const sh = N().itemShapes(it.g, false);
            let neume = null;
            const flush = () => { if (neume) { out.push(`<neume xml:id="${id('neume')}">${neume.join('')}</neume>`); neume = null; } };
            const ps = N().parse(it.g);
            let ni = 0;
            const noteBoxes = [];
            for (const v of sh.list) {
              if (!v.notes.length) { if (v.name === 'Flat' || v.name === 'Natural' || v.name === 'Sharp') noteBoxes.push({ acc: true, x: it.box[0] + v.dx * sc, w: v.w * sc, p: v.p }); continue; }
              const cols = Math.max(1, Math.round(v.w / 166)), cw = v.w * sc / cols, gx = it.box[0] + v.dx * sc;
              v.notes.forEach((nn, j) => {
                const col = v.notes.length <= cols ? j : Math.floor(j * cols / v.notes.length);
                noteBoxes.push({ x: gx + col * cw, w: cw, p: nn.p });
              });
            }
            for (const tok of ps) {
              if (tok.acc) {
                flush();
                const b = noteBoxes.find(v => v.acc && v.p === tok.p) || { x: it.box[0], w: step * 2, p: tok.p };
                const z = zone(b.x, yOf(b.x, tok.p) - 1.5 * step, b.x + b.w, yOf(b.x, tok.p) + step);
                out.push(`<accid xml:id="${id('accid')}" facs="#${z}" accid="${tok.acc === 'x' ? 'f' : tok.acc === 'y' ? 'n' : 's'}"/>`);
                continue;
              }
              const b = noteBoxes.filter(v => !v.acc)[ni++] || { x: it.box[0], w: step * 2 };
              if (tok.sep && tok.sep !== '!') flush();
              if (!neume) neume = [];
              const yc = yOf(b.x + b.w / 2, tok.p), z = zone(b.x, yc - 0.6 * step * 2, b.x + b.w, yc + 0.6 * step * 2);
              const attrs = [pitch(tok.p, clef)];
              if (tok.shape === 'inclinatum') attrs.push('tilt="se"');
              else if (tok.shape === 'virga') attrs.push('tilt="s"');
              else if (tok.shape === 'reversa') attrs.push('tilt="n"');
              if (tok.liq === 'Ascendens') attrs.push('curve="a"'); else if (tok.liq === 'Descendens') attrs.push('curve="c"');
              const inner = (tok.shape === 'quilisma' ? `<quilisma xml:id="${id('quilisma')}"/>` : '') + (tok.shape === 'oriscus' || tok.shape === 'scapus' ? `<oriscus xml:id="${id('oriscus')}"/>` : '') + (tok.liq ? `<liquescent xml:id="${id('liquescent')}"/>` : '');
              neume.push(`<nc xml:id="${id('nc')}" facs="#${z}" ${attrs.join(' ')}${inner ? `>${inner}</nc>` : '/>'}`);
            }
            flush();
          }
        }
        if (!hasNeumes && !syl.text) { body.push(...out.map(o => indent + o)); return; }
        // the syllable: its text (where it starts and ends a word), then its contents
        const startsWord = !syl.join, endsWord = !(syls[s + 1] && syls[s + 1].join && syls[s + 1].text);
        const wordpos = startsWord && endsWord ? 's' : startsWord ? 'i' : endsWord ? 't' : 'm';
        let sylZone = '';
        if (syl.box) sylZone = ` facs="#${zone(syl.box[0], syl.box[1], syl.box[0] + syl.box[2], syl.box[1] + syl.box[3])}"`;
        else {
          const L = N().layout(st), t = L.texts.find(v => v.syllable === s);
          if (t) { const w = Math.max(1, t.text.length) * L.textSize * 0.5; sylZone = ` facs="#${zone(t.x - w / 2, t.y - L.textSize, t.x + w / 2, t.y + 0.25 * L.textSize)}"`; }
        }
        const text = (syl.text || '').replace(/<[^>]*>/g, '').replace(/[{}]/g, '');
        body.push(`${indent}<syllable xml:id="${id('syllable')}"><syl xml:id="${id('syl')}"${sylZone} wordpos="${wordpos}"${wordpos === 'i' || wordpos === 'm' ? ' con="d"' : ''}>${esc(text)}</syl>${out.join('')}</syllable>`);
      });
    });
    const sc = firstClef ? /^([cf])b?([1-5])$/.exec(firstClef) : null;
    const chant = (doc.chants || []).find(c => page.staves.some(st => c.staves.includes(st.id)));
    const title = (chant && chant.headers && chant.headers.name) || doc.source.name || 'ChantGPT';
    return `<?xml version="1.0" encoding="UTF-8"?>
<?xml-model href="https://music-encoding.org/schema/5.1/mei-Neumes.rng" type="application/xml" schematypens="http://relaxng.org/ns/structure/1.0"?>
<mei xmlns="http://www.music-encoding.org/ns/mei" meiversion="5.1">
  <meiHead>
    <fileDesc>
      <titleStmt><title>${esc(title)}, page ${page.n}</title></titleStmt>
      <pubStmt><p>Made with ChantGPT from ${esc(doc.source.name || 'a scan')}, page ${page.n}.</p></pubStmt>
    </fileDesc>
  </meiHead>
  <music>
    <facsimile xml:id="facsimile-1">
      <surface xml:id="surface-1" ulx="0" uly="0" lrx="${Math.round(page.size[0])}" lry="${Math.round(page.size[1])}">
        ${zones.join('\n        ')}
      </surface>
    </facsimile>
    <body>
      <mdiv>
        <score>
          <scoreDef>
            <staffGrp>
              <staffDef n="1" notationtype="neume" lines="4"${sc ? ` clef.shape="${sc[1].toUpperCase()}" clef.line="${sc[2]}"` : ''}/>
            </staffGrp>
          </scoreDef>
          <section>
            <staff n="1">
              <layer n="1">
${body.join('\n')}
              </layer>
            </staff>
          </section>
        </score>
      </mdiv>
    </body>
  </music>
</mei>
`;
  }

  // ---------------------------------------------------------------- zip
  // Files in a zip, stored as they are (page images are compressed already): files [{ name, data: Uint8Array }].
  // Returns a Blob.
  let crcTable = null;
  function crc32(data) {
    if (!crcTable) crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    let c = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    const header = (size, f) => { const b = new DataView(new ArrayBuffer(size)); f(b); return new Uint8Array(b.buffer); };
    for (const f of files) {
      const name = new TextEncoder().encode(f.name), crc = crc32(f.data), n = f.data.length;
      // (version 2.0, UTF-8 names, stored, dated 1 January 1980)
      const local = header(30, b => { b.setUint32(0, 0x04034b50, true); b.setUint16(4, 20, true); b.setUint16(6, 0x800, true); b.setUint16(12, 0x21, true); b.setUint32(14, crc, true); b.setUint32(18, n, true); b.setUint32(22, n, true); b.setUint16(26, name.length, true); });
      central.push(header(46, b => { b.setUint32(0, 0x02014b50, true); b.setUint16(4, 20, true); b.setUint16(6, 20, true); b.setUint16(8, 0x800, true); b.setUint16(14, 0x21, true); b.setUint32(16, crc, true); b.setUint32(20, n, true); b.setUint32(24, n, true); b.setUint16(28, name.length, true); b.setUint32(42, offset, true); }), name);
      parts.push(local, name, f.data);
      offset += 30 + name.length + n;
    }
    const size = central.reduce((s, c) => s + c.length, 0);
    const end = header(22, b => { b.setUint32(0, 0x06054b50, true); b.setUint16(8, files.length, true); b.setUint16(10, files.length, true); b.setUint32(12, size, true); b.setUint32(16, offset, true); });
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  const api = { volpiano, mei, zip, crc32 };
  global.CGExport = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
