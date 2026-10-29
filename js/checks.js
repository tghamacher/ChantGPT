// The checks that need no AI: things in a chant that are likely misreadings, for the person to look at. Each is
// { staff, page, s, i, kind, level, text }: where it is (the staff's id, its page from 0, the syllable and item on
// the staff; i is null for a whole staff), what kind it is, how sure ('warn': probably wrong; 'note': worth a look),
// and what to say. Nothing here draws; editor.js shows them.
//
// - every staff begins with its clef, as printed books have it;
// - a custos points to the next note, on the next staff;
// - no leaps of a seventh or more (rare in chant, common in misreadings);
// - with a mode in its headers: the chant ends on the mode's final (or its usual transposition), and keeps to the
//   mode's range (authentic: a step below the final to an octave above; plagal: a fourth below to a sixth above),
//   with a step's leeway each way;
// - flats and naturals only on B (and E, which a transposed chant needs);
// - notes over no syllable.
(function (global) {
  'use strict';
  const C = () => global.CGChant;
  const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const name = d => STEPS[((d % 7) + 7) % 7] + Math.floor(d / 7);
  const INTERVAL = ['unison', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'octave'];
  const an = w => (/^[aeiou]/.test(w) ? 'an ' : 'a ') + w;
  const interval = n => n < 8 ? INTERVAL[n] : n === 8 ? 'ninth' : n === 9 ? 'tenth' : `${n + 1}th`;
  // finals by mode (diatonic step from C), and the transpositions books use
  const FINALS = { 1: ['D', 'A'], 2: ['D', 'A'], 3: ['E', 'B'], 4: ['E', 'B'], 5: ['F', 'C'], 6: ['F', 'C'], 7: ['G', 'D'], 8: ['G', 'D'] };

  // a pitch as a diatonic number (C4 = 28), or null without a clef
  function diatonic(letter, clef) {
    const p = C().pitch(letter, clef);
    return p ? 7 * p.octave + STEPS.indexOf(p.step) : null;
  }

  // the staves of each chant, in order, wherever they are: [{ chant, staves: [{ staff, page }] }]; staves with chant
  // on them that no chant lists are taken as chants of their own
  function chants(doc) {
    const where = new Map();
    doc.pages.forEach((pg, k) => pg.staves.forEach(st => where.set(st.id, { staff: st, page: k })));
    const listed = new Set(), out = [];
    for (const c of doc.chants || []) {
      const staves = (c.staves || []).map(id => where.get(id)).filter(Boolean);
      staves.forEach(v => listed.add(v.staff.id));
      if (staves.length) out.push({ chant: c, staves });
    }
    for (const [id, v] of where) if (!listed.has(id) && v.staff.syllables.length) out.push({ chant: { headers: {} }, staves: [v] });
    return out;
  }

  function check(doc) {
    const out = [];
    for (const { chant, staves } of chants(doc)) {
      const at = (v, s, i, kind, level, text) => out.push({ staff: v.staff.id, page: v.page, s, i, kind, level, text });
      let clef = null, prev = null, custos = null, lastBar = true;
      const notes = [];
      staves.forEach((v, k) => {
        const st = v.staff, first = st.syllables.flatMap(syl => syl.items)[0];
        if (first && C().kind(first.g) !== 'clef')
          at(v, 0, 0, 'clef', clef ? 'note' : 'warn', clef ? `This staff doesn't begin with a clef, as printed books do on every line; its notes are read with the clef before (${clef}).` : 'No clef before these notes, so their pitches are unknown.');
        st.syllables.forEach((syl, s) => syl.items.forEach((it, i) => {
          const kind = C().kind(it.g);
          if (kind === 'clef') { clef = it.g; return; }
          if (kind === 'bar') { lastBar = true; return; }
          if (kind === 'custos') { custos = { v, s, i, d: diatonic(it.g[0], clef) }; return; }
          if (kind !== 'neume' && kind !== 'accidental') return;
          const ns = C().notes(it.g);
          for (const n of ns) {
            if (n.acc) {
              const d = diatonic(n.p, clef);
              if (d !== null && !['B', 'E'].includes(STEPS[d % 7]))
                at(v, s, i, 'accidental', 'warn', `A ${n.acc === 'x' ? 'flat' : n.acc === 'y' ? 'natural' : 'sharp'} on ${name(d)}? Chant has them on B (and E, transposed).`);
              continue;
            }
            const d = diatonic(n.p, clef);
            if (d === null) continue;
            if (custos) {
              if (custos.d !== null && custos.d !== d)
                at(custos.v, custos.s, custos.i, 'custos', 'warn', `The custos points to ${name(custos.d)}, but the next note is ${name(d)}${custos.v !== v ? ' (at the start of the next staff)' : ''}.`);
              custos = null;
            }
            if (prev && !lastBar && Math.abs(d - prev.d) >= 6)
              at(v, s, i, 'leap', 'note', `A leap of ${an(interval(Math.abs(d - prev.d)))}, ${name(prev.d)} to ${name(d)}: rare in chant. A misread note?`);
            prev = { d, v, s, i };
            lastBar = false;
            notes.push(prev);
          }
          // (only where the staff has words at all: notes read from the page, before any text, all lack them)
          if (ns.some(n => !n.acc) && !syl.text && !syl.items.some(x => C().kind(x.g) === 'clef') && st.syllables.some(x => x.text))
            at(v, s, i, 'text', 'note', 'Notes over no syllable. Is a syllable missing, or do they belong to the one before?');
        }));
      });
      // the mode: its final, and its range
      const mode = parseInt(String((chant.headers || {}).mode || '').trim(), 10);
      if (FINALS[mode] && notes.length) {
        const fin = notes[notes.length - 1], step = STEPS[fin.d % 7];
        if (!FINALS[mode].includes(step))
          at(fin.v, fin.s, fin.i, 'final', 'note', `The chant ends on ${step}; mode ${mode} ends on ${FINALS[mode][0]} (or ${FINALS[mode][1]}, transposed). Is the last note, or the mode, right?`);
        else {
          const [lo, hi] = mode % 2 ? [-1, 8] : [-3, 5];
          for (const n of notes) {
            const r = n.d - fin.d;
            if (r < lo - 1 || r > hi + 1)
              at(n.v, n.s, n.i, 'range', 'note', `${name(n.d)} is ${r < 0 ? 'below' : 'above'} the usual range of mode ${mode} (${name(fin.d + lo)} to ${name(fin.d + hi)}, from its final ${name(fin.d)}).`);
          }
        }
      }
    }
    return out;
  }

  const api = { check, chants, diatonic, name };
  global.CGChecks = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
