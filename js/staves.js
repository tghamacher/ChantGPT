// Staff geometry, and finding a staff's four lines in the ink. A staff's lines are [[x0, y0, x1, y1] × 4], top to
// bottom, in page units. Nothing here touches the page: fit() takes a grey image (one byte a pixel, 0 black) and a
// region of it, and works in that image's pixels.
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- geometry
  // the distance between neighbouring lines, averaged over both ends
  const spacing = lines => ((lines[3][1] - lines[0][1]) + (lines[3][3] - lines[0][3])) / 6;
  // the tilt, in degrees (positive: the staff runs downhill to the right)
  const tilt = lines => {
    const dx = lines[0][2] - lines[0][0];
    return dx ? Math.atan2(((lines[0][3] + lines[3][3]) - (lines[0][1] + lines[3][1])) / 2, dx) * 180 / Math.PI : 0;
  };
  // where the middle of the staff is, for putting staves in reading order
  const middle = lines => (lines[0][1] + lines[0][3] + lines[3][1] + lines[3][3]) / 4;

  // four lines spread evenly over a box [x, y, w, h], the top line along its top and the bottom along its bottom
  function even(box) {
    const [x, y, w, h] = box;
    return [0, 1, 2, 3].map(i => [x, y + h * i / 3, x + w, y + h * i / 3]);
  }

  // the two middle lines set evenly between the top and bottom ones, at both ends
  function spaceEvenly(lines) {
    const t = lines[0], b = lines[3];
    return [0, 1, 2, 3].map(i => [t[0], t[1] + (b[1] - t[1]) * i / 3, t[2], t[3] + (b[3] - t[3]) * i / 3]);
  }

  // the staff's box: its lines, with room above and below for notes off the staff (a step and a half, about a
  // note on a ledger line), kept on the page
  function box(lines, size) {
    const s = spacing(lines), pad = 1.5 * s;
    const xs = lines.flatMap(l => [l[0], l[2]]), ys = lines.flatMap(l => [l[1], l[3]]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    if (size) { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(size[0], x1); y1 = Math.min(size[1], y1); }
    return [x0, y0, x1 - x0, y1 - y0].map(round);
  }

  const round = v => Math.round(v * 100) / 100;
  const roundLines = lines => lines.map(l => l.map(round));

  // ---------------------------------------------------------------- finding the lines
  // Finds a staff's four lines in a region of a grey image. gray: Uint8Array, w × h; region: [x, y, w, h], in the
  // image's pixels, around one staff (it may take in notes and text too). Returns { lines, spacing, slope } in the
  // image's pixels, or null if four evenly spaced lines aren't there. trace, an object, if given, is filled in with
  // what was measured on the way (the paper, the noise, the peaks), for finding out why a staff wasn't found.
  //
  // How: each pixel counts by how much darker it is than the paper (lighter counts against; very dark counts no
  // more than middling, so notes don't swamp faint lines). Summed along rows at each small tilt, the tilt that piles
  // the darkness into the sharpest peaks is the staff's. Of the peaks that stand clear of the paper's noise, the four
  // strongest at nearly even spacing are the lines. Each runs as far as at least three of the four are drawn.
  function fit(gray, w, h, region, trace) {
    const [rx, ry, rw, rh] = region.map(Math.round);
    const x0 = Math.max(0, rx), y0 = Math.max(0, ry), x1 = Math.min(w, rx + rw), y1 = Math.min(h, ry + rh);
    const W = x1 - x0, H = y1 - y0;
    if (W < 20 || H < 8) return null;

    // the paper (the median grey) and how much a pixel may count
    const hist = new Float64Array(256);
    for (let y = y0; y < y1; y++) for (let x = x0, o = y * w + x0; x < x1; x++, o++) hist[gray[o]]++;
    const level = q => { let c = 0; for (let i = 0; i < 256; i++) { c += hist[i]; if (c >= q * W * H) return i; } return 255; };
    const paper = level(0.5), darkest = level(0.01);
    if (paper - darkest < 20) return null;
    const cap = Math.max(20, (paper - darkest) / 2);
    const dark = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0, o = (y + y0) * w + x0; x < W; x++, o++) dark[y * W + x] = Math.max(-cap, Math.min(cap, paper - gray[o]));

    // the tilt, up to about 3 degrees either way: coarse, then fine
    const xc = (W - 1) / 2, pad = Math.ceil(0.06 * W) + 2, n = H + 2 * pad;
    const profile = slope => {
      const p = new Float64Array(n);
      for (let x = 0; x < W; x++) {
        const shift = pad - Math.round(slope * (x - xc));
        for (let y = 0; y < H; y++) p[y + shift] += dark[y * W + x];
      }
      return p;
    };
    const sharp = p => { let t = 0; for (let r = 0; r < n; r++) if (p[r] > 0) t += p[r] * p[r]; return t; };
    let best = null;
    const tryS = s => { const p = profile(s), sc = sharp(p); if (!best || sc > best.score) best = { s, p, score: sc }; };
    for (let k = -50; k <= 50; k += 4) tryS(k / 1000);
    const around = best.s;
    for (let k = -4; k <= 4; k++) if (k) tryS(around + k / 2000);
    const { s: slope, p } = best;

    // the peaks: rows darker than their neighbours by much more than the paper's noise could make them. The noise
    // is measured on the paper's light side, where there is no ink; summed over a row it grows as the row's root.
    const noise = Math.max(1, (level(0.75) - paper) / 0.674) * Math.sqrt(W);
    let max = 0;
    for (let r = 0; r < n; r++) max = Math.max(max, p[r]);
    const peaks = [];
    for (let r = 1; r < n - 1; r++) {
      if (!(p[r] >= p[r - 1] && p[r] > p[r + 1])) continue;
      let base = Infinity;
      for (let j = Math.max(0, r - 4); j <= Math.min(n - 1, r + 4); j++) base = Math.min(base, p[j]);
      const rise = p[r] - base;
      if (rise < 8 * noise || rise < 0.1 * max) continue;
      let sum = 0, at = 0, thick = 0;
      for (let j = r - 1; j <= r + 1; j++) { const v = Math.max(0, p[j] - base); sum += v; at += v * j; }
      for (let j = Math.max(0, r - 4); j <= Math.min(n - 1, r + 4); j++) if (p[j] - base >= rise / 2) thick++;
      peaks.push({ y: at / sum - pad + y0, strength: sum, thick });
    }
    if (trace) Object.assign(trace, { paper, darkest, slope, noise: Math.round(noise), max: Math.round(max), peaks: peaks.map(v => ({ y: +v.y.toFixed(1), s: Math.round(v.strength), t: v.thick })) });
    if (peaks.length < 4) return null;

    // the staff: four peaks evenly spaced (within a quarter of a space), as strong as can be, the weakest at least
    // a third as strong as the strongest
    const cand = peaks.slice().sort((a, b) => b.strength - a.strength).slice(0, 16).sort((a, b) => a.y - b.y);
    let staff = null;
    for (let a = 0; a < cand.length; a++) for (let b = a + 1; b < cand.length; b++) for (let c = b + 1; c < cand.length; c++) for (let d = c + 1; d < cand.length; d++) {
      const q = [cand[a], cand[b], cand[c], cand[d]], gaps = [q[1].y - q[0].y, q[2].y - q[1].y, q[3].y - q[2].y];
      const g = (q[3].y - q[0].y) / 3;
      if (g < 3) continue;
      const spread = Math.max(...gaps.map(v => Math.abs(v - g))) / g;
      if (spread > 0.25) continue;
      const strengths = q.map(v => v.strength);
      if (Math.min(...strengths) < Math.max(...strengths) / 3) continue;
      const score = strengths.reduce((t, v) => t + v, 0) * (1 - spread);
      if (!staff || score > staff.score) staff = { q, g, score };
    }
    if (!staff) return null;

    // how far the lines run: the darkness along each line, smoothed over a space's length; a column is on the staff
    // where three of the four lines are at least half as dark as they usually are
    const near = Math.max(1, Math.ceil(Math.max(...staff.q.map(v => v.thick)) / 2));
    const run = Math.max(3, Math.round(staff.g));
    const along = staff.q.map(v => {
      // each row near the line smoothed over a space centred on each column, then the darkest of them (smoothing
      // first, so the noise of single pixels doesn't pass for line)
      const half = run >> 1, sm = new Float64Array(W).fill(-Infinity), sum = new Float64Array(W + 1);
      for (let o = -near; o <= near; o++) {
        for (let x = 0; x < W; x++) {
          const y = Math.round(v.y - y0 + slope * (x - xc)) + o;
          sum[x + 1] = sum[x] + (y >= 0 && y < H ? dark[y * W + x] : 0);
        }
        for (let x = 0; x < W; x++) { const a = Math.max(0, x - half), b = Math.min(W, x + half + 1); sm[x] = Math.max(sm[x], (sum[b] - sum[a]) / (b - a)); }
      }
      const typical = Array.from(sm).sort((a, b) => a - b)[Math.floor(0.75 * W)];
      return { sm, typical };
    });
    const good = new Uint8Array(W);
    for (let x = 0; x < W; x++) good[x] = along.filter(a => a.typical > 0 && a.sm[x] >= 0.5 * a.typical).length >= 3 ? 1 : 0;
    // the longest stretch, bridging gaps of up to half a space: a drop cap or a word beside the staff is left off
    let first = -1, last = -1, from = -1, gap = 0;
    for (let x = 0; x <= W; x++) {
      if (x < W && good[x]) { if (from < 0) from = x; gap = 0; continue; }
      if (from < 0) continue;
      if (x < W && ++gap <= staff.g / 2) continue;
      const end = x - (x < W ? gap : 0);
      if (end - from > last - first) { first = from; last = end; }
      from = -1; gap = 0;
    }
    if (first < 0 || last - first < 2 * staff.g) return null;
    const xa = x0 + first, xb = x0 + last;
    const lines = staff.q.map(v => [xa, v.y + slope * (xa - x0 - xc), xb, v.y + slope * (xb - x0 - xc)]);
    return { lines, spacing: staff.g, slope };
  }

  // RGBA pixels (from a canvas) to grey, one byte a pixel
  function grey(rgba) {
    const out = new Uint8Array(rgba.length / 4);
    for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    return out;
  }

  const api = { spacing, tilt, middle, even, spaceEvenly, box, roundLines, fit, grey };
  global.CGStaves = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
