"""Staves of a book whose four lines are mostly not inked: German and Cistercian books of the 13th–15th centuries rule
the F line in red and the c line (two lines above it) in ink, the other two only scored, barely to be seen (Köln,
Dombibliothek, Cod. 1161, Cantus 601861). The app's finder looks for four dark lines and finds few such staves; here
each staff is found by its red line: long, thin runs of red ink traced across the page (red initials are short and
thick), its spacing and its inked c line from the ink about it, and the four lines set from them at that spacing (the
fourth on the side whose scored line shows more). Cut out as staves_of.js cuts the app's (staffdata.straighten), for
cantus.py labels.

    python -I training/redstaves.py --pages training/data/scans/601861 [--out training/data/ms-601861] [--only 020r]
    python -I training/redstaves.py --pages … --show 020r      (the page with the staves drawn, to look at)
    python -I training/redstaves.py --labels --source 601861 --out training/data/ms-601861r

--labels: no reader needed. Where a page has as many staves as Cantus has lines for it (every chant's melody there),
they are paired in order, each with its line's melody under the clef its red line says (cantus.gabc; the next line's
first note its custos). Writes <out>/labels.jsonl as cantus.py labels does (fit 0: not measured against a reading).

Writes <out>/<page>-<k>.png and <out>/staves.jsonl ({file, page, k, lines, spacing}), as staves_of.js does."""
import argparse, glob, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import staffdata as S

STRIP = 40                                          # columns to a strip, tracing a line across the page


def red_of(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return (r - np.maximum(g, b) > 30) & (r > 90)


def runs(on, least):
    out, i, n = [], 0, len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]: j += 1
            if j - i >= least: out.append((i, j))
            i = j
        else: i += 1
    return out


def red_lines(red, W):
    """The red lines: in each strip of columns, the rows mostly red across it, thin; linked strip to strip."""
    H = red.shape[0]
    segs = []                                       # per strip: [(y, x)]
    for x in range(0, W - STRIP, STRIP):
        prof = red[:, x:x + STRIP].mean(1)
        ys = []
        for a, b in runs(prof > 0.35, 1):
            if b - a <= 6: ys.append(((a + b - 1) / 2, x + STRIP / 2))   # (thin: a line, not a letter)
        segs.append(ys)
    lines = []                                      # each: [(x, y)]
    for ys in segs:
        for y, x in ys:
            best = None
            for l in lines:
                lx, ly = l[-1]
                if 0 < x - lx <= 4 * STRIP and abs(y - ly) < 4 and (best is None or abs(y - ly) < abs(y - best[-1][1])): best = l
            if best is not None: best.append((x, y))
            else: lines.append([(x, y)])
    return [l for l in lines if l[-1][0] - l[0][0] > 0.3 * W and len(l) >= 6]


def staff_of(dark, line, W):
    """Four lines from a red one: the spacing, from the ink rows about it (the inked c line two spaces above, or the
    scored lines); the fourth line above the c line or below the F line, whichever shows more ink."""
    xs = np.array([p[0] for p in line]); ys = np.array([p[1] for p in line])
    H = dark.shape[0]
    # the ink about the line, the line's own course followed (rows relative to it), over its length
    off = np.arange(-90, 91)
    prof = np.zeros(len(off)); cover = np.zeros(len(off))
    cut = np.percentile(dark, 97) * 0.5
    for x, y in line:
        a, b = int(x - STRIP / 2), int(x + STRIP / 2)
        rows = np.clip(np.round(y + off).astype(int), 0, H - 1)
        prof += dark[rows, a:b].mean(1)
        cover += (dark[rows, a:b] > cut).mean(1)
    prof /= len(line); cover /= len(line)
    # the spacing: the inked line nearest the red one, a space above or below it (the sharpest thin row of ink 12–30
    # rows away, standing out from the rows about it)
    sharp = prof - np.convolve(prof, np.ones(9) / 9, 'same')
    band = (np.abs(off) >= 12) & (np.abs(off) <= 30)
    k = np.argmax(np.where(band, sharp, -np.inf))
    if sharp[k] <= 2: return None                    # (nothing inked near: not a staff's red line)
    lo, hi = max(0, k - 1), min(len(off) - 1, k + 1)
    w = np.clip(prof[lo:hi + 1] - prof[lo:hi + 1].min(), 1e-6, None)
    g = abs(float((off[lo:hi + 1] * w).sum() / w.sum()))
    # the red F line is any of the four, by the clef; the words are written just under every staff: its lowest line
    # is the last of the red line's (at whole spaces from it) above the words (the first rows below it as dark as
    # writing, a few rows on end: words cover a row evenly, the notes' strokes stand apart)
    heavy = cover > 0.6 * cover[(off > 0)].max()
    below = [o for o in range(0, 91) if all(heavy[np.searchsorted(off, o + d)] for d in range(0, 6) if o + d <= 90)]
    if not below: return None
    words = below[0]
    j = max(0, min(3, int(np.floor((words - 0.4 * g) / g))))
    if j * g > words: return None
    # (the red line is the F line: j lines above the lowest, so the clef is f<j+1>)
    return [[v for x, y in zip(xs, ys) for v in (float(x), float(y + (j + i) * g))] for i in (-3, -2, -1, 0)], g, f'f{j + 1}'


def notes_on(dark, lines):
    """The ink between a staff's top and bottom lines, along it."""
    top, bot = lines[0], lines[3]
    tot = 0.0
    for i in range(0, len(top), 2):
        x = int(top[i]); a, b = int(top[i + 1]), int(bot[i + 1])
        if 0 <= a < b < dark.shape[0]: tot += dark[a:b, max(0, x - STRIP // 2):x + STRIP // 2].sum()
    return tot


def page(path):
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.int16)
    gray = rgb.mean(2)
    H, W = gray.shape
    paper = np.percentile(gray, 75)
    dark = np.clip(paper - gray, 0, None)
    out = []
    for l in red_lines(red_of(rgb), W):
        s = staff_of(dark, l, W)
        if s: out.append(s)
    # (a staff with next to no notes on it: a red line in the margin or under an empty ruling)
    ink = [notes_on(dark, s[0]) for s in out]
    if ink:
        typical = float(np.median(ink))
        out = [s for s, v in zip(out, ink) if v > 0.25 * typical]
    out.sort(key=lambda s: (s[0][0][0] > W * 0.55, s[0][0][1]))
    # (two red lines a staff apart can be one staff found twice: the same lines)
    keep = []
    for s in out:
        if not any(abs(s[0][0][1] - k[0][0][1]) < 2 * s[1] and abs(s[0][0][0] - k[0][0][0]) < W / 3 for k in keep): keep.append(s)
    return gray, keep


def labels(o):
    import cantus as C
    pages = C.lines(o.source)
    folios = list(pages)
    found = {}
    for l in open(os.path.join(o.out, 'staves.jsonl')):
        r = json.loads(l)
        if r.get('file'): found.setdefault(r['page'], []).append(r)
    why, n = {}, 0
    with open(os.path.join(o.out, 'labels.jsonl'), 'w', encoding='utf-8') as out:
        for f, rows in sorted(found.items(), key=lambda v: C.folio_key(v[0])):
            p = pages.get(f)
            if not p or not p['lines']: why['no melodies'] = why.get('no melodies', 0) + 1; continue
            if not p['complete']: why['not every melody'] = why.get('not every melody', 0) + 1; continue
            if len(rows) != len(p['lines']): why['staves and lines differ'] = why.get('staves and lines differ', 0) + 1; continue
            rows.sort(key=lambda r: r['k'])
            nxt = folios[folios.index(f) + 1] if folios.index(f) + 1 < len(folios) else None
            for j, (r, line) in enumerate(zip(rows, p['lines'])):
                c = C.first_step(p['lines'][j + 1]) if j + 1 < len(p['lines']) else (C.first_step(pages[nxt]['lines'][0]) if nxt and pages[nxt]['lines'] else None)
                items = C.gabc(line, r['clef'], c)
                if not items: why['notes off the staff'] = why.get('notes off the staff', 0) + 1; continue
                out.write(json.dumps({'file': r['file'], 'items': items, 'page': folios.index(f), 'chant': f'f{f}-1',
                                      'staff': f'f{f}s{r["k"]}', 'line': j + 1, 'fit': 0.0}) + '\n'); n += 1
    print(f'{n} staves labelled -> {os.path.join(o.out, "labels.jsonl")}; pages and staves left out: {why}')


def main(o):
    if o.labels: return labels(o)
    out = o.out = o.out or os.path.join(HERE, 'data', 'ms-' + os.path.basename(os.path.normpath(o.pages)))
    files = sorted(glob.glob(os.path.join(o.pages, '*.jpg')))
    if o.show:
        f = os.path.join(o.pages, o.show + '.jpg')
        gray, st = page(f)
        im = Image.open(f).convert('RGB'); d = ImageDraw.Draw(im)
        for lines, g, clef in st:
            for l in lines: d.line(list(zip(l[0::2], l[1::2])), fill=(0, 160, 255), width=2)
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
            for k, (lines, g, clef) in enumerate(st):
                file = f'{name}-{k + 1}.png'
                Image.fromarray(S.straighten(gray, lines)).save(os.path.join(out, file))
                f.write(json.dumps({'file': file, 'page': name, 'k': k + 1, 'lines': [[round(v, 2) for v in l] for l in lines], 'spacing': round(g, 2), 'clef': clef}) + '\n')
            if not st: f.write(json.dumps({'file': None, 'page': name, 'k': 0}) + '\n')
            total += len(st); f.flush()
            print(f'{name}: {len(st)} staves ({total} so far)', flush=True)


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--pages')
    a.add_argument('--labels', action='store_true')
    a.add_argument('--source')
    a.add_argument('--out')
    a.add_argument('--only')
    a.add_argument('--show')
    a.add_argument('--show-to', default='/tmp/claude-0/staves-shown.jpg')
    main(a.parse_args())
