// Staff geometry, and finding a staff's four lines in the ink. A staff's lines are four lists of points, top line
// first: [x0, y0, x1, y1, …], in page units. A straight staff has two points a line, its ends; a warped one (a page
// that couldn't be scanned flat) has more, its bends, the same xs on all four lines. Between points a line runs
// straight. Nothing here touches the page: fitStaff() and fit() take a grey image (one byte a pixel, 0 black) and a
// region of it, and work in that image's pixels.
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- geometry
  const count = l => l.length >> 1;
  const xsOf = l => l.filter((v, i) => !(i & 1));
  // a line's height at x: between its points, along the straight piece; beyond its ends, carried on the end piece
  function yAt(l, x) {
    const n = count(l);
    let k = 0;
    while (k < n - 2 && x > l[2 * k + 2]) k++;
    const xa = l[2 * k], ya = l[2 * k + 1], xb = l[2 * k + 2], yb = l[2 * k + 3];
    return xb === xa ? ya : ya + (yb - ya) * (x - xa) / (xb - xa);
  }
  // the four lines at the given xs (all four through the same points)
  const atXs = (lines, xs) => lines.map(l => xs.flatMap(x => [x, yAt(l, x)]));

  // the distance between neighbouring lines, averaged over the top line's points
  const spacing = lines => { const xs = xsOf(lines[0]); return xs.reduce((t, x) => t + yAt(lines[3], x) - yAt(lines[0], x), 0) / (3 * xs.length); };
  // the tilt from end to end, in degrees (positive: the staff runs downhill to the right)
  const tilt = lines => {
    const t = lines[0], b = lines[3], n = count(t), dx = t[2 * n - 2] - t[0];
    return dx ? Math.atan2(((t[2 * n - 1] + yAt(b, t[2 * n - 2])) - (t[1] + yAt(b, t[0]))) / 2, dx) * 180 / Math.PI : 0;
  };
  // how far the staff bends away from straight, in spaces (0 for a straight one)
  const bend = lines => {
    const m = middleLine(lines), n = count(m);
    let worst = 0;
    for (let k = 1; k < n - 1; k++) worst = Math.max(worst, Math.abs(m[2 * k + 1] - yAt([m[0], m[1], m[2 * n - 2], m[2 * n - 1]], m[2 * k])));
    return worst / spacing(lines);
  };
  const middleLine = lines => { const xs = xsOf(lines[0]); return xs.flatMap(x => [x, (yAt(lines[0], x) + yAt(lines[3], x)) / 2]); };
  // where the middle of the staff is, for putting staves in reading order
  const middle = lines => { const m = middleLine(lines); return m.filter((v, i) => i & 1).reduce((t, v) => t + v, 0) / count(m); };

  // four lines spread evenly over a box [x, y, w, h], the top line along its top and the bottom along its bottom
  function even(box) {
    const [x, y, w, h] = box;
    return [0, 1, 2, 3].map(i => [x, y + h * i / 3, x + w, y + h * i / 3]);
  }

  // the two middle lines set evenly between the top and bottom ones, at each of the top line's points
  function spaceEvenly(lines) {
    const xs = xsOf(lines[0]);
    return [0, 1, 2, 3].map(i => xs.flatMap(x => { const t = yAt(lines[0], x), b = yAt(lines[3], x); return [x, t + (b - t) * i / 3]; }));
  }

  // a bend point added at x (the lines unchanged until it is moved); or the k-th taken away (not an end)
  function addBend(lines, x) {
    const xs = xsOf(lines[0]);
    if (x <= xs[0] || x >= xs[xs.length - 1] || xs.some(v => Math.abs(v - x) < 1e-6)) return lines;
    return atXs(lines, xs.concat(x).sort((a, b) => a - b));
  }
  function removeBend(lines, k) {
    if (k <= 0 || k >= count(lines[0]) - 1) return lines;
    return lines.map(l => l.filter((v, i) => (i >> 1) !== k));
  }

  // the bends that make no difference taken away: none further than tol (page units) from where the line would run
  // without it (Douglas–Peucker, on the middle of the staff, the same points kept on all four lines)
  function simplify(lines, tol) {
    const m = middleLine(lines), n = count(m), keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    (function split(a, b) {
      let worst = 0, at = -1;
      for (let k = a + 1; k < b; k++) {
        const d = Math.abs(m[2 * k + 1] - yAt([m[2 * a], m[2 * a + 1], m[2 * b], m[2 * b + 1]], m[2 * k]));
        if (d > worst) { worst = d; at = k; }
      }
      if (at >= 0 && worst > tol) { keep[at] = 1; split(a, at); split(at, b); }
    })(0, n - 1);
    return lines.map(l => l.filter((v, i) => keep[i >> 1]));
  }

  // the staff's box: its lines, with room above and below for notes off the staff (a step and a half, about a
  // note on a ledger line), kept on the page
  function box(lines, size) {
    const s = spacing(lines), pad = 1.5 * s;
    const xs = lines.flatMap(xsOf), ys = lines.flatMap(l => l.filter((v, i) => i & 1));
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    if (size) { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(size[0], x1); y1 = Math.min(size[1], y1); }
    return [x0, y0, x1 - x0, y1 - y0].map(round);
  }

  const round = v => Math.round(v * 100) / 100;
  const roundLines = lines => lines.map(l => l.map(round));

  // ---------------------------------------------------------------- finding the lines
  // A region's darkness against its paper, for the searches below: each pixel by how much darker it is than the
  // paper (the median grey); lighter counts against, and very dark counts no more than middling, so notes don't
  // swamp faint lines. dark is W × H, from the region's top left. Null if the region has no ink to speak of.
  function darkness(gray, w, x0, y0, x1, y1) {
    const W = x1 - x0, H = y1 - y0, hist = new Float64Array(256);
    for (let y = y0; y < y1; y++) for (let x = x0, o = y * w + x0; x < x1; x++, o++) hist[gray[o]]++;
    const level = q => { let c = 0; for (let i = 0; i < 256; i++) { c += hist[i]; if (c >= q * W * H) return i; } return 255; };
    const paper = level(0.5), darkest = level(0.01);
    if (paper - darkest < 20) return null;
    const cap = Math.max(20, (paper - darkest) / 2), dark = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0, o = (y + y0) * w + x0; x < W; x++, o++) dark[y * W + x] = Math.max(-cap, Math.min(cap, paper - gray[o]));
    return { dark, W, H, paper, darkest, level };
  }

  // How far a staff's lines run, within a darkness map: [first, last] columns, or null. lineYs: for each line, its
  // row at a column (in the map's rows). The darkness along each line is smoothed over a space's length (row by row
  // within near rows of it, then the darkest row: smoothing first, so the noise of single pixels doesn't pass for
  // line); a column is on the staff where three of the four lines are at least half as dark as they usually are.
  // The longest such stretch is the staff, bridging gaps of up to half a space: a drop cap or a word beside the
  // staff is left off.
  function stretch(dark, W, H, lineYs, g, near) {
    const run = Math.max(3, Math.round(g)), half = run >> 1;
    const along = lineYs.map(yOf => {
      const sm = new Float64Array(W).fill(-Infinity), sum = new Float64Array(W + 1);
      for (let o = -near; o <= near; o++) {
        for (let x = 0; x < W; x++) {
          const y = Math.round(yOf(x)) + o;
          sum[x + 1] = sum[x] + (y >= 0 && y < H ? dark[y * W + x] : 0);
        }
        for (let x = 0; x < W; x++) { const a = Math.max(0, x - half), b = Math.min(W, x + half + 1); sm[x] = Math.max(sm[x], (sum[b] - sum[a]) / (b - a)); }
      }
      const typical = Array.from(sm).sort((a, b) => a - b)[Math.floor(0.75 * W)];
      return { sm, typical };
    });
    const good = new Uint8Array(W);
    for (let x = 0; x < W; x++) good[x] = along.filter(a => a.typical > 0 && a.sm[x] >= 0.5 * a.typical).length >= 3 ? 1 : 0;
    let first = -1, last = -1, from = -1, gap = 0;
    for (let x = 0; x <= W; x++) {
      if (x < W && good[x]) { if (from < 0) from = x; gap = 0; continue; }
      if (from < 0) continue;
      if (x < W && ++gap <= g / 2) continue;
      const end = x - (x < W ? gap : 0);
      if (end - from > last - first) { first = from; last = end; }
      from = -1; gap = 0;
    }
    return first < 0 || last - first < 2 * g ? null : [first, last];
  }

  // Finds a staff's four lines in a region of a grey image. gray: Uint8Array, w × h; region: [x, y, w, h], in the
  // image's pixels, around one staff (it may take in notes and text too). Returns { lines, spacing, slope } in the
  // image's pixels, or null if four evenly spaced lines aren't there. Options: slope, the tilt to search around
  // (pixels down per pixel across; level by default); trace, an object, filled in with what was measured on the way
  // (the paper, the noise, the peaks), for finding out why a staff wasn't found.
  //
  // How: each pixel counts by how much darker it is than the paper (lighter counts against; very dark counts no
  // more than middling, so notes don't swamp faint lines). Summed along rows at each small tilt, the tilt that piles
  // the darkness into the sharpest peaks is the staff's. Of the peaks that stand clear of the paper's noise, the four
  // strongest at nearly even spacing are the lines. Each runs as far as at least three of the four are drawn.
  function fit(gray, w, h, region, { slope: around = 0, trace } = {}) {
    const [rx, ry, rw, rh] = region.map(Math.round);
    const x0 = Math.max(0, rx), y0 = Math.max(0, ry), x1 = Math.min(w, rx + rw), y1 = Math.min(h, ry + rh);
    const W = x1 - x0, H = y1 - y0;
    if (W < 20 || H < 8) return null;

    const dm = darkness(gray, w, x0, y0, x1, y1);
    if (!dm) return null;
    const { dark, paper, darkest, level } = dm;

    // the tilt, up to about 3 degrees either side of the one searched around: coarse, then fine
    const xc = (W - 1) / 2, pad = Math.ceil((Math.abs(around) + 0.06) * W / 2) + 2, n = H + 2 * pad;
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
    for (let k = -50; k <= 50; k += 4) tryS(around + k / 1000);
    const coarse = best.s;
    for (let k = -4; k <= 4; k++) if (k) tryS(coarse + k / 2000);
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

    // how far the lines run
    const near = Math.max(1, Math.ceil(Math.max(...staff.q.map(v => v.thick)) / 2));
    const span = stretch(dark, W, H, staff.q.map(v => x => v.y - y0 + slope * (x - xc)), staff.g, near);
    if (!span) return null;
    const [first, last] = span;
    const xa = x0 + first, xb = x0 + last;
    const lines = staff.q.map(v => [xa, v.y + slope * (xa - x0 - xc), xb, v.y + slope * (xb - x0 - xc)]);
    return { lines, spacing: staff.g, slope };
  }

  // Finds a staff's four lines in a region, straight or bent. Returns { lines, spacing } in the image's pixels, the
  // lines with as many points as their bends need (two for a straight staff), or null.
  //
  // How: the middle of the region is fitted first (fit(), below), where even a warped staff is nearly straight. From
  // there the staff is followed outwards a strip at a time, each strip about eight spaces wide and fitted where the
  // strip before says the lines should be: the same spacing, within a quarter, and no more than a little over half a
  // space from where they were heading. A strip that doesn't fit is stepped over (a drop cap, a smudge); three in a
  // row, or a strip where the lines stop short, and the staff has ended. The points that make no difference are then
  // taken away, and if none is left between the ends (or those left bend it by less than a sixth of a space, as noise
  // can), the staff is straight and fitted again as a whole.
  function fitStaff(gray, w, h, region, trace) {
    const [rx, ry, rw, rh] = region;
    const rx0 = Math.max(0, rx), rx1 = Math.min(w, rx + rw);
    if (rx1 - rx0 < 20) return null;
    const cw = Math.min(rx1 - rx0, Math.max((rx1 - rx0) / 3, 200)), mid = (rx0 + rx1) / 2;
    const start = fit(gray, w, h, [mid - cw / 2, ry, cw, rh]) || fit(gray, w, h, region);
    if (!start) return null;
    const g = start.spacing, sw = Math.max(40, 8 * g), step = sw / 2;
    const s0 = start.lines[0], cx = (s0[0] + s0[2]) / 2;
    const first = { x: cx, ys: start.lines.map(l => yAt(l, cx)), slope: start.slope };
    const knots = [first], ends = [s0[0], s0[2]], misses = [];
    for (const dir of [1, -1]) {
      let prev = first, x = Math.max(cx, dir > 0 ? s0[2] - step : cx), lost = 0;
      if (dir < 0) x = Math.min(cx, s0[0] + step);
      for (;;) {
        x += dir * step;
        const sx0 = Math.max(rx0, x - sw / 2), sx1 = Math.min(rx1, x + sw / 2);
        if (sx1 - sx0 < 3 * g) break;
        // where the lines are heading: along the last strip's slope, steepening as it was steepening (a page's curl
        // grows towards the binding)
        const ahead = prev.trend ? prev.slope + prev.trend * (x - prev.x) / 2 : prev.slope;
        const at = (y, xx) => y + ahead * (xx - prev.x);
        const tops = [sx0, sx1].map(xx => at(prev.ys[0], xx)), bots = [sx0, sx1].map(xx => at(prev.ys[3], xx));
        const top = Math.min(...tops) - 1.3 * g, bot = Math.max(...bots) + 1.3 * g;
        const r = fit(gray, w, h, [sx0, top, sx1 - sx0, bot - top], { slope: ahead });
        const ok = r && Math.abs(r.spacing - g) < 0.25 * g && Math.abs(yAt(r.lines[0], x) - at(prev.ys[0], x)) < 0.6 * g;
        if (!ok) { misses.push(Math.round(x)); if (++lost >= 3) break; continue; }
        lost = 0;
        const ea = r.lines[0][0], eb = r.lines[0][2], kx = Math.min(Math.max(x, ea), eb);
        const trend = prev.own !== undefined && kx !== prev.x ? (r.slope - prev.own) / (kx - prev.x) : 0;
        prev = { x: kx, ys: r.lines.map(l => yAt(l, kx)), slope: r.slope, own: r.slope, trend };
        knots.push(prev);
        if (dir > 0) ends[1] = Math.max(ends[1], eb); else ends[0] = Math.min(ends[0], ea);
        // the lines stop short of the strip's far side (and of the region's): the staff ends here
        if (dir > 0 ? eb < sx1 - g && sx1 < rx1 : ea > sx0 + g && sx0 > rx0) break;
      }
    }
    knots.sort((a, b) => a.x - b.x);
    // the ends, carried on from the nearest point along its slope
    for (const [end, near] of [[ends[0], knots[0]], [ends[1], knots[knots.length - 1]]]) {
      if (Math.abs(end - near.x) < 1) continue;
      const sl = near.own !== undefined ? near.own : near.slope;
      knots.push({ x: end, ys: near.ys.map(y => y + sl * (end - near.x)), slope: sl });
    }
    knots.sort((a, b) => a.x - b.x);
    let lines = [0, 1, 2, 3].map(i => knots.flatMap(k => [k.x, k.ys[i]]));
    lines = simplify(lines, 0.06 * g);
    if (trace) Object.assign(trace, { spacing: g, knots: knots.map(k => Math.round(k.x)), misses, kept: count(lines[0]) });
    if (count(lines[0]) === 2 || bend(lines) < 0.15) {
      // straight, or as near it as noise can make a straight staff look (its bends less than a sixth of a space): the
      // whole stretch fitted at once is steadier than its ends carried on from strips
      lines = [0, 1, 2, 3].map(i => [lines[i][0], lines[i][1], lines[i][lines[i].length - 2], lines[i][lines[i].length - 1]]);
      const ys = lines.flatMap(l => [l[1], l[3]]);
      const whole = fit(gray, w, h, [ends[0] - g, Math.min(...ys) - 1.5 * g, ends[1] - ends[0] + 2 * g, Math.max(...ys) - Math.min(...ys) + 3 * g], { slope: ((ys[1] - ys[0]) + (ys[7] - ys[6])) / 2 / Math.max(1, lines[0][2] - lines[0][0]) });
      if (whole && Math.abs(whole.spacing - g) < 0.15 * g) return { lines: whole.lines, spacing: whole.spacing };
    }
    // bent: the ends found again along the bent lines themselves (near the binding a strip's straight fit drifts
    // off the curve before the lines end)
    const lg = spacing(lines), ex0 = Math.max(rx0, Math.floor(ends[0] - 3 * lg)), ex1 = Math.min(rx1, Math.ceil(ends[1] + 3 * lg));
    const yr = [ex0, ex1].flatMap(x => [yAt(lines[0], x), yAt(lines[3], x)]).concat(lines.flatMap(l => l.filter((v, i) => i & 1)));
    const ey0 = Math.max(0, Math.floor(Math.min(...yr) - 2 * lg)), ey1 = Math.min(h, Math.ceil(Math.max(...yr) + 2 * lg));
    const dm = ex1 - ex0 > 20 && ey1 - ey0 > 8 && darkness(gray, w, ex0, ey0, ex1, ey1);
    const span = dm && stretch(dm.dark, dm.W, dm.H, lines.map(l => x => yAt(l, ex0 + x) - ey0), lg, Math.max(1, Math.round(lg / 8)));
    if (span) lines = clip(lines, ex0 + span[0], ex0 + span[1]);
    return { lines, spacing: spacing(lines) };
  }

  // the lines cut, or carried on, to run from xa to xb, keeping the points between
  function clip(lines, xa, xb) {
    const xs = [xa, ...xsOf(lines[0]).filter(x => x > xa + 1 && x < xb - 1), xb];
    return atXs(lines, xs);
  }

  // RGBA pixels (from a canvas) to grey, one byte a pixel
  function grey(rgba) {
    const out = new Uint8Array(rgba.length / 4);
    for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    return out;
  }

  const api = { count, xsOf, yAt, atXs, spacing, tilt, bend, middle, even, spaceEvenly, addBend, removeBend, simplify, box, roundLines, fitStaff, fit, grey };
  global.CGStaves = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
