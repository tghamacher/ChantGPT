"""Staves of a book ruled evenly from top to bottom, music and words alike, in a pale red-brown: four ruled lines for
each row of notes, the fifth under the words (Paris, BnF lat. 12044, Cantus 123628: points and short strokes on the
lines and spaces, a c or F written at the start of the line it names). The app's finder looks for four dark lines
and finds the words instead. Here: the ruling found by its colour (redder than the ink and the paper), strip by strip
across the page (each strip's lines evenly spaced: the spacing and where they fall that best fit the rows redder than
those about them); the rows of words found by their ink; and over each, the four ruled lines above the one it is
written on, a staff. Cut out as staves_of.js cuts the app's (staffdata.straighten), for cantus.py labels.

    python -I training/rulestaves.py --pages DIR [--out training/data/ms-123628r] [--only 060r]
    python -I training/rulestaves.py --pages DIR --show 060r      (the page with the staves drawn, to look at)
    python -I training/rulestaves.py --pages DIR --dark ...        (ruled in ink, as Utrecht, Ms. 406: Cantus 123641)

Writes <out>/<page>-<k>.png and <out>/staves.jsonl ({file, page, k, lines, spacing}), as staves_of.js does."""
import argparse, glob, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import staffdata as S

STRIP = 150
DARK = False                                                # (--dark: ruled in ink, not red; found by darkness)


def rmap(rgb):
    """How much each pixel looks like the ruling: redder than ink and paper, or (DARK) darker than the paper."""
    return -rgb.mean(-1) if DARK else rgb[..., 0] - rgb[..., 2]


def sharp_rows(v, k=21):
    m = np.convolve(v, np.ones(k) / k, 'same')
    return v - m


def ruling(rgb, x0, x1, lo=22, hi=46):
    """The ruled lines' heights in the columns x0..x1, the spacing looked for between lo and hi: (first, spacing,
    score) — y = first + i * spacing."""
    rb = rmap(rgb[:, x0:x1])
    prof = sharp_rows(np.median(rb, axis=1))
    H = len(prof)
    best = None
    for g in np.arange(lo, hi, 0.25):
        for ph in np.arange(0, g, 1.0):
            ys = np.arange(ph, H - 1, g)
            s = np.interp(ys, np.arange(H), prof).sum() / len(ys)
            if best is None or s > best[0]: best = (s, ph, g)
    return best[1], best[2], best[0]


def text_rows(rgb, x0, x1):
    """Rows of words: bands where the dark (not red) ink covers much of the row, a few rows on end: (top, bottom)."""
    gray = rgb[:, x0:x1].mean(2)
    paper = np.percentile(gray, 80)
    ink = (paper - gray > 60)
    cover = ink.mean(1)
    # (rows off the leaf — the dark ground it was photographed on — are no words)
    cover[np.median(gray, axis=1) < 0.7 * paper] = 0
    sm = np.convolve(cover, np.ones(9) / 9, 'same')
    on = sm > max(0.05, 0.35 * np.percentile(sm, 99))
    out, i = [], 0
    while i < len(on):
        if on[i]:
            j = i
            while j < len(on) and on[j]: j += 1
            if j - i >= 8: out.append((i, j))
            i = j
        else: i += 1
    if DARK: return periodic_rows(sm)
    return out


def periodic_rows(sm):
    """(--dark) Rows of words where the notes are as dark as the words: the rows come at a steady distance apart (a
    staff and its words), found as the period of the ink's cover down the page; each row then the cover's highest near
    where that period puts it, reaching as far as it stays above half that."""
    H = len(sm)
    z = sm - sm.mean()
    lags = np.arange(int(0.03 * H), int(0.12 * H))
    P = int(lags[int(np.argmax([(z[:-L] * z[L:]).mean() for L in lags]))])
    # (from the strongest row, a period at a time up and down the page, each step from the row last found: the
    # distance drifts a little down a page)
    # (and the distance itself taken from the last step, within limits: a page can change hands, and spacing)
    def near(c, p):
        a, b = max(0, int(c - 0.2 * p)), min(H, int(c + 0.2 * p) + 1)
        return a + int(np.argmax(sm[a:b])) if b > a else None
    first = int(np.argmax(sm))
    peaks = [first]
    for sign in (1, -1):
        c, p = first, P
        while 0 <= c + sign * p < H:
            n = near(c + sign * p, p)
            if n is None: break
            p = float(np.clip(abs(n - c), 0.7 * P, 1.3 * P)) if sm[n] > 0.4 * sm[first] else p
            c = n
            peaks.append(c)
    peaks = sorted(set(peaks))
    top = np.median([sm[c] for c in peaks])
    out = []
    for c in peaks:
        if sm[c] < 0.4 * top: continue
        a = c
        while a > 0 and sm[a - 1] > 0.5 * sm[c] and c - a < 0.25 * P: a -= 1
        b = c
        while b < H - 1 and sm[b + 1] > 0.5 * sm[c] and b - c < 0.25 * P: b += 1
        out.append((a, b))
    return out


def combs(rgb, gray, rows, bx0, bx1):
    """(--dark) Staves of four ink lines, each over a row of words, in a wider gap than its spaces (Utrecht, Ms. 406):
    over each row, between it and the row above, the four evenly spaced rows that are darkest against those about
    them — found in the left half of the writing and the right half apart (a staff tilts as the page does), each line
    then moved onto the ruling near it."""
    H = gray.shape[0]
    feet = [b for a, b in rows]
    period = float(np.median(np.diff(feet))) if len(feet) > 1 else 0
    if not period: return []
    G = period / 5
    dark = rmap(rgb)
    w = bx1 - bx0
    halves = [(int(bx0 + 0.04 * w), int(bx0 + 0.5 * w)), (int(bx0 + 0.5 * w), int(bx1 - 0.04 * w))]
    profs = [sharp_rows(np.median(dark[:, a:b], axis=1), k=int(G) | 1) for a, b in halves]
    out = []
    for n, (t, f) in enumerate(rows):
        lo = feet[n - 1] if n and f - feet[n - 1] < 1.6 * period else f - period
        G = (f - lo) / 5 if 0.6 * period < f - lo < 1.4 * period else period / 5   # (this staff's own: hands differ)
        hi = t + 0.5 * G                                     # (the bottom line can run through the words' tall letters)
        fits = []
        for prof in profs:
            best = None
            for g in np.arange(0.85 * G, 1.15 * G, 0.5):
                for y0 in np.arange(max(0, lo, t - 1.5 * G - 3 * g), hi - 3 * g, 1.0):   # (the bottom line close over the words)
                    v = np.interp(y0 + g * np.arange(4), np.arange(H), prof).mean()
                    if best is None or v > best[0]: best = (v, y0, g)
            fits.append(best)
        if any(b is None for b in fits): continue
        (vl, yl, gl), (vr, yr, gr) = fits
        if abs((yl - yr)) > 1.5 * G: continue                # (the halves disagree: one of them took something else)
        cl, cr = [(a + b) / 2 for a, b in halves]
        ys = [[yl + i * gl, yr + i * gr] for i in range(4)]
        # (each line, at either half, moved up to a fifth of a space onto the darkest row near it)
        for i in range(4):
            for j, prof in enumerate(profs):
                y = ys[i][j]
                cand = np.arange(y - 0.2 * G, y + 0.2 * G + 0.01, 0.5)
                ys[i][j] = float(cand[int(np.argmax(np.interp(cand, np.arange(H), prof)))])
        sl = [(r - l) / (cr - cl) for l, r in ys]
        lines = [[round(v, 2) for v in (bx0, l - s_ * (cl - bx0), cl, l, cr, r, bx1, r + s_ * (bx1 - cr))] for (l, r), s_ in zip(ys, sl)]
        out.append((lines, (np.mean(ys[3]) - np.mean(ys[0])) / 3))
    return out


def page(path):
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    H, W, _ = rgb.shape
    gray = rgb.mean(2)
    # the written block: columns with ink (on the leaf: columns mostly the dark ground it lies on left out)
    paper = np.percentile(gray, 80)
    ink = (paper - gray > 60).mean(0)
    ink[np.median(gray, axis=0) < 0.7 * paper] = 0
    cols = np.where(np.convolve(ink, np.ones(31) / 31, 'same') > 0.01)[0]
    if len(cols) < 100: return gray, []
    bx0, bx1 = int(cols[0]), int(cols[-1])
    # the ruling, strip by strip; the spacing taken as the strips agree (median), each strip's phase fitted to it
    # (the rows of words first: written on every fifth ruled line, the staff's four between, so the rows' usual
    # distance apart is five spaces — which keeps the ruling's fit from settling on a spacing 5/4 or 4/5 of the true)
    rows = text_rows(rgb, int(bx0 + 0.15 * (bx1 - bx0)), int(bx1 - 0.15 * (bx1 - bx0)))
    if DARK: return gray, combs(rgb, gray, rows, bx0, bx1)
    mids = [(a + b) / 2 for a, b in rows]
    gaps = [d for d in np.diff(mids) if 5 * 22 <= d <= 5 * 52]
    lo, hi = (0.9 * np.median(gaps) / 5, 1.1 * np.median(gaps) / 5) if len(gaps) >= 2 else (22, 46)
    xs = list(range(bx0, bx1 - STRIP // 2, STRIP))
    fits = [ruling(rgb, x, min(W, x + STRIP), lo, hi) for x in xs]
    g = float(np.median([f[1] for f in fits]))
    phases = []
    for x in xs:
        rb = rmap(rgb[:, x:min(W, x + STRIP)])
        prof = sharp_rows(np.median(rb, axis=1))
        sc = [np.interp(np.arange(ph, H - 1, g), np.arange(H), prof).mean() for ph in np.arange(0, g, 0.5)]
        phases.append(float(np.arange(0, g, 0.5)[int(np.argmax(sc))]))
    # (the phase unwrapped across the strips: a line followed from strip to strip, never jumping a whole space)
    un = [phases[0]]
    for p in phases[1:]:
        q = p + g * round((un[-1] - p) / g)
        un.append(q)
    centres = [x + STRIP / 2 for x in xs]
    mid = len(xs) // 2
    # (the ruling straight across the page: a line through the strips' phases, far-off strips left out)
    cs, us = np.array(centres), np.array(un)
    fit = np.polyfit(cs, us, 1) if len(cs) >= 3 else None
    if fit is not None:
        near = np.abs(us - np.polyval(fit, cs)) < 0.25 * g
        if near.sum() >= 2: fit = np.polyfit(cs[near], us[near], 1)
        un = list(np.polyval(fit, cs))
    rb = rmap(rgb)
    xa, xb = int(bx0 + 0.1 * (bx1 - bx0)), int(bx1 - 0.1 * (bx1 - bx0))
    xsamp = np.arange(xa, xb, 3)
    slope = fit[0] if fit is not None else 0.0
    def snap(y_mid, reach):
        # (a hand-ruled page's lines aren't quite evenly spaced: each line moved to where the ruling is, near where
        # the even grid puts it — the redness along a line of the grid's slope, at offsets up to a third of a space)
        best, bd = None, 0.0
        for d in np.arange(-reach, reach + 0.01, 0.5):
            ys = y_mid + d + slope * (xsamp - (xa + xb) / 2)
            yi = np.clip(np.round(ys).astype(int), 0, H - 1)
            v = np.median(rb[yi, xsamp]) - 0.5 * (np.median(rb[np.clip(yi - int(g / 3), 0, H - 1), xsamp]) + np.median(rb[np.clip(yi + int(g / 3), 0, H - 1), xsamp]))
            if best is None or v > best: best, bd = v, d
        return bd
    xm = (xa + xb) / 2
    # (each row of words written on a ruled line, near the band's foot; the staff the four ruled lines between it and
    # the row above, at fifths of the way (the first row's, a staff's usual size above it), each moved onto the ruling)
    feet = [t1 for t0, t1 in rows]
    period = np.median(np.diff(feet)) if len(feet) > 1 else 5 * g
    out = []
    for n, f in enumerate(feet):
        above = feet[n - 1] if n and 4 * g < f - feet[n - 1] < 7 * g else f - period
        q = (f - above) / 5
        ys = [above + (i + 1) * q for i in range(4)]
        moved = [y + snap(y, 0.22 * q) for y in ys]
        # (a line pulled far from its fellows' spacing was pulled by something else: left where the fifths put it)
        for i in range(4):
            prev = moved[i - 1] if i else above
            nxt = moved[i + 1] if i < 3 else f
            if not (0.7 * q < moved[i] - prev < 1.3 * q and 0.7 * q < nxt - moved[i] < 1.3 * q): moved[i] = ys[i]
        ys = moved
        if ys[0] < 0: continue
        lines = [[v for c in centres for v in (c, y + slope * (c - xm))] for y in ys]
        out.append((lines, (ys[3] - ys[0]) / 3))
    return gray, out


def main(o):
    global DARK
    DARK = o.dark
    out = o.out or os.path.join(HERE, 'data', 'ms-' + os.path.basename(os.path.normpath(o.pages)) + 'r')
    files = sorted(glob.glob(os.path.join(o.pages, '*.jpg')))
    if o.show:
        f = os.path.join(o.pages, o.show + '.jpg')
        gray, st = page(f)
        im = Image.open(f).convert('RGB'); d = ImageDraw.Draw(im)
        for lines, g in st:
            for l in lines: d.line(list(zip(l[0::2], l[1::2])), fill=(0, 120, 255), width=2)
        im.save(o.show_to); print(len(st), 'staves ->', o.show_to); return
    os.makedirs(out, exist_ok=True)
    index = os.path.join(out, 'staves.jsonl')
    done = set()
    if os.path.exists(index):
        for l in open(index): done.add(json.loads(l)['page'])
    only = set(o.only.split(',')) if o.only else None
    total = 0
    with open(index, 'a') as f:
        for p in files:
            name = os.path.basename(p)[:-4]
            if name in done or (only and name not in only): continue
            gray, st = page(p)
            for k, (lines, g) in enumerate(st):
                file = f'{name}-{k + 1}.png'
                Image.fromarray(S.straighten(gray, lines)).save(os.path.join(out, file))
                f.write(json.dumps({'file': file, 'page': name, 'k': k + 1, 'lines': [[round(v, 2) for v in l] for l in lines], 'spacing': round(g, 2)}) + '\n')
            if not st: f.write(json.dumps({'file': None, 'page': name, 'k': 0}) + '\n')
            total += len(st); f.flush()
            print(f'{name}: {len(st)} staves ({total} so far)', flush=True)


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--pages', required=True)
    a.add_argument('--out')
    a.add_argument('--only')
    a.add_argument('--show')
    a.add_argument('--dark', action='store_true', help='the ruling in ink (brown or black, as Utrecht 406), not red')
    a.add_argument('--show-to', default='/tmp/claude-0/staves-shown.jpg')
    main(a.parse_args())
