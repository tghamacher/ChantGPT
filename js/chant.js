// The internal format: Gregorian chant as GABC (the notation of Gregorio), with each piece placed on the page it was
// read from. See docs/format.md. A document holds the source's pages; a page its staves; a staff its syllables, each
// with its text and its GABC groups (clefs, neumes, bars, custos), and each of these may have a box on the page and
// the recognizer's confidence. Nothing here draws or reads images: this is the data, its GABC, and its checks.
(function (global) {
  'use strict';

  const FORMAT = 'chantgpt', VERSION = 1;
  const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

  // ---------------------------------------------------------------- the kind of a GABC group
  // A group is what one item holds: a clef (c4, cb3, f3), a bar (, ; : :: ` and their numbered forms), a custos (g+),
  // a line break (z, z+, z-, z0, Z), a lone accidental (ix flat, iy natural, i# sharp), or neume material, which is
  // everything else: notes and their signs, kept exactly as written (fgh, f/gh, ivHG, h_, g.).
  const KINDS = [
    ['clef', /^[cf]b?[1-5]$/],
    ['bar', /^(::|:[?']?|;[1-8]?|,[0-7_]?|`0?)$/],
    ['custos', /^[a-m]\+$/],
    ['break', /^[zZ][+\-0]?$/],
    ['accidental', /^[a-m][xy#]$/]
  ];
  const kind = g => (KINDS.find(([, re]) => re.test(g)) || ['neume'])[0];
  const TRAILING_BAR = /^(.*[^:;,`])(::|:|;[1-8]?|,[0-7]?|`)$/;

  // ---------------------------------------------------------------- pitch
  // GABC's letters a..m are staff positions from below: the four lines are d f h j. A clef names the pitch of its
  // line: c4 is middle C on the fourth (top) line; an F clef's line is the F below middle C.
  const posOf = ch => ch.toLowerCase().charCodeAt(0) - 97;
  function pitch(letter, clef) {
    const m = /^([cf])b?([1-5])$/.exec(clef || '');
    if (!m || !/^[a-m]$/i.test(letter)) return null;
    const line = 1 + 2 * +m[2];                               // the clef line's position: 1 d, 2 f, 3 h, 4 j (5: above)
    const d = (m[1] === 'f' ? 24 : 28) + posOf(letter) - line;   // diatonic number: C4 = 28, F3 = 24
    return { step: STEPS[((d % 7) + 7) % 7], octave: Math.floor(d / 7) };
  }

  // the notes of a group of neume material, in order: their staff letter and the signs written after it
  // (v virga, w quilisma, o oriscus, ~ < > liquescents, . mora, ' _ episemata, s stropha, r and so on).
  // A letter followed by x, y or # is a flat, natural or sharp on that position, not a note. Bracketed
  // attributes ([ob:1;6mm], [alt:...]) and spacing signs are skipped.
  function notes(g) {
    const out = [];
    let i = 0;
    while (i < g.length) {
      const ch = g[i];
      if (ch === '[') { const j = g.indexOf(']', i); i = j < 0 ? g.length : j + 1; continue; }
      if (/[a-m]/i.test(ch)) {
        let j = i + 1;
        if (/[xy#]/.test(g[j] || '')) { out.push({ p: ch.toLowerCase(), acc: g[j] }); i = j + 1; continue; }
        while (j < g.length && !/[a-m\[\s\/!@,;:`]/i.test(g[j])) j++;
        out.push({ p: ch.toLowerCase(), shape: ch === ch.toUpperCase() ? 'inclinatum' : 'punctum', signs: g.slice(i + 1, j) });
        i = j;
        continue;
      }
      i++;
    }
    for (const n of out) {
      if (!n.signs) continue;
      if (/w/.test(n.signs)) n.shape = 'quilisma';
      else if (/o/.test(n.signs)) n.shape = 'oriscus';
      else if (/v/i.test(n.signs)) n.shape = 'virga';
      else if (/s/.test(n.signs)) n.shape = 'stropha';
      if (/[~<>]/.test(n.signs)) n.liquescent = true;
    }
    return out;
  }

  // ---------------------------------------------------------------- GABC in
  // Reads a GABC file into its headers and staves. Its line breaks (z, Z) start new staves, so a transcription made
  // line by line from a source comes back in the source's staves; without them the chant is one long staff.
  function fromGabc(src) {
    src = String(src).replace(/\r\n?/g, '\n').replace(/^﻿/, '');
    const headers = {};
    let body = src;
    const sep = /^%%\s*$/m.exec(src);
    if (sep) {
      for (const line of src.slice(0, sep.index).split('\n')) {
        const m = /^\s*([\w-]+)\s*:\s*(.*?);?\s*$/.exec(line.replace(/%.*$/, ''));
        if (m) headers[m[1]] = m[2];
      }
      body = src.slice(sep.index + sep[0].length);
    }
    body = body.replace(/%.*$/gm, '');
    const staves = [{ syllables: [] }];
    const re = /([^()]*)\(([^()]*)\)/g;
    let m;
    while ((m = re.exec(body))) {
      const raw = m[1].replace(/\s+/g, ' '), text = raw.trim();
      const syl = { text, items: [] };
      if (!/^\s/.test(m[1]) && staves.some(s => s.syllables.length)) syl.join = true;
      let brk = null;
      for (const g of groups(m[2])) {
        if (kind(g) === 'break') brk = g;
        else syl.items.push({ g });
      }
      if (syl.text || syl.items.length) staves[staves.length - 1].syllables.push(syl);
      if (brk) staves.push({ syllables: [] });
    }
    while (staves.length > 1 && !staves[staves.length - 1].syllables.length) staves.pop();
    if (!staves[0].syllables.length) throw new Error('No chant found: GABC writes each syllable as text(notes).');
    return { headers, staves };
  }

  // the groups of one pair of parentheses: clefs, bars, custos and breaks each their own item, neume material
  // between them kept whole with its spacing (fg gf stays one item), and a bar written straight after notes (f.;)
  // split off.
  function groups(s) {
    const out = [], chunks = s.trim().split(/\s+/).filter(Boolean);
    let run = [];
    const flush = () => { if (run.length) out.push(run.join(' ')); run = []; };
    for (const c of chunks) {
      const k = kind(c);
      if (k !== 'neume' && k !== 'accidental') { flush(); out.push(c); continue; }
      const t = TRAILING_BAR.exec(c);
      if (t && kind(t[2]) === 'bar') { run.push(t[1]); flush(); out.push(t[2]); continue; }
      run.push(c);
    }
    flush();
    return out;
  }

  // ---------------------------------------------------------------- GABC out
  // Writes a chant (or, given a document without chants, all its staves in order) as GABC. lines: true keeps the
  // source's line breaks as (z). A custos is left out: Gregorio sets its own at each line break.
  function toGabc(doc, opts = {}) {
    const chant = opts.chant || (doc.chants && doc.chants[0]) || null;
    const all = staves(doc), byId = new Map(all.map(s => [s.id, s]));
    const list = chant && chant.staves ? chant.staves.map(id => byId.get(id)).filter(Boolean) : all;
    const headers = Object.assign({ name: '' }, chant && chant.headers);
    let out = Object.entries(headers).map(([k, v]) => `${k}: ${v};`).join('\n') + '\n%%\n';
    let body = '';
    list.forEach((staff, si) => {
      for (const syl of staff.syllables) {
        const gs = syl.items.map(it => it.g).filter(g => kind(g) !== 'custos');
        if (!gs.length && !syl.text) continue;
        body += (body && !syl.join ? ' ' : '') + syl.text + '(' + gs.join(' ') + ')';
      }
      if (opts.lines && si < list.length - 1) body += ' (z)';
    });
    return out + body + '\n';
  }

  // ---------------------------------------------------------------- documents
  // A new, empty document for a source: its name, its type ('pdf' or 'images'), and each page's size in the units
  // its boxes will use (PDF points for a PDF, pixels for an image).
  function newDocument(source) {
    return {
      format: FORMAT, version: VERSION,
      source: { name: source.name || '', type: source.type || 'images', pages: source.sizes.length },
      pages: source.sizes.map((size, i) => ({ n: i + 1, size: [size[0], size[1]], staves: [] })),
      chants: []
    };
  }

  // every staff of a document, in reading order (pages, then staves as listed)
  const staves = doc => (doc.pages || []).flatMap(p => p.staves || []);

  // the items of a staff with the clef in force at each, starting from the clef before it (or the staff's own)
  function withClefs(staff, clef = null) {
    const out = [];
    staff.syllables.forEach((syl, s) => syl.items.forEach((it, i) => {
      if (kind(it.g) === 'clef') clef = it.g;
      out.push({ syllable: s, item: i, g: it.g, kind: kind(it.g), clef });
    }));
    return out;
  }

  // What is wrong with a document, as plain sentences (none: an empty list).
  function check(doc) {
    const bad = [];
    const box4 = b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2] >= 0 && b[3] >= 0;
    if (!doc || doc.format !== FORMAT) return ['Not a ChantGPT document.'];
    if (doc.version !== VERSION) bad.push(`Version ${doc.version}; this app reads version ${VERSION}.`);
    if (!Array.isArray(doc.pages)) return bad.concat('The document has no pages.');
    const ids = new Set();
    doc.pages.forEach((page, pi) => {
      const where = `Page ${page.n || pi + 1}`;
      if (!Array.isArray(page.size) || page.size.length !== 2 || !(page.size[0] > 0 && page.size[1] > 0)) bad.push(`${where} has no size.`);
      const [w, h] = page.size || [0, 0];
      const inside = b => b[0] >= -1 && b[1] >= -1 && b[0] + b[2] <= w + 1 && b[1] + b[3] <= h + 1;
      (page.staves || []).forEach((st, si) => {
        const name = `${where}, staff ${si + 1}${st.id ? ` (${st.id})` : ''}`;
        if (!st.id) bad.push(`${name} has no id.`);
        else if (ids.has(st.id)) bad.push(`${name}: the id ${st.id} is used twice.`);
        else ids.add(st.id);
        if (st.box !== undefined && !(box4(st.box) && inside(st.box))) bad.push(`${name}: its box is not on the page.`);
        if (st.lines !== undefined && !(Array.isArray(st.lines) && st.lines.length === 4 && st.lines.every(l => Array.isArray(l) && l.length === 4 && l.every(Number.isFinite))))
          bad.push(`${name}: a staff has four lines, each [x0, y0, x1, y1].`);
        (st.syllables || []).forEach((syl, yi) => {
          if (syl.box !== undefined && !(box4(syl.box) && inside(syl.box))) bad.push(`${name}, syllable ${yi + 1}: its box is not on the page.`);
          (syl.items || []).forEach(it => {
            if (typeof it.g !== 'string' || !it.g.trim()) bad.push(`${name}, syllable ${yi + 1}: an item has no GABC.`);
            else if (/[()]/.test(it.g)) bad.push(`${name}, syllable ${yi + 1}: "${it.g}" has parentheses; give the GABC inside them.`);
            if (it.box !== undefined && !(box4(it.box) && inside(it.box))) bad.push(`${name}, syllable ${yi + 1}: the box of "${it.g}" is not on the page.`);
            if (it.conf !== undefined && !(it.conf >= 0 && it.conf <= 1)) bad.push(`${name}, syllable ${yi + 1}: the confidence of "${it.g}" is not between 0 and 1.`);
          });
        });
      });
    });
    (doc.chants || []).forEach((c, ci) => (c.staves || []).forEach(id => {
      if (!ids.has(id)) bad.push(`Chant ${ci + 1} (${(c.headers && c.headers.name) || 'untitled'}) lists a staff that isn't there: ${id}.`);
    }));
    return bad;
  }

  const api = { FORMAT, VERSION, kind, pitch, notes, fromGabc, toGabc, newDocument, staves, withClefs, check };
  global.CGChant = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
