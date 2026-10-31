"""Staves of a book ruled evenly from top to bottom, music and words alike, in a pale red-brown: four ruled lines for
each row of notes, the fifth under the words (Paris, BnF lat. 12044, Cantus 123628: points and short strokes on the
lines and spaces, a c or F written at the start of the line it names). The app's finder looks for four dark lines
and finds the words instead. Here: the ruling found by its colour (redder than the ink and the paper), strip by strip
across the page (each strip's lines evenly spaced: the spacing and where they fall that best fit the rows redder than
those about them); the rows of words found by their ink; and over each, the four ruled lines above the one it is
written on, a staff. Cut out as staves_of.js cuts the app's (staffdata.straighten), for cantus.py labels.

    python -I training/rulestaves.py --pages DIR [--out training/data/ms-123628r] [--only 060r]
    python -I training/rulestaves.py --pages DIR --show 060r      (the page with the staves drawn, to look at)

Writes <out>/<page>-<k>.png and <out>/staves.jsonl ({file, page, k, lines, spacing}), as staves_of.js does."""
import argparse, glob, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import staffdata as S

STRIP = 150


def sharp_rows(v, k=21):
    m = np.convolve(v, np.ones(k) / k, 'same')
    return v - m


def ruling(rgb, x0, x1):
    """The ruled lines' heights in the columns x0..x1: (first, spacing, count) — y = first + i * spacing."""
    rb = (rgb[:, x0:x1, 0] - rgb[:, x0:x1, 2])
    prof = sharp_rows(np.median(rb, axis=1))
    H = len(prof)
    best = None
    for g in np.arange(22, 46, 0.25):
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
    return out


def page(path):
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    H, W, _ = rgb.shape
    gray = rgb.mean(2)
    # the written block: columns with ink
    ink = (np.percentile(gray, 80) - gray > 60).mean(0)
    cols = np.where(np.convolve(ink, np.ones(31) / 31, 'same') > 0.01)[0]
    if len(cols) < 100: return gray, []
    bx0, bx1 = int(cols[0]), int(cols[-1])
    # the ruling, strip by strip; the spacing taken as the strips agree (median), each strip's phase fitted to it
    xs = list(range(bx0, bx1 - STRIP // 2, STRIP))
    fits = [ruling(rgb, x, min(W, x + STRIP)) for x in xs]
    g = float(np.median([f[1] for f in fits]))
    phases = []
    for x in xs:
        rb = rgb[:, x:min(W, x + STRIP), 0] - rgb[:, x:min(W, x + STRIP), 2]
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
    rows = text_rows(rgb, int(bx0 + 0.15 * (bx1 - bx0)), int(bx1 - 0.15 * (bx1 - bx0)))
    out = []
    for (t0, t1) in rows:
        tm = (t0 + t1) / 2
        # the ruled line the words are written on (nearest the band's middle, at the page's middle), and the four above
        k = round((tm - un[mid]) / g)
        lines = [[v for c, ph in zip(centres, un) for v in (c, ph + (k - 4 + i) * g)] for i in range(4)]
        if lines[0][1] < 0: continue
        out.append((lines, g))
    return gray, out


def main(o):
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
    a.add_argument('--show-to', default='/tmp/claude-0/staves-shown.jpg')
    main(a.parse_args())
