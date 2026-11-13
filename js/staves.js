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
  const spacing = lines => { const xs = xsOf(lines[0]), b = lines[lines.length - 1]; return xs.reduce((t, x) => t + yAt(b, x) - yAt(lines[0], x), 0) / ((lines.length - 1) * xs.length); };
  // the tilt from end to end, in degrees (positive: the staff runs downhill to the right)
  const tilt = lines => {
    const t = lines[0], b = lines[lines.length - 1], n = count(t), dx = t[2 * n - 2] - t[0];
    return dx ? Math.atan2(((t[2 * n - 1] + yAt(b, t[2 * n - 2])) - (t[1] + yAt(b, t[0]))) / 2, dx) * 180 / Math.PI : 0;
  };
  // how far the staff bends away from straight, in spaces (0 for a straight one)
  const bend = lines => {
    const m = middleLine(lines), n = count(m);
    let worst = 0;
    for (let k = 1; k < n - 1; k++) worst = Math.max(worst, Math.abs(m[2 * k + 1] - yAt([m[0], m[1], m[2 * n - 2], m[2 * n - 1]], m[2 * k])));
    return worst / spacing(lines);
  };
  const middleLine = lines => { const xs = xsOf(lines[0]); return xs.flatMap(x => [x, (yAt(lines[0], x) + yAt(lines[lines.length - 1], x)) / 2]); };
  // where the middle of the staff is, for putting staves in reading order
  const middle = lines => { const m = middleLine(lines); return m.filter((v, i) => i & 1).reduce((t, v) => t + v, 0) / count(m); };

  // four lines (or n) spread evenly over a box [x, y, w, h], the top line along its top and the bottom along its bottom
  function even(box, n = 4) {
    const [x, y, w, h] = box;
    return Array.from({ length: n }, (_, i) => [x, y + h * i / (n - 1), x + w, y + h * i / (n - 1)]);
  }

  // the two middle lines set evenly between the top and bottom ones, at each of the top line's points
  function spaceEvenly(lines) {
    const xs = xsOf(lines[0]);
    const n = lines.length;
    return Array.from({ length: n }, (_, i) => xs.flatMap(x => { const t = yAt(lines[0], x), b = yAt(lines[n - 1], x); return [x, t + (b - t) * i / (n - 1)]; }));
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
  function darkness(gray, w, x0, y0, x1, y1, rare = 0.01) {
    const W = x1 - x0, H = y1 - y0, hist = new Float64Array(256);
    for (let y = y0; y < y1; y++) for (let x = x0, o = y * w + x0; x < x1; x++, o++) hist[gray[o]]++;
    const level = q => { let c = 0; for (let i = 0; i < 256; i++) { c += hist[i]; if (c >= q * W * H) return i; } return 255; };
    const paper = level(0.5), darkest = level(rare);
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
  // loose: a map of the ruling's ink alone, where a note on a line is a gap in it: two lines of four are enough, and
  // gaps of up to a space and a half are bridged.
  function stretch(dark, W, H, lineYs, g, near, loose = false) {
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
    for (let x = 0; x < W; x++) good[x] = along.filter(a => a.typical > 0 && a.sm[x] >= 0.5 * a.typical).length >= (loose ? 2 : 3) ? 1 : 0;
    let first = -1, last = -1, from = -1, gap = 0;
    for (let x = 0; x <= W; x++) {
      if (x < W && good[x]) { if (from < 0) from = x; gap = 0; continue; }
      if (from < 0) continue;
      if (x < W && ++gap <= (loose ? 1.5 * g : g / 2)) continue;
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
  function fit(gray, w, h, region, { slope: around = 0, trace, loose = false } = {}) {
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
      if (spread > (loose ? 0.6 : 0.25)) continue;
      const strengths = q.map(v => v.strength);
      if (Math.min(...strengths) < Math.max(...strengths) / 3) continue;
      const score = strengths.reduce((t, v) => t + v, 0) * (1 - spread);
      if (!staff || score > staff.score) staff = { q, g, score };
    }
    if (!staff) return null;

    // how far the lines run
    const near = Math.max(1, Math.ceil(Math.max(...staff.q.map(v => v.thick)) / 2));
    const span = stretch(dark, W, H, staff.q.map(v => x => v.y - y0 + slope * (x - xc)), staff.g, near, loose);
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
  function fitStaff(gray, w, h, region, trace, loose = false) {
    const [rx, ry, rw, rh] = region;
    const rx0 = Math.max(0, rx), rx1 = Math.min(w, rx + rw);
    if (rx1 - rx0 < 20) return null;
    const cw = Math.min(rx1 - rx0, Math.max((rx1 - rx0) / 3, 200)), mid = (rx0 + rx1) / 2;
    const start = fit(gray, w, h, [mid - cw / 2, ry, cw, rh], { loose }) || fit(gray, w, h, region, { loose });
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
        const r = fit(gray, w, h, [sx0, top, sx1 - sx0, bot - top], { slope: ahead, loose });
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
      const whole = fit(gray, w, h, [ends[0] - g, Math.min(...ys) - 1.5 * g, ends[1] - ends[0] + 2 * g, Math.max(...ys) - Math.min(...ys) + 3 * g], { slope: ((ys[1] - ys[0]) + (ys[7] - ys[6])) / 2 / Math.max(1, lines[0][2] - lines[0][0]), loose });
      if (whole && Math.abs(whole.spacing - g) < 0.15 * g) return { lines: whole.lines, spacing: whole.spacing };
    }
    // bent: the ends found again along the bent lines themselves (near the binding a strip's straight fit drifts
    // off the curve before the lines end)
    const lg = spacing(lines), ex0 = Math.max(rx0, Math.floor(ends[0] - 3 * lg)), ex1 = Math.min(rx1, Math.ceil(ends[1] + 3 * lg));
    const yr = [ex0, ex1].flatMap(x => [yAt(lines[0], x), yAt(lines[lines.length - 1], x)]).concat(lines.flatMap(l => l.filter((v, i) => i & 1)));
    const ey0 = Math.max(0, Math.floor(Math.min(...yr) - 2 * lg)), ey1 = Math.min(h, Math.ceil(Math.max(...yr) + 2 * lg));
    const dm = ex1 - ex0 > 20 && ey1 - ey0 > 8 && darkness(gray, w, ex0, ey0, ex1, ey1);
    const span = dm && stretch(dm.dark, dm.W, dm.H, lines.map(l => x => yAt(l, ex0 + x) - ey0), lg, Math.max(1, Math.round(lg / 8)), loose);
    if (span) lines = clip(lines, ex0 + span[0], ex0 + span[1]);
    return { lines, spacing: spacing(lines) };
  }

  // the lines cut, or carried on, to run from xa to xb, keeping the points between
  function clip(lines, xa, xb) {
    const xs = [xa, ...xsOf(lines[0]).filter(x => x > xa + 1 && x < xb - 1), xb];
    return atXs(lines, xs);
  }

  // A page's columns of writing: [[x0, x1, a, b], …] in pixels, left to right (a to b where the writing runs, if it
  // could be told); one, unless a gutter runs down the middle
  // (an empty band, a hundredth of the page wide or more, with writing on both sides of it, as a manuscript's two
  // columns have). The page is cut into strips a hundredth of its height; for each x, the share of strips with ink
  // (darker than the paper; a staff's lines, however fine, count, so a staff running across is never taken for a
  // gutter) within half a hundredth of the width of it. A gutter is where few strips have ink: a big initial
  // reaching across it fills only a few.
  function columns(gray, w, h) {
    const hist = new Float64Array(256);
    for (let i = 0; i < gray.length; i += 7) hist[gray[i]]++;
    const total = hist.reduce((t, v) => t + v, 0);
    const level = q => { let c = 0; for (let i = 0; i < 256; i++) { c += hist[i]; if (c >= q * total) return i; } return 255; };
    const paper = level(0.5), cut = 30;
    // (the rows mostly dark from the top and the bottom edge in: the ground round a photographed leaf, left out)
    const dark = y => { let n = 0; for (let x = 0, o = y * w; x < w; x++, o++) if (paper - gray[o] > cut) n++; return n > 0.6 * w; };
    let ya = 0, yb = h - 1;
    while (ya < h && dark(ya)) ya += 4;
    while (yb > ya && dark(yb)) yb -= 4;
    const k = Math.max(1, Math.round(0.005 * w)), strip = Math.max(4, Math.round(0.01 * h));
    const sm = new Float64Array(w), ink = new Float64Array(w), cum = new Float64Array(w + 1);
    let strips = 0;
    for (let y0 = ya; y0 + strip <= yb + 1; y0 += strip) {
      ink.fill(0);
      for (let y = y0; y < y0 + strip; y += 4) for (let x = 0, o = y * w; x < w; x++, o++) if (paper - gray[o] > cut) ink[x]++;
      for (let x = 0; x < w; x++) cum[x + 1] = cum[x] + ink[x];
      const enough = 0.02 * Math.ceil(strip / 4) * (2 * k + 1);
      for (let x = 0; x < w; x++) if (cum[Math.min(w, x + k + 1)] - cum[Math.max(0, x - k)] > enough) sm[x]++;
      strips++;
    }
    const inner = Array.from(sm.slice(Math.round(0.1 * w), Math.round(0.9 * w))).sort((a, b) => a - b);
    const typical = inner[Math.floor(0.6 * inner.length)];
    if (!(typical > 0)) return [[0, w]];
    // the emptiest stretch near the middle
    let best = null;
    for (let x = Math.round(0.3 * w); x < Math.round(0.7 * w); x++) {
      if (sm[x] > 0.35 * typical) continue;
      let e = x; while (e + 1 < w && sm[e + 1] <= 0.35 * typical) e++;
      if (!best || e - x > best[1] - best[0]) best = [x, e];
      x = e;
    }
    // (each column with where its writing runs: the first and last x where half the usual share of strips have ink)
    const writing = (a, b) => {
      let i = a; while (i < b - 1 && sm[i] < 0.5 * typical) i++;
      let j = b - 1; while (j > i && sm[j] < 0.5 * typical) j--;
      return j - i > 0.1 * (b - a) ? [a, b, i, j + 1] : [a, b];
    };
    if (!best || best[1] - best[0] < 0.01 * w) return [writing(0, w)];
    const mean = (a, b) => { let s = 0; for (let x = a; x < b; x++) s += sm[x]; return s / Math.max(1, b - a); };
    if (mean(Math.round(0.1 * w), best[0]) < 0.5 * typical || mean(best[1], Math.round(0.9 * w)) < 0.5 * typical) return [writing(0, w)];
    const mid = Math.round((best[0] + best[1]) / 2);
    return [writing(0, mid), writing(mid, w)];
  }

  // Staves in reading order: down each column, the columns left to right. A staff is in a column with those it
  // overlaps across by half its length or more.
  function order(staves) {
    const span = st => { const xs = xsOf(st.lines[0]); return [xs[0], xs[xs.length - 1]]; };
    const cols = [];
    for (const st of [...staves].sort((a, b) => span(a)[0] - span(b)[0])) {
      const [a, b] = span(st);
      const col = cols.find(c => Math.min(b, c.x1) - Math.max(a, c.x0) >= 0.5 * Math.min(b - a, c.x1 - c.x0));
      if (col) { col.list.push(st); col.x0 = Math.min(col.x0, a); col.x1 = Math.max(col.x1, b); }
      else cols.push({ x0: a, x1: b, list: [st] });
    }
    cols.sort((p, q) => p.x0 - q.x0);
    return cols.flatMap(c => c.list.sort((p, q) => middle(p.lines) - middle(q.lines)));
  }

  // Finds every staff on a page: [{ lines, spacing }] in the image's pixels, in reading order (down each column).
  // skip: boxes [x, y, w, h] (in pixels) of staves already marked, left alone.
  //
  // How: first where the staves are. In a band across the middle of the page (where staves run, past any drop cap or
  // margin note), darkness is summed along rows at the page's tilt (as fit() does for one staff); the rows that stand
  // out sharply are lines. Every four of them evenly spaced, with no strong line between them, could be a staff. The
  // spacing most of those agree on is the staves' (rows of text can fall evenly too); of the fours near it the
  // strongest are taken first, none sharing a line or overlapping another. Each staff found is then fitted on its own
  // across the page's whole width with fitStaff(), between the staves above and below it, so its ends, tilt and bends
  // are its own. A page in two columns (columns()) is searched a column at a time.
  // lines: the page's red ink alone (ruling()), if its staves are ruled in red: the lines are looked for there, where the
  // notes and the words don't get in the way, and in the grey too. If the red finds staves (half as many as the grey
  // or more), they are the page's: on a page ruled in red, the grey's others are rows of words, evenly set.
  // ruled: the book is ruled evenly from top to bottom in pale red-brown, words and notes alike, each row of words on
  // every fifth ruled line (as Paris, BnF lat. 12044), and tint (tint()) shows its ruling: its staves are the four
  // ruled lines above each row of words (byRuling). The person says so (no measure of a single page tells such a
  // book from one ruled a staff at a time reliably enough to choose for them).
  function findStaves(gray, w, h, { skip = [], lines = null, tint = null, reds = null, ruled = false, five = false, trace } = {}) {
    // (a book of five-line staves ruled in red, as the 16th-18th-century choirbooks are: the person says so)
    // (five-line staves: ruled in red, as the choirbooks are, or printed in black, set from type: whichever finds more)
    if (five) {
      const by5 = reds ? byFiveLines(reds, w, h, skip) : [], byP = byPrintedLines(gray, w, h, skip);
      if (trace) Object.assign(trace, { byFiveLines: by5.length, byPrintedLines: byP.length });
      if (by5.length || byP.length) return byP.length > by5.length ? byP : by5;
    }
    if (ruled && tint) {
      const byR = byRuling(gray, tint, w, h, skip);
      if (trace) trace.byRuling = byR.length;
      if (byR.length) return byR;
    }
    return byInk(gray, w, h, skip, lines, trace);
  }
  function byInk(gray, w, h, skip, lines, trace) {
    const cols = columns(gray, w, h);
    if (trace) Object.assign(trace, { columns: cols, each: cols.map(() => ({})) });
    const found = cols.map((c, k) => findIn(gray, w, h, c, skip, trace && trace.each[k]));
    if (lines) {
      const red = cols.map((c, k) => findIn(lines, w, h, c, skip, trace && (trace.each[k].red = {}), true));
      const n = a => a.reduce((t, c) => t + c.length, 0);
      if (n(red) && n(red) >= n(found) / 2) return red.flat();
      // (or only the F line red, the others scored or barely inked, as German and Cistercian books rule them: each
      // staff found by its red line, when that finds more)
      const byF = byRedLine(gray, lines, w, h, skip);
      if (trace) trace.byRedLine = byF.length;
      if (byF.length > n(found)) return byF;
    }
    return found.flat();
  }

  // do two staves (their lines) overlap, along the page and down it (where both run, top line above the other's bottom)
  function overlaps(a, b) {
    const ax0 = a[0][0], ax1 = a[0][a[0].length - 2], bx0 = b[0][0], bx1 = b[0][b[0].length - 2];
    if (ax0 >= bx1 || ax1 <= bx0) return false;
    const x = (Math.max(ax0, bx0) + Math.min(ax1, bx1)) / 2, n = a.length - 1, m = b.length - 1;
    return yAt(a[0], x) < yAt(b[m], x) && yAt(a[n], x) > yAt(b[0], x);
  }

  // The fives found strip by strip ([{ c, rows, g }]) followed across the page into staves: each joined to the staff
  // whose top line, carried on as its last strips lean (a staff that curves goes on curving), comes within half a space
  // of its own; strips at most four apart. The same staff found twice in one strip, a row apart: once is enough.
  function follow(found, STRIP) {
    const chains = [];
    const ahead = (ch, c) => {
      const l = ch[ch.length - 1];
      if (ch.length < 2) return l.rows[0];
      const q = ch[Math.max(0, ch.length - 3)];
      return l.rows[0] + (l.rows[0] - q.rows[0]) / ((l.c - q.c) || 1) * (c - l.c);
    };
    for (const f of found.slice().sort((a, b) => a.c - b.c)) {
      let best = null, bestD = Infinity;
      for (const ch of chains) {
        const l = ch[ch.length - 1], d = Math.abs(f.rows[0] - ahead(ch, f.c));
        if (l.c <= f.c && f.c - l.c <= 4 * STRIP && d < 0.5 * f.g && d < bestD) { best = ch; bestD = d; }
      }
      if (best) { if (best[best.length - 1].c < f.c) best.push(f); } else chains.push([f]);
    }
    return chains;
  }

  // A staff of five lines from the strips its lines were found in ([{ c (the strip's middle), rows: five, g }], along the
  // page): followed as it runs, straight or not (a page's curve to the gutter, a hand's wandering ruling): a strip off
  // the run of those about it (more than a third of a space from their median: another five rows taken) left out; each
  // line through the strips' rows, each row the median of its strip and the two beside it; run on from the first and
  // last strips to xa and xb as the end strips lean; the bends that make no difference (a fifth of a space) taken
  // away, so a straight staff has its two ends only. null if too few strips are left (fewer than three, or spanning less
  // than minSpan).
  function chainLines(ch, g, xa, xb, minSpan = 0) {
    const median = a => a.slice().sort((x, y) => x - y)[a.length >> 1], mean = f => f.rows.reduce((a, b) => a + b) / f.rows.length;
    const kept = ch.filter((f, j) => {
      // (where the strips about it would put it: a line through them, least squares)
      const near = ch.slice(Math.max(0, j - 2), j + 3).filter(o => o !== f);
      if (near.length < 2) return true;
      const n = near.length, mx = near.reduce((t, o) => t + o.c, 0) / n, my = near.reduce((t, o) => t + mean(o), 0) / n;
      let sxy = 0, sxx = 0;
      for (const o of near) { sxy += (o.c - mx) * (mean(o) - my); sxx += (o.c - mx) ** 2; }
      const at = my + (sxx ? sxy / sxx : 0) * (f.c - mx);
      return Math.abs(mean(f) - at) < 0.35 * g;
    });
    if (kept.length < 3 || kept[kept.length - 1].c - kept[0].c < minSpan) return null;
    const n = kept[0].rows.length, sm = k => kept.map((f, j) => median(kept.slice(Math.max(0, j - 1), j + 2).map(o => o.rows[k])));
    const lines = [];
    for (let k = 0; k < n; k++) {
      const ys = sm(k), cs = kept.map(f => f.c);
      // (run on at each end as the end strips lean: a curve continues as it goes)
      const lean = (i, j) => (ys[j] - ys[i]) / ((cs[j] - cs[i]) || 1);
      const y0 = ys[0] + lean(0, Math.min(2, ys.length - 1)) * (xa - cs[0]), y1 = ys[ys.length - 1] + lean(Math.max(0, ys.length - 3), ys.length - 1) * (xb - cs[cs.length - 1]);
      const l = [xa, y0];
      cs.forEach((c, i) => { if (c > xa && c < xb) l.push(c, ys[i]); });
      l.push(xb, y1);
      lines.push(l);
    }
    return simplify(lines, 0.2 * g).map(l => l.map(v => Math.round(v * 10) / 10));
  }

  // Staves of five lines ruled in red (the great choirbooks of Spain, Italy and the Americas, 16th-18th centuries): in
  // each strip across the page, the rows redder than those about them, five at a time where five stand evenly spaced;
  // followed from strip to strip, and each staff a straight line through its strips (a ruled staff is straight), the
  // strips far off it, which took another five rows, left out. As training/fivestaves.py, which cut the Mexican
  // choirbook's staves (Stanford, Codex 0734). red: ruling()'s map (255 where there is no red).
  function byFiveLines(red, w, h, skip = []) {
    // (red: redness(), how red each pixel is)
    const rd = o => red[o];
    const STRIP = Math.max(20, Math.round(120 * w / 1800)), lo = 0.008 * h, hi = 0.03 * h;
    // the columns with red ruling
    const colRed = new Float64Array(w);
    for (let y = 0; y < h; y += 3) for (let x = 0, o = y * w; x < w; x++, o++) colRed[x] += rd(o);
    const sorted = Array.from(colRed).sort((a, b) => a - b), cut = sorted[Math.floor(0.7 * (w - 1))];
    let x0 = -1, x1 = -1;
    for (let x = 0; x < w; x++) if (colRed[x] > cut) { if (x0 < 0) x0 = x; x1 = x; }
    if (x0 < 0 || x1 - x0 < 50) return [];
    const found = [];
    for (let x = x0; x < x1 - STRIP / 2; x += STRIP) {
      const xe = Math.min(w, x + STRIP), col = new Float64Array(xe - x), prof = new Float64Array(h);
      for (let y = 0; y < h; y++) { for (let i = x, o = y * w + x; i < xe; i++, o++) col[i - x] = rd(o); col.sort(); prof[y] = col[col.length >> 1]; }
      const sm = prof.map((v, y) => (prof[Math.max(0, y - 1)] + v + prof[Math.min(h - 1, y + 1)]) / 3);
      const thr = 0.6 * Array.from(sm).sort((a, b) => a - b)[Math.floor(0.9 * (h - 1))] + 1e-6, apart = Math.max(2, Math.round(lo / 2));
      const pk = [];
      for (let y = 1; y < h - 1; y++) {
        if (sm[y] < thr) continue;
        let top = true;
        for (let d = -apart; d <= apart && top; d++) if (y + d >= 0 && y + d < h && sm[y + d] > sm[y]) top = false;
        if (top) pk.push(y);
      }
      // five rows evenly spaced
      const used = new Set();
      for (let i = 0; i < pk.length; i++) {
        if (used.has(pk[i])) continue;
        for (let j = i + 1; j < pk.length; j++) {
          const g = pk[j] - pk[i];
          if (g < lo) continue;
          if (g > hi) break;
          const run = [pk[i], pk[j]];
          for (let k = 0; k < 3; k++) {
            const want = run[run.length - 1] + g;
            let best = null;
            for (const y of pk) if (Math.abs(y - want) <= 0.2 * g && (best === null || Math.abs(y - want) < Math.abs(best - want))) best = y;
            if (best === null) break;
            run.push(best);
          }
          if (run.length === 5) {
            const gaps = run.slice(1).map((y, k) => y - run[k]), mean = gaps.reduce((a, b) => a + b) / 4;
            if (Math.max(...gaps) - Math.min(...gaps) <= 0.25 * mean) { found.push({ c: x + STRIP / 2, rows: run, g: mean }); run.forEach(y => used.add(y)); break; }
          }
        }
      }
    }
    // followed across the page: strips whose top lines agree within half a space
    const chains = follow(found, STRIP);
    const median = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
    const out = [];
    for (const ch of chains) {
      if (ch.length < 3) continue;
      const g = median(ch.map(f => f.g));
      const lines5 = chainLines(ch, g, ch[0].c - STRIP / 2, ch[ch.length - 1].c + STRIP / 2, 0.2 * (x1 - x0));
      if (!lines5) continue;
      const xa = lines5[0][0], xb = lines5[0][lines5[0].length - 2];
      const midY = (yAt(lines5[0], (xa + xb) / 2) + yAt(lines5[4], (xa + xb) / 2)) / 2, midX = (xa + xb) / 2;
      if (skip.some(b => midY > b[1] && midY < b[1] + b[3] && midX > b[0] && midX < b[0] + b[2])) continue;
      out.push({ lines: lines5, spacing: g });
    }
    // (one staff found twice, in pieces, or five rows taken across two staves: of staves that overlap, the longer)
    const len = st => st.lines[0][st.lines[0].length - 2] - st.lines[0][0], kept = [];
    for (const st of out.sort((a, b) => len(b) - len(a))) {
      const clash = kept.some(k => overlaps(st.lines, k.lines));
      if (!clash) kept.push(st);
    }
    return kept.sort((a, b) => yAt(a.lines[0], a.lines[0][0]) - yAt(b.lines[0], b.lines[0][0]));
  }

  // Staves of a printed book of polyphony (partbooks and choirbooks set from movable type: Gardano, Scotto, Baldini),
  // found by their black lines. Each line is set from short pieces of type, one to a note, butted end to end: a broken
  // line, a hair out of true. The page's dark pixels (Otsu's threshold; a negative turned round); of them, those in
  // long horizontal runs, the gaps between pieces of type bridged (the lines: a note's head or a letter is short); in
  // strips across the page, the rows those runs crowd, five at a time where five stand evenly spaced at the page's own
  // spacing (measured from the gaps between such rows) and thin (little between them: not a scan's black edge, not a
  // woodcut); followed from strip to strip, fitted straight, and their ends followed out along the lines (the clef,
  // the last notes); a staff with nothing on it (the ruled staves at a page's foot) left out. As
  // training/printstaves.py, which found Il Lauro Secco's (SEILS) staves: 128 of 145 pages as the edition counts them.
  function byPrintedLines(gray, w, h, skip = []) {
    const N = w * h, u = w / 1200;
    // the threshold (Otsu's), a negative turned round
    const hist = new Float64Array(256);
    for (let i = 0; i < N; i++) hist[Math.max(0, Math.min(255, gray[i] | 0))]++;
    let acc = 0, med = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= N / 2) { med = v; break; } }
    const neg = med < 100, g8 = i => neg ? 255 - gray[i] : gray[i];
    if (neg) hist.reverse();
    let wB = 0, mB = 0, mT = 0, best = -1, thr = 128;
    for (let v = 0; v < 256; v++) mT += v * hist[v];
    for (let v = 0; v < 256; v++) { wB += hist[v]; mB += v * hist[v]; if (!wB || wB === N) continue; const a = mB / wB, b = (mT - mB) / (N - wB), s = wB * (N - wB) * (a - b) ** 2; if (s > best) { best = s; thr = v; } }
    let pc = 0, paper = 255;
    for (let v = 0; v < 256; v++) { pc += hist[v]; if (pc >= 0.9 * N) { paper = v; break; } }
    const lineThr = (thr + paper) / 2;                         // (lines: faint ones too, halfway to the paper)
    const dark = new Uint8Array(N), black = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const v = g8(i); dark[i] = v < lineThr ? 1 : 0; black[i] = v < 0.7 * thr ? 1 : 0; }
    // the lines: dark runs at least minRun long, gaps of up to gap pixels bridged
    const gap = Math.max(4, Math.round(4 * u)), minRun = Math.max(12, Math.round(24 * u)), mask = new Uint8Array(N);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let start = -1, last = -1;
      for (let x = 0; x <= w; x++) {
        const on = x < w && dark[o + x];
        if (on) { if (start < 0) start = x; else if (x - last - 1 > gap) { if (last - start + 1 >= minRun) mask.fill(1, o + start, o + last + 1); start = x; } last = x; }
        if (x === w && start >= 0 && last - start + 1 >= minRun) mask.fill(1, o + start, o + last + 1);
      }
    }
    // the page's spacing: the commonest gap between neighbouring thin rows crowded with lines, strip by strip
    const STRIP = Math.max(20, Math.round(30 * u)), counts = new Map(), thin = Math.max(4, Math.round(4 * u));
    const profOf = x => { const xe = Math.min(w, x + STRIP), p = new Float64Array(h); for (let y = 0; y < h; y++) { let c = 0; for (let i = y * w + x, e = y * w + xe; i < e; i++) c += mask[i]; p[y] = c / (xe - x); } return p; };
    const profs = [];
    for (let x = 0; x < w - STRIP / 2; x += STRIP) {
      const p = profOf(x); profs.push({ x, p });
      const cs = [];
      for (let y = 0; y < h;) { if (p[y] > 0.4) { let e = y; while (e < h && p[e] > 0.4) e++; if (e - y <= thin) cs.push((y + e - 1) / 2); y = e; } else y++; }
      for (let k = 1; k < cs.length; k++) { const d = Math.round(cs[k] - cs[k - 1]); if (d >= Math.max(4, 4 * u) && d <= h / 25) counts.set(d, (counts.get(d) || 0) + 1); }
    }
    if (!counts.size) return [];
    const top = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    let sw = 0, sv = 0;
    for (const d of [top - 1, top, top + 1]) { const c = counts.get(d) || 0; sw += c; sv += c * d; }
    const G = sv / sw, lo = 0.82 * G, hi = 1.22 * G;
    // in each strip: rows crowded with lines, five evenly spaced, thin
    const found = [];
    for (const { x, p: raw } of profs) {
      const p = raw.map((v, y) => 0.25 * raw[Math.max(0, y - 1)] + 0.5 * v + 0.25 * raw[Math.min(h - 1, y + 1)]);
      const srt = Array.from(p).sort((a, b) => a - b), cut = Math.max(0.3, 0.6 * srt[Math.floor(0.9 * (h - 1))]), apart = Math.max(2, Math.floor(G / 3));
      const pk = [];
      for (let y = 1; y < h - 1; y++) {
        if (p[y] < cut) continue;
        let isTop = true;
        for (let d = -apart; d <= apart && isTop; d++) if (y + d >= 0 && y + d < h && p[y + d] > p[y]) isTop = false;
        if (isTop) pk.push(y);
      }
      const used = new Set();
      for (let i = 0; i < pk.length; i++) {
        if (used.has(pk[i])) continue;
        for (let j = i + 1; j < pk.length; j++) {
          const g = pk[j] - pk[i];
          if (g < lo) continue;
          if (g > hi) break;
          const run = [pk[i], pk[j]];
          for (let k = 0; k < 3; k++) {
            const want = run[run.length - 1] + g;
            let b = null;
            for (const y of pk) if (Math.abs(y - want) <= 0.2 * g && (b === null || Math.abs(y - want) < Math.abs(b - want))) b = y;
            if (b === null) break;
            run.push(b);
          }
          if (run.length !== 5) continue;
          const gaps = run.slice(1).map((y, k) => y - run[k]), mean = gaps.reduce((a, c) => a + c) / 4;
          if (Math.max(...gaps) - Math.min(...gaps) > 0.25 * mean) continue;
          const between = gaps.map((d, k) => p[Math.round(run[k] + d / 2)]).reduce((a, c) => a + c) / 4, on = run.reduce((a, y) => a + p[y], 0) / 5;
          if (between > 0.35 * on) continue;
          found.push({ c: x + STRIP / 2, rows: run, g: mean }); run.forEach(y => used.add(y)); break;
        }
      }
    }
    if (!found.length) return [];
    const x0 = Math.min(...found.map(f => f.c)) - STRIP / 2, x1 = Math.max(...found.map(f => f.c)) + STRIP / 2;
    const chains = follow(found, STRIP);
    const median = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
    const out = [];
    for (const ch of chains) {
      if (ch.length < 3) continue;
      const g = median(ch.map(f => f.g));
      const curve = chainLines(ch, g, ch[0].c - STRIP / 2, ch[ch.length - 1].c + STRIP / 2, 0.2 * (x1 - x0));
      if (!curve) continue;
      // its ends followed out along its lines (beyond them, as the end segment leans), a gap of up to two spaces
      // bridged; not into a scan's black edge
      const along = (l, x) => { const c = count(l); const k = x < l[0] ? 0 : x > l[2 * c - 2] ? c - 2 : -1; if (k < 0) return yAt(l, x); const xa0 = l[2 * k], ya0 = l[2 * k + 1], xb0 = l[2 * k + 2], yb0 = l[2 * k + 3]; return ya0 + (yb0 - ya0) * (x - xa0) / ((xb0 - xa0) || 1); };
      const yAtK = (k, x) => along(curve[k], x);
      const there = x => {
        if (x < 0 || x >= w) return false;
        let n = 0, between = 0;
        for (let k = 0; k < 5; k++) {
          const y = Math.round(yAtK(k, x));
          if ([-1, 0, 1].some(d => y + d >= 0 && y + d < h && mask[(y + d) * w + x])) n++;
          if (k < 4) { const ym = Math.round((yAtK(k, x) + yAtK(k + 1, x)) / 2); if (ym >= 0 && ym < h && mask[ym * w + x]) between++; }
        }
        return n >= 4 && between <= 1;
      };
      const reach = (from, step) => { let x = from, last = from; while (x >= 0 && x < w && Math.abs(x - last) <= 2 * g) { if (there(x)) last = x; x += step; } return last; };
      const xa = reach(Math.round(curve[0][0]), -1), xb = reach(Math.round(curve[0][curve[0].length - 2]), 1);
      // (its ends moved out to where its lines were followed to; its bends kept)
      const lines5 = curve.map(l => { const inner = []; for (let i = 2; i < l.length - 2; i += 2) if (l[i] > xa && l[i] < xb) inner.push(l[i], l[i + 1]); return [xa, Math.round(along(l, xa) * 10) / 10, ...inner, xb, Math.round(along(l, xb) * 10) / 10]; });
      const midX = (xa + xb) / 2, midY = (yAt(lines5[0], midX) + yAt(lines5[4], midX)) / 2;
      if (skip.some(b0 => midY > b0[1] && midY < b0[1] + b0[3] && midX > b0[0] && midX < b0[0] + b0[2])) continue;
      // its ink: in its inkiest stretch (eight spaces long, past its start), the black pixels between and about its
      // lines that aren't its lines
      const ys0 = lines5[0].filter((v, i) => i & 1), ys4 = lines5[4].filter((v, i) => i & 1);
      const ya = Math.max(0, Math.round(Math.min(...ys0) - 0.5 * g)), yb = Math.min(h, Math.round(Math.max(...ys4) + 0.5 * g));
      const from = Math.max(0, Math.round(xa + 3 * g)), to = Math.min(w, Math.round(xb)), col = [];
      for (let x = from; x < to; x++) { let c = 0; for (let y = ya; y < yb; y++) { const i = y * w + x; if (black[i] && !mask[i]) c++; } col.push(c / Math.max(1, yb - ya)); }
      const win = Math.max(1, Math.round(8 * g));
      let ink = 0, t = 0;
      for (let k = 0; k < col.length; k++) { t += col[k]; if (k >= win) t -= col[k - win]; if (k >= win - 1) ink = Math.max(ink, t / win); }
      if (col.length < win) ink = col.reduce((a, c) => a + c, 0) / Math.max(1, col.length);
      out.push({ lines: lines5, spacing: g, ink });
    }
    const len = st => st.lines[0][st.lines[0].length - 2] - st.lines[0][0], kept = [];
    for (const st of out.sort((a, b) => len(b) - len(a))) {
      if (!kept.some(k => overlaps(st.lines, k.lines))) kept.push(st);
    }
    const usual = kept.length ? median(kept.map(st => st.ink)) : 0;
    return kept.filter(st => st.ink > Math.max(0.012, 0.5 * usual)).map(st => ({ lines: st.lines, spacing: st.spacing })).sort((a, b) => a.lines[0][1] - b.lines[0][1]);
  }

  // Staves of a page ruled evenly in pale red-brown from top to bottom, the words written on every fifth ruled line
  // and the notes on the four between (Paris, BnF lat. 12044): the dark ink makes no staff lines to find. The rows of
  // words found by their ink, and how far apart they are (five spaces) gives the spacing near enough; the ruling
  // itself then found by its colour (redder than ink and paper: red less blue), strip by strip across the page, the
  // lines evenly spaced in each, followed from strip to strip; over each row of words, the four ruled lines above
  // the one it is written on. As training/rulestaves.py, which cut Paris's staves.
  function byRuling(gray, tint, w, h, skip = []) {
    const u = w / 1800, sample = [];
    for (let i = 0; i < gray.length; i += 97) sample.push(gray[i]);
    sample.sort((a, b) => a - b);
    const paper = sample[Math.floor(sample.length * 0.8)], inkAt = i => paper - gray[i] > 60;
    const smooth = (v, k) => { const o = new Float64Array(v.length), r = k >> 1; let t = 0;
      for (let i = 0; i < v.length + r; i++) { if (i < v.length) t += v[i]; if (i - k >= 0) t -= v[i - k]; const c = i - r; if (c >= 0 && c < v.length) o[c] = t / k; } return o; };
    const median = a => { const b = Float64Array.from(a).sort(); return b.length ? b[b.length >> 1] : 0; };
    // the written block: the columns with ink
    const colInk = new Float64Array(w);
    for (let y = 0; y < h; y += 2) for (let x = 0, o = y * w; x < w; x++, o++) if (inkAt(o)) colInk[x]++;
    const cs = smooth(colInk.map(v => v / (h / 2)), Math.max(3, Math.round(31 * u)) | 1);
    let bx0 = -1, bx1 = -1;
    for (let x = 0; x < w; x++) if (cs[x] > 0.01) { if (bx0 < 0) bx0 = x; bx1 = x; }
    if (bx0 < 0 || bx1 - bx0 < 100 * u) return [];
    // the rows of words: bands where dark ink covers much of the row, in the middle of the block; each written on a
    // ruled line near its foot
    const xa = Math.round(bx0 + 0.15 * (bx1 - bx0)), xb = Math.round(bx1 - 0.15 * (bx1 - bx0));
    const cover = new Float64Array(h);
    for (let y = 0; y < h; y++) { let c = 0; for (let x = xa, o = y * w + xa; x < xb; x++, o++) if (inkAt(o)) c++; cover[y] = c / (xb - xa); }
    const sm = smooth(cover, Math.max(3, Math.round(9 * u)) | 1), sorted = Array.from(sm).sort((a, b) => a - b);
    const on = Math.max(0.05, 0.35 * sorted[Math.floor(0.99 * (h - 1))]), minRun = Math.max(3, Math.round(8 * u));
    const mids = [], feet = [];
    for (let y = 0; y < h;) { if (sm[y] > on) { let e = y; while (e < h && sm[e] > on) e++; if (e - y >= minRun) { mids.push((y + e) / 2); feet.push(e); } y = e; } else y++; }
    const gaps = mids.slice(1).map((r, i) => r - mids[i]).filter(d => d >= 5 * 22 * u && d <= 5 * 52 * u).sort((a, b) => a - b);
    if (gaps.length < 2) return [];
    const g0 = gaps[gaps.length >> 1] / 5;
    // the ruling in each strip (each row's median redness, less its surroundings), its lines evenly spaced there:
    // for the ruling's slope across the page
    const STRIP = Math.round(150 * u), xs = [];
    for (let x = bx0; x < bx1 - STRIP / 2; x += STRIP) xs.push(x);
    const profs = xs.map(x => { const x1 = Math.min(w, x + STRIP), v = new Float64Array(h), col = new Float64Array(x1 - x);
      for (let y = 0; y < h; y++) { for (let i = x, o = y * w + x; i < x1; i++, o++) col[i - x] = tint[o]; col.sort(); v[y] = col[col.length >> 1]; }
      const m = smooth(v, Math.max(5, Math.round(21 * u)) | 1); return v.map((a, i) => a - m[i]); });
    const at = (p, y) => { const i = Math.floor(y), f = y - i; return i >= 0 && i + 1 < p.length ? p[i] * (1 - f) + p[i + 1] * f : 0; };
    const score = (p, ph, g) => { let t = 0, n = 0; for (let y = ph; y < h - 1; y += g) { t += at(p, y); n++; } return t / n; };
    const gs = profs.map(p => { let best = -Infinity, bg = g0; for (let g = 0.9 * g0; g < 1.1 * g0; g += 0.25) for (let ph = 0; ph < g; ph++) { const s = score(p, ph, g); if (s > best) { best = s; bg = g; } } return bg; });
    const g = median(gs);
    const phases = profs.map(p => { let best = -Infinity, bp = 0; for (let ph = 0; ph < g; ph += 0.5) { const s = score(p, ph, g); if (s > best) { best = s; bp = ph; } } return bp; });
    const un = [phases[0]];
    for (const p of phases.slice(1)) un.push(p + g * Math.round((un[un.length - 1] - p) / g));
    const centres = xs.map(x => x + STRIP / 2);
    // (straight, ruled with a rule: a line through the strips' fits, a strip far off it left out)
    let slope = 0;
    if (centres.length >= 3) {
      const fitOf = idx => { const n = idx.length, mx = idx.reduce((t, i) => t + centres[i], 0) / n, my = idx.reduce((t, i) => t + un[i], 0) / n;
        let sxy = 0, sxx = 0; for (const i of idx) { sxy += (centres[i] - mx) * (un[i] - my); sxx += (centres[i] - mx) ** 2; }
        const b = sxx ? sxy / sxx : 0; return { b, f: x => my + b * (x - mx) }; };
      let fit = fitOf(centres.map((c, i) => i));
      const near = centres.map((c, i) => i).filter(i => Math.abs(un[i] - fit.f(centres[i])) < 0.25 * g);
      if (near.length >= 2) fit = fitOf(near);
      slope = fit.b;
    }
    // a line moved onto the ruling near where it is put: the redness along it (at the ruling's slope, across the
    // block) against a third of a space either side, at offsets up to reach
    const sa = Math.round(bx0 + 0.1 * (bx1 - bx0)), sb = Math.round(bx1 - 0.1 * (bx1 - bx0)), xm = (sa + sb) / 2;
    const along = y0 => { const v = []; for (let x = sa; x < sb; x += 3) { const y = Math.round(y0 + slope * (x - xm)); if (y >= 0 && y < h) v.push(tint[y * w + x]); } return median(v); };
    const snap = (y, reach) => { let best = -Infinity, bd = 0;
      for (let d = -reach; d <= reach; d += 0.5) { const v = along(y + d) - 0.5 * (along(y + d - g / 3) + along(y + d + g / 3)); if (v > best) { best = v; bd = d; } }
      return bd; };
    // the staff over each row of words: the four ruled lines between its foot and the foot of the row above, at
    // fifths of the way (the ruling is spaced by hand, not evenly down the page), each moved onto the ruling unless
    // that would leave it far from its fellows' spacing; the first row's a usual staff's height above it
    const diffs = feet.slice(1).map((f, i) => f - feet[i]).filter(d => d > 4 * g && d < 7 * g);
    const period = diffs.length ? median(diffs) : 5 * g, out = [];
    feet.forEach((f, n) => {
      const above = n && f - feet[n - 1] > 4 * g && f - feet[n - 1] < 7 * g ? feet[n - 1] : f - period, q = (f - above) / 5;
      const ys = [1, 2, 3, 4].map(i => above + i * q), moved = ys.map(y => y + snap(y, 0.22 * q));
      for (let i = 0; i < 4; i++) {
        const prev = i ? moved[i - 1] : above, next = i < 3 ? moved[i + 1] : f;
        if (!(moved[i] - prev > 0.7 * q && moved[i] - prev < 1.3 * q && next - moved[i] > 0.7 * q && next - moved[i] < 1.3 * q)) moved[i] = ys[i];
      }
      if (moved[0] < 0) return;
      const lines4 = moved.map(y => centres.flatMap(c => [c, y + slope * (c - xm)]));
      const midY = (moved[0] + moved[3]) / 2;
      if (skip.some(b => midY > b[1] && midY < b[1] + b[3] && xm > b[0] && xm < b[0] + b[2])) return;
      out.push({ lines: lines4, spacing: (moved[3] - moved[0]) / 3 });
    });
    return out;
  }

  // Staves found by their red F line alone (Köln, Dombibliothek, Cod. 1161 and its like: the F line red, one other
  // inked, two only scored): long thin runs of red ink traced across the page (red initials are short and thick; a
  // page ruled all in red is found by findIn on its red ink, before this is tried); the spacing from the inked line
  // nearest it (the sharpest thin row of ink a space away); the words are written just under every staff, so its
  // lowest line is the last of the red line's, at whole spaces from it, above them. A first guess, to be corrected by
  // hand where it is wrong (Space evenly, the lines dragged). As training/redstaves.py, which cut Köln's staves.
  function byRedLine(gray, red, w, h, skip = []) {
    const S = Math.max(12, Math.round(w / 45)), thin = Math.max(4, Math.round(w / 300));
    const segs = [];
    for (let x = 0; x + S <= w; x += S) {
      const at = [];
      let run = 0;
      for (let y = 0; y <= h; y++) {
        let on = false;
        if (y < h) { let c = 0; for (let i = x, o = y * w + x; i < x + S; i++, o++) if (red[o] < 255) c++; on = c > 0.35 * S; }
        if (on) run++;
        else { if (run && run <= thin) at.push(y - run / 2 - 0.5); run = 0; }
      }
      segs.push(at.map(y => [x + S / 2, y]));
    }
    let ls = [];
    for (const at of segs) for (const [x, y] of at) {
      let best = null;
      for (const l of ls) {
        const [lx, ly] = l[l.length - 1], dx = x - lx;
        if (dx > 0 && dx <= 8 * S && Math.abs(y - ly) < 4 + dx / S && (!best || Math.abs(y - ly) < Math.abs(y - best[best.length - 1][1]))) best = l;
      }
      if (best) best.push([x, y]); else ls.push([[x, y]]);
    }
    ls = ls.filter(l => l[l.length - 1][0] - l[0][0] > 0.25 * w && l.length >= 5);
    // the paper and the ink
    const sample = [];
    for (let i = 0; i < gray.length; i += 97) sample.push(gray[i]);
    sample.sort((a, b) => a - b);
    const paper = sample[Math.floor(sample.length * 0.75)], dark = i => Math.max(0, paper - gray[i]);
    const cut = 0.5 * (paper - sample[Math.floor(sample.length * 0.03)]);
    const R = Math.round(0.05 * w), gLo = 0.0067 * w, gHi = 0.0167 * w;
    const out = [];
    for (const l of ls) {
      const prof = new Float64Array(2 * R + 1), cover = new Float64Array(2 * R + 1);
      for (const [x, y] of l) for (let d = -R; d <= R; d++) {
        const yy = Math.round(y + d);
        if (yy < 0 || yy >= h) continue;
        let s = 0, c = 0;
        for (let i = Math.max(0, Math.round(x - S / 2)); i < Math.min(w, Math.round(x + S / 2)); i++) { const v = dark(yy * w + i); s += v; if (v > cut) c++; }
        prof[d + R] += s / S; cover[d + R] += c / S;
      }
      // the spacing: the sharpest thin row of ink a space from the red line
      const sharp = prof.map((v, i) => { let m = 0, k = 0; for (let j = Math.max(0, i - 4); j <= Math.min(2 * R, i + 4); j++) { m += prof[j]; k++; } return v - m / k; });
      let kb = -1;
      for (let i = 0; i <= 2 * R; i++) { const d = Math.abs(i - R); if (d >= gLo && d <= gHi && (kb < 0 || sharp[i] > sharp[kb])) kb = i; }
      if (kb < 0 || sharp[kb] * l.length <= 2 * l.length) continue;
      const g = Math.abs(kb - R);
      // the words: the first rows below it, a few on end, covered by ink as writing covers a row
      let top = 0; for (let i = R + 1; i <= 2 * R; i++) top = Math.max(top, cover[i]);
      let words = -1;
      for (let i = R; i <= 2 * R - 6 && words < 0; i++) { let ok = true; for (let d = 0; d < 6; d++) if (!(cover[i + d] > 0.6 * top)) { ok = false; break; } if (ok) words = i - R; }
      if (words < 0) continue;
      const j = Math.max(0, Math.min(3, Math.floor((words - 0.4 * g) / g)));
      if (j * g > words) continue;
      // the four lines along the red one's course (its points, every few strips)
      const pts = l.filter((p, i) => i % 3 === 0 || i === l.length - 1);
      const lines4 = [-3, -2, -1, 0].map(k => pts.flatMap(([x, y]) => [x, y + (j + k) * g]));
      const midY = (lines4[0][1] + lines4[3][1]) / 2, midX = (pts[0][0] + pts[pts.length - 1][0]) / 2;
      if (skip.some(b => midY > b[1] && midY < b[1] + b[3] && midX > b[0] && midX < b[0] + b[2])) continue;
      out.push({ lines: lines4, spacing: g });
    }
    // (a staff with next to no notes on it: a red line in a margin, or under ruling left empty)
    const inkOn = st => { let t = 0; const top = st.lines[0], bot = st.lines[3];
      for (let i = 0; i < top.length; i += 2) { const x = Math.round(top[i]), a = Math.max(0, Math.round(top[i + 1])), b = Math.min(h - 1, Math.round(bot[i + 1]));
        for (let y = a; y < b; y++) for (let xx = Math.max(0, x - (S >> 1)); xx < Math.min(w, x + (S >> 1)); xx++) t += dark(y * w + xx); }
      return t; };
    const inks = out.map(inkOn), mid = inks.slice().sort((a, b) => a - b)[inks.length >> 1];
    for (let i = out.length - 1; i >= 0; i--) if (inks[i] <= 0.25 * mid) out.splice(i, 1);
    // (one staff found twice, from two red lines in it or one in pieces: the longer kept)
    const len = s => s.lines[0][s.lines[0].length - 2] - s.lines[0][0];
    const kept = [];
    for (const s of out.sort((a, b) => len(b) - len(a))) {
      const clash = kept.some(k => { const a = Math.max(s.lines[0][0], k.lines[0][0]), b = Math.min(s.lines[0][s.lines[0].length - 2], k.lines[0][k.lines[0].length - 2]), x = b > a ? (a + b) / 2 : (s.lines[0][0] + s.lines[0][s.lines[0].length - 2]) / 2;
        return yAt(s.lines[0], x) < yAt(k.lines[3], x) + 0.5 * s.spacing && yAt(s.lines[3], x) > yAt(k.lines[0], x) - 0.5 * s.spacing; });
      if (!clash) kept.push(s);
    }
    return kept.sort((a, b) => (a.lines[0][0] > 0.55 * w) - (b.lines[0][0] > 0.55 * w) || a.lines[0][1] - b.lines[0][1]);
  }
  function findIn(gray, w, h, [xa, xb, ia = xa, ib = xb], skip, trace, loose = false) {
    // (the band within where the column's writing runs; narrower in a map of hand ruling: each staff was ruled at its
    // own tilt, and a wide band at any one tilt smears some of their lines in two)
    const cw = xb - xa, iw = ib - ia, bx0 = Math.round(ia + (loose ? 0.35 : 0.25) * iw), bx1 = Math.round(ia + (loose ? 0.52 : 0.62) * iw);
    // (in a map of the ruling, a column with only a staff or two has little ink)
    const dm = darkness(gray, w, bx0, 0, bx1, h, loose ? 0.001 : 0.01);
    if (!dm) return [];
    const { dark, W, H } = dm;
    const noise = Math.max(1, (dm.level(0.75) - dm.paper) / 0.674) * Math.sqrt(W);
    const xc = (W - 1) / 2, pad = Math.ceil(0.06 * W) + 2, n = H + 2 * pad;
    const profile = slope => {
      const p = new Float64Array(n);
      for (let x = 0; x < W; x++) {
        const shift = pad - Math.round(slope * (x - xc));
        for (let y = 0; y < H; y++) p[y + shift] += dark[y * W + x];
      }
      return p;
    };
    let best = null;
    const tryS = sl => { const p = profile(sl); let sc = 0; for (let r = 0; r < n; r++) if (p[r] > 0) sc += p[r] * p[r]; if (!best || sc > best.sc) best = { sl, p, sc }; };
    for (let k = -50; k <= 50; k += 5) tryS(k / 1000);
    const coarse = best.sl;
    for (let k = -4; k <= 4; k++) if (k) tryS(coarse + k / 1600);
    const { p, sl: slope } = best;
    // the lines: rows darker than those about them by much more than the paper's noise could make them
    let max = 0;
    for (let r = 0; r < n; r++) max = Math.max(max, p[r]);
    const peaks = [];
    for (let r = 1; r < n - 1; r++) {
      if (!(p[r] >= p[r - 1] && p[r] > p[r + 1])) continue;
      let base = Infinity;
      for (let j = Math.max(0, r - 4); j <= Math.min(n - 1, r + 4); j++) base = Math.min(base, p[j]);
      const rise = p[r] - base;
      if (rise < 8 * noise || rise < 0.08 * max) continue;
      let sum = 0, at = 0;
      for (let j = r - 1; j <= r + 1; j++) { const v = Math.max(0, p[j] - base); sum += v; at += v * j; }
      peaks.push({ y: at / sum - pad, strength: sum });
    }
    // (and in such a map a line still smeared in two, twin peaks closer than a fifth of the usual gap, made one)
    if (loose && peaks.length > 2) {
      const gaps = peaks.slice(1).map((v, i) => v.y - peaks[i].y).sort((a, b) => a - b), usual = gaps[gaps.length >> 1];
      for (let i = peaks.length - 1; i > 0; i--) if (peaks[i].y - peaks[i - 1].y < 0.2 * usual) {
        const a = peaks[i - 1], b = peaks[i], t = a.strength + b.strength;
        peaks.splice(i - 1, 2, { y: (a.y * a.strength + b.y * b.strength) / t, strength: t });
      }
    }
    // fours evenly spaced: from each line, the next three at the spacing set so far (each within a quarter of it)
    const cands = [];
    for (let i = 0; i < peaks.length; i++) for (let k = i + 1; k <= i + 4 && k < peaks.length; k++) {
      const g = peaks[k].y - peaks[i].y;
      if (g < 3) continue;
      const q = [peaks[i], peaks[k]];
      // (in a map of the ruling alone, the next three lines whatever their spaces, within reason: nothing but staff
      // lines is there, and a hand-ruled staff's spaces can differ by half)
      if (loose) {
        if (k !== i + 1 || i + 3 >= peaks.length) continue;
        q.push(peaks[i + 2], peaks[i + 3]);
        const gaps = [1, 2, 3].map(j => q[j].y - q[j - 1].y), mean = (q[3].y - q[0].y) / 3;
        if (Math.min(...gaps) < 0.4 * mean || Math.max(...gaps) > 1.6 * mean) continue;
        // set apart from the lines about it (by the words between the staves)
        const before = i ? q[0].y - peaks[i - 1].y : Infinity, after = i + 4 < peaks.length ? peaks[i + 4].y - q[3].y : Infinity;
        if (Math.min(before, after) < 1.2 * Math.max(...gaps)) continue;
      }
      for (let m = 2; m <= 3 && !loose; m++) {
        // (from the line before, at the spacing so far: a hand-ruled staff's spaces differ a little)
        const last = q[q.length - 1].y, gap = (last - q[0].y) / (m - 1);
        let hit = null, off = Infinity;
        for (let j = k + 1; j < peaks.length && peaks[j].y < last + 1.5 * gap; j++) {
          const d = Math.abs(peaks[j].y - (last + gap));
          if (d < 0.25 * gap && d < off) { off = d; hit = peaks[j]; }
        }
        if (!hit) break;
        q.push(hit);
      }
      if (q.length < 4) continue;
      const st = q.map(v => v.strength), weakest = Math.min(...st);
      if (weakest < Math.max(...st) / (loose ? 5 : 3)) continue;
      // a staff's lines are neighbours: no line between them nearly as strong as theirs (fours made of the lines of
      // several staves have whole staves between; the notes in a staff's spaces make weaker rows)
      if (peaks.some(v => v.y > q[0].y && v.y < q[3].y && !q.includes(v) && v.strength >= 0.8 * weakest)) continue;
      cands.push({ q, g: (q[3].y - q[0].y) / 3, score: st.reduce((t, v) => t + v, 0) });
    }
    // the spacing most fours agree on (within 15%) is the staves': lines of different staves can fall evenly too, on a
    // page whose staves are evenly set, but there are fewer such fours than staves
    let common = 0, votes = -1;
    for (const c of cands) {
      const v = cands.filter(o => Math.abs(o.g - c.g) < 0.15 * c.g).length;
      if (v > votes || (v === votes && c.g < common)) { votes = v; common = c.g; }
    }
    const near = cands.filter(c => Math.abs(c.g - common) < 0.3 * common).sort((a, b) => b.score - a.score);
    const used = new Set(), found = [];
    for (const c of near) {
      if (c.q.some(v => used.has(v))) continue;
      // nor overlapping one already taken
      if (found.some(f => c.q[0].y < f.q[3].y + f.g && c.q[3].y > f.q[0].y - f.g)) continue;
      c.q.forEach(v => used.add(v));
      found.push(c);
    }
    // spacing far from the rest's (text, or a stray four): dropped
    const gs = found.map(f => f.g).sort((a, b) => a - b), mid = gs[gs.length >> 1];
    const staves = found.filter(f => Math.abs(f.g - mid) < 0.3 * mid).sort((a, b) => a.q[0].y - b.q[0].y);
    if (trace) Object.assign(trace, { list: peaks.map(v => [Math.round(v.y), Math.round(v.strength)]), cands: cands.map(c => c.q.map(v => Math.round(v.y))), slope, peaks: peaks.length, candidates: cands.length, found: found.length, kept: staves.length, spacing: mid });
    // each fitted on its own, between its neighbours, across the page; those already marked left alone
    const out = [];
    staves.forEach((f, k) => {
      // where it lies at the page's middle, as the band saw it
      const top = f.q[0].y, bot = f.q[3].y, g = f.g;
      const above = k ? (staves[k - 1].q[3].y + top) / 2 : 0, below = k < staves.length - 1 ? (bot + staves[k + 1].q[0].y) / 2 : h;
      const y0 = Math.max(above, top - 2.5 * g), y1 = Math.min(below, bot + 2.5 * g);
      const midY = (top + bot) / 2;
      if (skip.some(b => midY > b[1] && midY < b[1] + b[3] && (bx0 + bx1) / 2 > b[0] && (bx0 + bx1) / 2 < b[0] + b[2])) return;
      const r = fitStaff(gray, w, h, [xa, y0 - Math.abs(slope) * cw / 2, cw, y1 - y0 + Math.abs(slope) * cw], undefined, loose);
      if (r && Math.abs(r.spacing - g) < 0.3 * g) out.push(r);
    });
    return out;
  }

  // Where chants begin in a book, as the Solesmes books (and many others) show it: the first staff of a chant is
  // indented, to make room for its large initial. pages: the document's pages. Returns the ids of the staves that
  // begin a chant: those starting well in (two and a half spaces or more) from the usual left margin of their side of
  // the book (odd and even pages have different margins), and the book's very first staff.
  function beginnings(pages) {
    const margin = {};
    for (const side of [0, 1]) {
      const starts = pages.filter(p => p.n % 2 === side).flatMap(p => p.staves.map(st => xsOf(st.lines[0])[0])).sort((a, b) => a - b);
      // the usual margin: where most staves start (the lower fifth of the starts, past any stray)
      if (starts.length) margin[side] = starts[Math.floor(starts.length * 0.2)];
    }
    const out = [];
    let first = true;
    for (const p of pages) for (const st of p.staves) {
      const x = xsOf(st.lines[0])[0], g = spacing(st.lines);
      if (first || x - margin[p.n % 2] > 2.5 * g) out.push(st.id);
      first = false;
    }
    return out;
  }

  // A manuscript's red staff lines: from RGBA pixels, the red ink alone, as grey (0 where it is reddest, 255 where there
  // is none: black ink and the paper alike). null if there is too little red ink for a page of staves (a few red
  // initials don't make one), or so much that it is the paper.
  function ruling(rgba) {
    const n = rgba.length / 4, out = new Uint8Array(n);
    let red = 0;
    for (let i = 0, j = 0; j < n; i += 4, j++) {
      const r = rgba[i], m = Math.max(rgba[i + 1], rgba[i + 2]);
      // (reddish paper, and dark ink, are less red than this)
      const v = r - m - 30;
      if (v > 0 && r > 90) { out[j] = Math.max(0, 255 - 4 * v); red++; } else out[j] = 255;
    }
    return red > 0.004 * n && red < 0.2 * n ? out : null;
  }

  // How red each pixel is (red less the greater of green and blue, less 20; 0 where it isn't): the ruling of a red-ruled
  // staff, whatever else on the page is red (a leather binding, rubrics), for byFiveLines
  function redness(rgba) {
    const out = new Uint8Array(rgba.length / 4);
    for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = Math.max(0, Math.min(255, rgba[i] - Math.max(rgba[i + 1], rgba[i + 2]) - 20));
    return out;
  }

  // How much redder than blue each pixel is (red less blue, 128 where they are equal): pale red-brown ruling shows in
  // it where it is too faint and too brown to count as red ink (ruling())
  function tint(rgba) {
    const out = new Uint8Array(rgba.length / 4);
    for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = Math.max(0, Math.min(255, 128 + rgba[i] - rgba[i + 2]));
    return out;
  }

  // RGBA pixels (from a canvas) to grey, one byte a pixel
  function grey(rgba) {
    const out = new Uint8Array(rgba.length / 4);
    for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    return out;
  }

  // ---------------------------------------------------------------- what a staff carries
  // How much a staff carries, read from the ink along it (lines in the pixels' coordinates): mass, the ink of its
  // notes and signs in squared spaces, beyond what the four lines themselves make (each column's ink, from a space
  // and a half above the top line to just below the bottom one, less what a column of bare staff has), the clef at
  // its start left out; and its custos, if it ends with one: the staff position where it stands (a = 0; the bottom
  // line is 3, the top 9), else null. Used to find where a chant's lines break.
  function carries(gray, w, h, lines) {
    const g = spacing(lines), xs = xsOf(lines[0]);
    const x0 = Math.max(0, Math.round(xs[0])), x1 = Math.min(w - 1, Math.round(xs[xs.length - 1]));
    if (x1 - x0 < 4 * g) return null;
    const top = x => yAt(lines[0], x) - 1.6 * g, bot = x => yAt(lines[lines.length - 1], x) + 0.9 * g;
    // ink: darker than half the paper (the paper is the band's lighter half)
    const sample = [];
    for (let x = x0; x <= x1; x += 7) for (let y = Math.max(0, Math.round(top(x))); y < Math.min(h, bot(x)); y += 5) sample.push(gray[y * w + x]);
    sample.sort((a, b) => a - b);
    const paper = sample[Math.floor(sample.length * 0.75)], cut = paper * 0.55;
    const W = x1 - x0 + 1, col = new Float64Array(W);
    for (let i = 0; i < W; i++) {
      const x = x0 + i, ya = Math.max(0, Math.round(top(x))), yb = Math.min(h - 1, Math.round(bot(x)));
      let n = 0;
      for (let y = ya; y <= yb; y++) if (gray[y * w + x] < cut) n++;
      col[i] = n;
    }
    // a column of bare staff: the lines alone (most columns between the notes)
    const base = Array.from(col).sort((a, b) => a - b)[Math.floor(W * 0.25)];
    const extra = Array.from(col, v => Math.max(0, v - base - 0.08 * g));
    // the clef: the first run of ink from the staff's start
    let i = 0;
    while (i < W && extra[i] === 0) i++;
    const clefFrom = i;
    while (i < W && (extra[i] > 0 || extra.slice(i, i + Math.round(0.15 * g)).some(v => v > 0))) i++;
    const clefTo = i - clefFrom < 2 * g ? i : clefFrom;
    // the custos: a last run of ink, narrow, short (not a bar, which spans the staff), set apart from what's before
    let custos = null, end = W;
    let j = W - 1;
    while (j > 0 && extra[j] === 0) j--;
    const runEnd = j;
    // (set close to the last neume: a gap of a tenth of a space is enough)
    while (j > 0 && extra.slice(Math.max(0, j - Math.max(1, Math.round(0.1 * g))), j + 1).some(v => v > 0)) j--;
    const runFrom = j + 1, wide = runEnd - runFrom + 1;
    if (wide > 0.2 * g && wide < 1.1 * g && W - runEnd < 1.5 * g) {
      // its rows: the ink beyond the lines' own (rows of the lines are ink in bare columns too)
      const rowsOf = (a, b) => {
        const rows = new Map();
        for (let x = x0 + a; x <= x0 + b; x++) {
          const ya = Math.max(0, Math.round(top(x))), yb = Math.min(h - 1, Math.round(bot(x)));
          for (let y = ya; y <= yb; y++) if (gray[y * w + x] < cut) { const d = Math.round(y - yAt(lines[0], x)); rows.set(d, (rows.get(d) || 0) + 1); }
        }
        return rows;
      };
      // less the lines: what the bare columns just before it have in each row, as much per column
      const gap = rowsOf(Math.max(0, runFrom - Math.round(0.3 * g)), runFrom - 1), gw = Math.min(runFrom, Math.round(0.3 * g));
      const rows = rowsOf(runFrom, runEnd);
      for (const [d, n] of rows) rows.set(d, Math.max(0, n - (gw ? (gap.get(d) || 0) * wide / gw : 0)));
      const ys = [...rows.entries()].filter(([, n]) => n >= 0.5 * wide).map(([d]) => d);
      const span = ys.length ? Math.max(...ys) - Math.min(...ys) : Infinity;
      // the head: the stretch of half a space with the most ink; a custos has most of its ink there, a bar hasn't
      let best = -1, at = 0, all = 0;
      const hd = Math.max(2, Math.round(0.5 * g));
      for (const n of rows.values()) all += n;
      for (const d of rows.keys()) { let n = 0; for (let k = 0; k < hd; k++) n += rows.get(d + k) || 0; if (n > best) { best = n; at = d + hd / 2; } }
      if (span < 3.6 * g && best > 0.33 * all) {
        const p = 9 - at / (g / 2);
        custos = Math.round(p);
        end = runFrom;
      }
    }
    let mass = 0;
    for (let k = clefTo; k < end; k++) mass += extra[k];
    // the words under it: the ink in their band, from just below the notes to well below the bottom line
    let words = 0;
    for (let x = x0; x <= x1; x++) {
      const ya = Math.max(0, Math.round(yAt(lines[lines.length - 1], x) + 1.0 * g)), yb = Math.min(h - 1, Math.round(yAt(lines[lines.length - 1], x) + 2.9 * g));
      for (let y = ya; y <= yb; y++) if (gray[y * w + x] < cut) words++;
    }
    return { mass: mass / (g * g), words: words / (g * g), custos, clef: clefTo > clefFrom };
  }

  const api = { carries, count, xsOf, yAt, atXs, spacing, tilt, bend, middle, even, spaceEvenly, addBend, removeBend, simplify, box, roundLines, findStaves, byRedLine, byRuling, byFiveLines, byPrintedLines, redness, tint, columns, order, beginnings, fitStaff, fit, grey, ruling };
  global.CGStaves = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
