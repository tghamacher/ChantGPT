"""Staves of a printed book of polyphony (partbooks and choirbooks set from movable type, as Gardano's, Scotto's or
Baldini's: Il Lauro Secco, Ferrara 1582, in SEILS), found by their lines. Each line is set from short pieces of type,
one to a note, butted end to end: a broken line, its pieces a hair apart and a hair out of true, the notes' heads and
stems on it. Found here: the page's dark pixels (Otsu's threshold); of them, those in long horizontal runs, the gaps
between pieces of type bridged (the lines; a note's head or a letter is short); in strips down the page, the rows
those runs crowd, taken five at a time where five stand evenly spaced at the page's own spacing (measured from the
gaps between such rows; a print's staves all alike) and thin (the runs between them few: not the dark border of a
scan, nor a woodcut's hatching); followed from strip to strip and fitted straight (fivestaves.assemble). A staff with
nothing on it (the ruled staves left empty at a page's foot) is left out, unless asked for.

    python -I training/printstaves.py --pages DIR [--out training/data/print-staves] [--show NAME] [--keep-empty]

Writes <out>/<page>-<k>.png (straightened as fivestaves.py cuts five-line staves) and <out>/staves.jsonl."""
import argparse, glob, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fivestaves as F

STRIP = 30                                                      # (narrow: a curved staff's lines stay crisp in it)
EMPTY = 0.5                                                     # (a staff with less ink than this share of the page's usual: empty)
BLACK = 0.7                                                     # (ink, of the threshold: darker than what shows through)


def otsu(gray):
    h = np.histogram(gray, 256, (0, 256))[0].astype(float)
    p = h / max(1, h.sum()); w = np.cumsum(p); m = np.cumsum(p * np.arange(256))
    return int(np.argmax((m[-1] * w - m) ** 2 / (w * (1 - w) + 1e-9)))


def shift(a, k):
    """a moved k columns right (left if k < 0), what comes in empty."""
    if k == 0: return a
    out = np.zeros_like(a)
    if k > 0: out[:, k:] = a[:, :-k]
    else: out[:, :k] = a[:, -k:]
    return out


def runs(dark, gap=2, minrun=24):
    """Of the dark pixels, those in horizontal runs at least minrun long, gaps of up to gap pixels bridged (a closing
    along the row: widened by gap // 2 + 1 each way, then narrowed again)."""
    r = gap // 2 + 1
    wide = np.zeros_like(dark)
    for k in range(-r, r + 1): wide |= shift(dark, k)
    closed = np.ones_like(dark)
    for k in range(-r, r + 1): closed &= shift(wide, k)
    closed |= dark
    H, W = dark.shape
    out = np.zeros_like(dark)
    for y in range(H):
        idx = np.flatnonzero(closed[y])
        if not len(idx): continue
        cut = np.flatnonzero(np.diff(idx) > 1) + 1
        starts = np.r_[idx[0], idx[cut]]; ends = np.r_[idx[cut - 1], idx[-1]]
        for a, b in zip(starts, ends):
            if b - a + 1 >= minrun: out[y, a:b + 1] = True
    return out


def spacing_of(mask, strip=STRIP):
    """The page's staff spacing: the commonest gap between neighbouring rows crowded with line runs, strip by strip."""
    H, W = mask.shape
    gaps = []
    for x in range(0, W - strip, strip):
        prof = mask[:, x:x + strip].mean(1)
        rows = np.flatnonzero(prof > 0.4)
        if not len(rows): continue
        grp = np.split(rows, np.flatnonzero(np.diff(rows) > 1) + 1)
        cs = np.array([g.mean() for g in grp if len(g) <= 4])      # (thin: a line, not a black border)
        gaps += list(np.diff(cs))
    gaps = np.round(np.array(gaps)).astype(int)
    gaps = gaps[(gaps >= 4) & (gaps <= max(5, H // 25))]
    if not len(gaps): return None
    c = np.bincount(gaps)
    k = int(np.argmax(c))
    near = np.arange(max(0, k - 1), min(len(c), k + 2))
    return float((c[near] * near).sum() / c[near].sum())


def extend(lines, mask, g, gap=None):
    """A staff's ends followed out along its lines, as far as most of its five go on (its clef, its last notes, where
    the strips saw more than five lines and so missed it): a gap of up to two spaces bridged."""
    H, W = mask.shape
    gap = gap or int(2 * g)
    (xa, xb) = lines[0][0], lines[0][-2]
    at = lambda k, x: F.y_at(lines[k], x)
    def there(x):
        n = between = 0
        for k in range(5):
            y = int(round(at(k, x)))
            if 0 <= x < W and mask[max(0, y - 1):min(H, y + 2), x].any(): n += 1
            if k < 4 and 0 <= x < W and mask[int(round((at(k, x) + at(k + 1, x)) / 2)), x]: between += 1
        return n >= 4 and between <= 1                      # (lines, and space between them: not a scan's black edge)
    ends = []
    for step, x0 in ((-1, int(xa)), (1, int(xb))):
        x, last = x0, x0
        while 0 <= x < W and abs(x - last) <= gap:
            if there(x): last = x
            x += step
        ends.append(last)
    a, b = float(ends[0]), float(ends[1])
    # (its ends moved out to where its lines were followed; its bends kept)
    return [[round(a, 1), round(at(k, a), 1)] + [v for i in range(2, len(lines[k]) - 2, 2) if a < lines[k][i] < b for v in (lines[k][i], lines[k][i + 1])] + [round(b, 1), round(at(k, b), 1)] for k in range(5)]


def find(gray, keep_empty=False):
    """The printed staves on a page (gray: its pixels): [(lines, g)], top to bottom, as fivestaves.page gives them."""
    H, W = gray.shape
    if np.median(gray) < 100: gray = 255 - gray                    # (a negative: white ink on black, as some films are)
    t = otsu(gray)
    dark = gray < t
    paper = float(np.percentile(gray, 90))
    mask = runs(gray < (t + paper) / 2)                             # (lines: faint ones too, halfway to the paper)
    g = spacing_of(mask)
    if not g: return []
    lo, hi = 0.82 * g, 1.22 * g
    found = []
    for x in range(0, W - STRIP // 2, STRIP):
        prof = mask[:, x:min(W, x + STRIP)].mean(1)
        prof = np.convolve(prof, [0.25, 0.5, 0.25], 'same')
        pk = [i for i in F.peaks(prof, max(2, int(g / 3))) if prof[i] > 0.3]
        for rows, gg in F.fives(pk, lo, hi):
            # thin lines with little between them (not a scan's black border, a woodcut, a block of type)
            mids = [int(round((a + b) / 2)) for a, b in zip(rows, rows[1:])]
            if np.mean([prof[m] for m in mids]) > 0.35 * np.mean([prof[r] for r in rows]): continue
            found.append((x + STRIP / 2, rows, gg))
    cols = [c for c, _, _ in found]
    if not cols: return []
    st = [(extend(lines, mask, gg), gg) for lines, gg in F.assemble(found, min(cols) - STRIP / 2, max(cols) + STRIP / 2, strip=STRIP)]
    if keep_empty: return st
    black = gray < BLACK * otsu(gray)                               # (the ink itself: not what shows through the leaf)
    # a staff with nothing on it: dark pixels in its band, other than its lines', few (under a third of the page's
    # usual: a short last staff, half empty, still has more)
    ink = []
    for lines, gg in st:
        xa, xb = int(lines[0][0]), int(lines[0][-2])
        ya = int(min(lines[0][1::2]) - 0.5 * gg); yb = int(max(lines[4][1::2]) + 0.5 * gg)   # (the heads, not the words below)
        band = black[max(0, ya):min(H, yb), max(0, xa):min(W, xb)] & ~mask[max(0, ya):min(H, yb), max(0, xa):min(W, xb)]
        # (the inkiest stretch, eight spaces long: a short last staff, a few notes then the ruled lines bare, has some)
        w = max(1, int(8 * gg))
        cols = band.mean(0)[int(3 * gg):] if band.size else np.zeros(1)     # (past its start: the bracket a page's staves may have)
        ink.append(float(np.convolve(cols, np.ones(w) / w, 'valid').max()) if len(cols) >= w else float(cols.mean()))
    usual = float(np.median(ink)) if ink else 0
    return [v for v, k in zip(st, ink) if k > max(0.012, EMPTY * usual)]


def main(o):
    if o.show:
        f = next(iter(glob.glob(os.path.join(o.pages, o.show + '.*'))))
        gray = np.asarray(Image.open(f).convert('L')).astype(np.float32)
        st = find(gray, o.keep_empty)
        im = Image.open(f).convert('RGB'); d = ImageDraw.Draw(im)
        for lines, g in st:
            for l in lines: d.line(list(zip(l[0::2], l[1::2])), fill=(0, 120, 255), width=1)
        im.save(o.show_to); print(len(st), 'staves ->', o.show_to); return
    os.makedirs(o.out, exist_ok=True)
    total = 0
    with open(os.path.join(o.out, 'staves.jsonl'), 'w') as fh:
        for p in sorted(glob.glob(os.path.join(o.pages, '*.jp*g')) + glob.glob(os.path.join(o.pages, '*.png'))):
            name = os.path.splitext(os.path.basename(p))[0]
            gray = np.asarray(Image.open(p).convert('L')).astype(np.float32)
            st = find(gray, o.keep_empty)
            for k, (lines, g) in enumerate(st):
                file = f'{name}-{k + 1}.png'
                Image.fromarray(F.straighten5(gray, lines)).save(os.path.join(o.out, file))
                fh.write(json.dumps({'file': file, 'page': name, 'k': k + 1, 'lines': lines, 'spacing': round(g, 2), 'staff_lines': 5}) + '\n')
            total += len(st)
            print(f'{name}: {len(st)} staves ({total} so far)', flush=True)


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--pages', required=True)
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'print-staves'))
    a.add_argument('--show')
    a.add_argument('--show-to', default='/tmp/claude-0/print-shown.png')
    a.add_argument('--keep-empty', action='store_true', help='the staves with nothing on them too')
    main(a.parse_args())
