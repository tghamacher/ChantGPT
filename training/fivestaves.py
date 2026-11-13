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
NEAR, EVEN = 0.2, 0.25                                      # (how far a line may stray from even spacing: a hand's ruling, more)


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
                near = [y for y in ys if abs(y - want) <= NEAR * g]
                if not near: break
                run.append(min(near, key=lambda y: abs(y - want)))
            if len(run) == N:
                gaps = np.diff(run)
                if gaps.max() - gaps.min() <= EVEN * gaps.mean():
                    out.append((run, float(gaps.mean()))); used.update(run); break
    return out


def page(path, spacing=None):
    """The staves on a page (spacing: the range of a staff's spacing, in pixels, if not the usual share of the page's
    height: as for a crop of one staff)."""
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    H, W, _ = rgb.shape
    red = darkness(rgb) if DARK else redness(rgb)
    gray = rgb.mean(2)
    cols = np.where(red.sum(0) > np.percentile(red.sum(0), 70))[0]
    if len(cols) < 50: return gray, []
    x0, x1 = int(cols[0]), int(cols[-1])
    lo, hi = spacing if spacing else (0.008 * H, 0.03 * H)
    found = []                                              # (strip centre, [five rows], g)
    for x in range(x0, x1 - STRIP // 2, STRIP):
        prof = np.median(red[:, x:min(W, x + STRIP)], axis=1)
        prof = np.convolve(prof, np.ones(3) / 3, 'same')
        if DARK: prof = np.clip(prof - np.convolve(prof, np.ones(int(2 * lo) | 1) / (int(2 * lo) | 1), 'same'), 0, None)   # (thin lines, not words)
        for rows, g in fives(peaks(prof, max(2, int(lo / 2))), lo, hi):
            found.append((x + STRIP / 2, rows, g))
    return gray, assemble(found, x0, x1)


def follow(found, strip):
    """The fives found strip by strip ([(strip centre, [rows], g)]) followed across the page into staves: each joined to
    the staff whose top line, carried on as its last strips lean (a staff that curves goes on curving), comes within
    half a space of its own; strips at most four apart; one staff found twice in a strip, a row apart, once."""
    chains = []
    def ahead(ch, c):
        l = ch[-1]
        if len(ch) < 2: return l[1][0]
        q = ch[max(0, len(ch) - 3)]
        return l[1][0] + (l[1][0] - q[1][0]) / ((l[0] - q[0]) or 1) * (c - l[0])
    for c, rows, g in sorted(found, key=lambda f: f[0]):
        best, bd = None, None
        for ch in chains:
            d = abs(rows[0] - ahead(ch, c))
            if ch[-1][0] <= c and c - ch[-1][0] <= 4 * strip and d < 0.5 * g and (bd is None or d < bd): best, bd = ch, d
        if best is not None:
            if best[-1][0] < c: best.append((c, rows, g))
        else: chains.append([(c, rows, g)])
    return chains


def y_at(l, x):
    """A line's height at x (l: [x0, y0, x1, y1, …]), carried on beyond its ends as its end segments lean."""
    xs, ys = l[0::2], l[1::2]
    if len(xs) < 2: return ys[0]
    k = 0 if x <= xs[0] else len(xs) - 2 if x >= xs[-1] else max(i for i in range(len(xs) - 1) if xs[i] <= x)
    return ys[k] + (ys[k + 1] - ys[k]) * (x - xs[k]) / ((xs[k + 1] - xs[k]) or 1)


def simplify(lines, tol):
    """The bends that make no difference (no further than tol from where the staff's middle would run without them)
    taken away, the same points kept on every line (Douglas-Peucker, as js/staves.js simplify)."""
    mid = [(lines[0][i] + lines[-1][i]) / 2 for i in range(len(lines[0]))]
    n = len(mid) // 2
    keep = [False] * n; keep[0] = keep[-1] = True
    def split(a, b):
        worst, at = 0, -1
        for k in range(a + 1, b):
            y = y_at([mid[2 * a], mid[2 * a + 1], mid[2 * b], mid[2 * b + 1]], mid[2 * k])
            if abs(mid[2 * k + 1] - y) > worst: worst, at = abs(mid[2 * k + 1] - y), k
        if at >= 0 and worst > tol: keep[at] = True; split(a, at); split(at, b)
    split(0, n - 1)
    return [[v for i, v in enumerate(l) if keep[i // 2]] for l in lines]


def chain_lines(ch, g, xa, xb, min_span=0):
    """A staff's lines from its strips (as js/staves.js chainLines): a strip off the line through those about it left
    out; each line through the strips' rows (each the median of its strip and the two beside it), run on to xa and xb
    as the end strips lean; the bends that make no difference (a fifth of a space) taken away. None if too few."""
    mean = lambda f: float(np.mean(f[1]))
    kept = []
    for j, f in enumerate(ch):
        near = [o for o in ch[max(0, j - 2):j + 3] if o is not f]
        if len(near) >= 2:
            cs = np.array([o[0] for o in near], float); ms = np.array([mean(o) for o in near])
            sl = np.polyfit(cs, ms, 1) if np.ptp(cs) > 0 else (0.0, ms.mean())
            if abs(mean(f) - (sl[0] * f[0] + sl[1])) >= 0.35 * g: continue
        kept.append(f)
    if len(kept) < 3 or kept[-1][0] - kept[0][0] < min_span: return None
    cs = [f[0] for f in kept]
    lines = []
    for k in range(len(kept[0][1])):
        ys = [float(np.median([o[1][k] for o in kept[max(0, j - 1):j + 2]])) for j in range(len(kept))]
        lean = lambda i, j: (ys[j] - ys[i]) / ((cs[j] - cs[i]) or 1)
        y0 = ys[0] + lean(0, min(2, len(ys) - 1)) * (xa - cs[0]); y1 = ys[-1] + lean(max(0, len(ys) - 3), len(ys) - 1) * (xb - cs[-1])
        l = [xa, y0]
        for c, y in zip(cs, ys):
            if xa < c < xb: l += [c, y]
        lines.append(l + [xb, y1])
    return [[round(v, 1) for v in l] for l in simplify(lines, 0.2 * g)]


def assemble(found, x0, x1, strip=None):
    """Staves from the fives found strip by strip ([(strip centre, [rows], g)]): followed across the page, straight or
    curving (follow, chain_lines), overlaps left out (the longer kept), top to bottom: [(lines, g)]."""
    STRIP_ = strip or STRIP
    out = []
    for ch in follow(found, STRIP_):
        if len(ch) < 3: continue
        g = float(np.median([p[2] for p in ch]))
        lines = chain_lines(ch, g, float(ch[0][0] - STRIP_ / 2), float(ch[-1][0] + STRIP_ / 2), 0.2 * (x1 - x0))
        if lines: out.append((lines, g))
    # (one staff found twice, in pieces, or five rows taken across two staves: of staves that overlap, the longer, as
    # js/staves.js keeps it)
    def overlaps(a, b):
        ax0, ax1, bx0, bx1 = a[0][0], a[0][-2], b[0][0], b[0][-2]
        if ax0 >= bx1 or ax1 <= bx0: return False
        x = (max(ax0, bx0) + min(ax1, bx1)) / 2
        return y_at(a[0], x) < y_at(b[-1], x) and y_at(a[-1], x) > y_at(b[0], x)
    kept = []
    for lines, g in sorted(out, key=lambda t: -(t[0][0][-2] - t[0][0][0])):
        if not any(overlaps(lines, k) for k, _ in kept): kept.append((lines, g))
    kept.sort(key=lambda t: t[0][0][1])
    return kept


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
