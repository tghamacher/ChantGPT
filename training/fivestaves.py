"""Staves of five lines ruled in red, as the great choirbooks of the 16th to 18th centuries rule them (the Mexican
choirbook, Stanford Codex 0734, Cantus 1000019; the Spanish antiphoners): found by their red ink, strip by strip across
the page — in each strip, the rows redder than those about them, taken five at a time where five stand evenly spaced —
followed from strip to strip, and cut out straightened as five-line strips: 64 rows, 8 to a space as the four-line
strips have it, but the top line at row 14 (so the bottom one, at 46, leaves room below for notes under the staff, and
the top room for the two pitches above it a five-line staff has, n and p).

    python -I training/fivestaves.py --pages DIR [--out training/data/ms-1000019] [--only 014v] [--show 014v]
    python -I training/fivestaves.py --pages DIR --lines 4 --dark --out training/data/ms-123641

(--lines 4 --dark: staves of four lines ruled in ink, brown or black, as Utrecht, Ms. 406 (Cantus 123641) has them,
each with its words in a wider gap below; found the same way by their darkness, and cut out as staffdata.straighten
cuts four-line staves, the top line at row 20.)

Writes <out>/<page>-<k>.png and <out>/staves.jsonl ({file, page, k, lines (five polylines), spacing, staff_lines: 5})."""
import argparse, glob, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import staffdata as S

STRIP, HEIGHT, SPACE, TOP5, LEFT, RIGHT = 120, 64, 8, 14, 0.6, 0.4
N, DARK = 5, False                                         # (--lines, --dark)


def redness(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return np.clip(r - np.maximum(g, b) - 20, 0, None)


def darkness(rgb):
    """How much darker than the paper, on the leaf (the dark ground about it nothing)."""
    gray = rgb.mean(2)
    paper = np.percentile(gray, 80)
    d = np.clip(paper - gray, 0, None)
    d[:, np.median(gray, axis=0) < 0.7 * paper] = 0
    d[np.median(gray, axis=1) < 0.7 * paper, :] = 0
    return d


def peaks(v, apart):
    """Rows where v is highest within `apart` either side, and well above the column's usual."""
    out = []
    thr = np.percentile(v, 90) * 0.6 + 1e-6
    for i in range(1, len(v) - 1):
        if v[i] >= thr and v[i] == v[max(0, i - apart):i + apart + 1].max(): out.append(i)
    return out


def fives(ys, lo, hi):
    """Runs of five rows evenly spaced (spacing between lo and hi, each gap within a fifth of the mean): (rows, g)."""
    out, used = [], set()
    ys = sorted(ys)
    for i in range(len(ys)):
        if ys[i] in used: continue
        for j in range(i + 1, len(ys)):
            g = ys[j] - ys[i]
            if g < lo: continue
            if g > hi: break
            run = [ys[i], ys[j]]
            for k in range(N - 2):
                want = run[-1] + g
                near = [y for y in ys if abs(y - want) <= 0.2 * g]
                if not near: break
                run.append(min(near, key=lambda y: abs(y - want)))
            if len(run) == N:
                gaps = np.diff(run)
                if gaps.max() - gaps.min() <= 0.25 * gaps.mean():
                    out.append((run, float(gaps.mean()))); used.update(run); break
    return out


def page(path):
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    H, W, _ = rgb.shape
    red = darkness(rgb) if DARK else redness(rgb)
    gray = rgb.mean(2)
    cols = np.where(red.sum(0) > np.percentile(red.sum(0), 70))[0]
    if len(cols) < 50: return gray, []
    x0, x1 = int(cols[0]), int(cols[-1])
    lo, hi = 0.008 * H, 0.03 * H
    found = []                                              # (strip centre, [five rows], g)
    for x in range(x0, x1 - STRIP // 2, STRIP):
        prof = np.median(red[:, x:min(W, x + STRIP)], axis=1)
        prof = np.convolve(prof, np.ones(3) / 3, 'same')
        if DARK: prof = np.clip(prof - np.convolve(prof, np.ones(int(2 * lo) | 1) / (int(2 * lo) | 1), 'same'), 0, None)   # (thin lines, not words)
        for rows, g in fives(peaks(prof, max(2, int(lo / 2))), lo, hi):
            found.append((x + STRIP / 2, rows, g))
    # staves followed across the page: strips' fives whose top lines agree within half a space
    staves = []
    for c, rows, g in sorted(found, key=lambda f: f[0]):
        best = None
        for s in staves:
            lc, lrows, lg = s[-1]
            if c - lc <= 4 * STRIP and abs(rows[0] - lrows[0]) < 0.5 * g and (best is None or abs(rows[0] - lrows[0]) < abs(rows[0] - best[-1][1][0])): best = s
        if best is not None and best[-1][0] < c: best.append((c, rows, g))
        else: staves.append([(c, rows, g)])
    out = []
    for s in staves:
        if len(s) < 3: continue
        cs = np.array([p[0] for p in s]); R = np.array([p[1] for p in s], float); g = float(np.median([p[2] for p in s]))
        # (a ruled staff is straight and near level: its slope the median of the strips' pairwise slopes, its height the
        # median about that; strips far from it, which took another five rows, left out, and the rest fitted again)
        tops = R.mean(1)
        sl = [(tops[j] - tops[i]) / (cs[j] - cs[i]) for i in range(len(cs)) for j in range(i + 1, len(cs)) if cs[j] > cs[i]]
        slope = float(np.median(sl)) if sl else 0.0
        icpt = np.median(R - slope * cs[:, None], axis=0)
        keep = np.abs((R - slope * cs[:, None] - icpt).mean(1)) < 0.35 * g
        if keep.sum() < 3 or cs[keep][-1] - cs[keep][0] < 0.2 * (x1 - x0): continue
        cs, R = cs[keep], R[keep]
        icpt = np.median(R - slope * cs[:, None], axis=0)
        xa, xb = float(cs[0] - STRIP / 2), float(cs[-1] + STRIP / 2)
        lines = [[round(xa, 1), round(slope * xa + icpt[k], 1), round(xb, 1), round(slope * xb + icpt[k], 1)] for k in range(N)]
        out.append((lines, g))
    # (one staff found twice, in pieces, or five rows taken across two staves: of staves that overlap, the longer, as
    # js/staves.js byFiveLines keeps it)
    kept = []
    for lines, g in sorted(out, key=lambda t: -(t[0][0][2] - t[0][0][0])):
        if not any(lines[0][1] < k[-1][1] and lines[-1][1] > k[0][1] and lines[0][0] < k[0][2] and lines[0][2] > k[0][0] for k, _ in kept):
            kept.append((lines, g))
    kept.sort(key=lambda t: t[0][0][1])
    return gray, kept


def straighten5(gray, lines):
    """A five-line staff cut out and straightened: HEIGHT rows, SPACE to a space, its top line at TOP5."""
    xs = [np.array(l[0::2], float) for l in lines]; ys = [np.array(l[1::2], float) for l in lines]
    mid = (xs[0][0] + xs[0][-1]) / 2
    g = float(np.interp(mid, xs[4], ys[4]) - np.interp(mid, xs[0], ys[0])) / 4
    x0, x1 = xs[0][0] - LEFT * g, xs[0][-1] + RIGHT * g
    W = max(1, int(round((x1 - x0) / g * SPACE)))
    cx = x0 + (np.arange(W) + 0.5) * g / SPACE
    top, bot = np.interp(cx, xs[0], ys[0]), np.interp(cx, xs[4], ys[4])
    v = (np.arange(HEIGHT) + 0.5 - TOP5) / (4 * SPACE)
    py = top[None, :] + v[:, None] * (bot - top)[None, :]
    return S.bilinear(gray, np.broadcast_to(cx[None, :], py.shape), py)


def main(o):
    global N, DARK
    N, DARK = o.lines, o.dark
    cut = straighten5 if N == 5 else S.straighten
    out = o.out
    if o.show:
        f = os.path.join(o.pages, o.show + '.jpg')
        gray, st = page(f)
        im = Image.open(f).convert('RGB'); d = ImageDraw.Draw(im)
        for lines, g in st:
            for l in lines: d.line(list(zip(l[0::2], l[1::2])), fill=(0, 120, 255), width=3)
        im.save(o.show_to); print(len(st), 'staves ->', o.show_to); return
    os.makedirs(out, exist_ok=True)
    only = set(o.only.split(',')) if o.only else None
    total = 0
    with open(os.path.join(out, 'staves.jsonl'), 'w') as f:
        for p in sorted(glob.glob(os.path.join(o.pages, '*.jpg'))):
            name = os.path.basename(p)[:-4]
            if only and name not in only: continue
            gray, st = page(p)
            for k, (lines, g) in enumerate(st):
                file = f'{name}-{k + 1}.png'
                Image.fromarray(cut(gray, lines)).save(os.path.join(out, file))
                f.write(json.dumps({'file': file, 'page': name, 'k': k + 1, 'lines': lines, 'spacing': round(g, 2), 'staff_lines': N}) + '\n')
            total += len(st)
            print(f'{name}: {len(st)} staves ({total} so far)', flush=True)


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--pages', required=True)
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'ms-1000019'))
    a.add_argument('--only')
    a.add_argument('--show')
    a.add_argument('--lines', type=int, default=5, choices=[4, 5])
    a.add_argument('--dark', action='store_true', help='ruled in ink, not red')
    a.add_argument('--show-to', default='/tmp/claude-0/five-shown.jpg')
    main(a.parse_args())
