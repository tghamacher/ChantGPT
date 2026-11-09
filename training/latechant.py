"""Staves of chant as the 17th and 18th centuries printed and copied it, made up, for the note reader to learn their
shapes before it meets their books: the post-Tridentine prints (the Medicaean Graduale of 1614-15 and the books that
followed it, Plantin's, the Ratisbon reprints, the French neo-Gallican books) and the great choirbooks of Spain, Italy
and the Americas. What they share, and the earlier books here don't: notes of more than one shape standing for length
or for the place in a figure — the square (brevis), the diamond (semibrevis, and every note of a descending run but
the first), the square with a stem down at its right (the longa, often a phrase's first or last note or an accented
one) — set apart from one another rather than joined into ligatures; thin black lines (print) or broad red ones
(choirbook); clefs drawn as a pair of squares (C) or a square and a diamond before it (F); Roman type under the staff.

Drawn straight into a straightened staff (staffdata.straighten: 64 rows, 8 to a space, the top line at row 20), as
hufnagel.py draws: the notes of a real melody (Cantus's lines, cantus.gabc, under a clef that keeps it on the staff),
its custos, words; paper, ink and blur varied. The label: the GABC items, as cantus.py labels writes them (a diamond is
labelled by its pitch, as the app reads every note into a square).

    python -I training/latechant.py --text breviarium.txt --count 20000 [--style print|choirbook|mixed] [--out training/data/late]

Writes <out>/NNNNNN.jpg and <out>/labels.jsonl ({file, items})."""
import argparse, glob, json, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cantus as C
import lines as L
from hufnagel import melodies, TOP, SPACE, HEIGHT, ROW

ROMAN = [p for p in glob.glob('/usr/share/fonts/truetype/*/*.ttf') if any(k in p for k in ('LiberationSerif-Regular', 'LiberationSerif-Bold', 'FreeSerif.ttf', 'FreeSerifBold', 'DejaVuSerif.ttf'))]


def draw_staff(items, rng, words, style, nlines=4):
    clef = items[0]
    S = 3
    # (four lines with the top one at row 20, or five with it at 14, as fivestaves.py cuts them; a GABC letter's row from
    # the top line's: j for four lines, l for five)
    T = TOP if nlines == 4 else 14
    LET = 'abcdefghijklm' if nlines == 4 else 'abcdefghijklmnp'
    topi = 3 + 2 * (nlines - 1)
    row = lambda p: T + (topi - LET.index(p)) * SPACE / 2
    W = 40 + 26 * len(items) + rng.randint(0, 40)
    im = Image.new('RGB', (W * S, HEIGHT * S), (255, 255, 255))
    d = ImageDraw.Draw(im)
    choir = style == 'choirbook'
    ink = rng.randint(5, 45)
    # the four lines: thin and black (print), or broad and red (choirbook)
    if choir:
        line_col = (rng.randint(150, 210), rng.randint(40, 90), rng.randint(40, 80))
        lw = rng.uniform(.9, 1.6)
    else:
        g = rng.randint(20, 80); line_col = (g, g, g); lw = rng.uniform(.4, .8)
    for k in range(nlines):
        y = T + k * SPACE + rng.uniform(-.3, .3)
        d.line([(0, y * S), (W * S, y * S)], fill=line_col, width=max(1, int(lw * S)))
    col = (ink, ink, ink)
    half = SPACE * rng.uniform(.42, .5)                      # (a note: about a space high, as wide)
    def square(x, y, w=1.0):
        d.rectangle([(x * S, (y - half) * S), ((x + 2 * half * w) * S, (y + half) * S)], fill=col)
    def diamond(x, y):
        r = half * 1.05
        d.polygon([((x + r) * S, (y - r) * S), ((x + 2 * r) * S, y * S), ((x + r) * S, (y + r) * S), (x * S, y * S)], fill=col)
    def stem(x, y, up=False):
        L_ = SPACE * rng.uniform(1.3, 2.0)
        d.line([((x + 2 * half - .4) * S, y * S), ((x + 2 * half - .4) * S, (y - L_ if up else y + L_) * S)], fill=col, width=max(2, int(S * rng.uniform(.6, .9))))
    # the clef: two squares one above the other on its line (C); a diamond and a square before it (F)
    cy = T + (nlines - int(clef[1])) * SPACE
    x = 4 + rng.uniform(0, 3)
    def cclef(x):
        # (a thin stroke down the left, and two small squares against it, the line between them)
        s2 = SPACE * .32
        d.line([(x * S, (cy - SPACE * .9) * S), (x * S, (cy + SPACE * .9) * S)], fill=col, width=max(2, S))
        for yy in (cy - SPACE * .5, cy + SPACE * .5):
            d.rectangle([((x + .5) * S, (yy - s2) * S), ((x + .5 + 2 * s2) * S, (yy + s2) * S)], fill=col)
    if clef[0] == 'c': cclef(x)
    else:
        diamond(x, cy); x += 2 * half + 1.5; cclef(x)
    x += 2 * half + rng.uniform(6, 10)
    gap = (lambda: rng.uniform(3, 7)) if not choir else (lambda: rng.uniform(4, 9))
    for it in items[1:]:
        if it.endswith('+'):                                  # the custos: a small square with a tail up
            y = row(it[0]); d.rectangle([(x * S, (y - half * .5) * S), ((x + half) * S, (y + half * .5) * S)], fill=col)
            d.line([((x + half) * S, y * S), ((x + half + 3) * S, (y - SPACE * 1.2) * S)], fill=col, width=max(1, int(S * .6)))
            x += 10; continue
        if it in (',', ';', ':', '::', '`'):                  # a bar
            ys = {'`': (T - 2, T + 6), ',': (T, T + SPACE * 1.5), ';': (T + SPACE * .5, T + SPACE * 2.5)}.get(it, (T, T + (nlines - 1) * SPACE))
            d.line([((x + 2) * S, ys[0] * S), ((x + 2) * S, ys[1] * S)], fill=col, width=max(2, S))
            if it == '::': d.line([((x + 5) * S, ys[0] * S), ((x + 5) * S, ys[1] * S)], fill=col, width=max(2, S))
            x += 10; continue
        ps = [c for c in it if c in LET]
        for i, p in enumerate(ps):
            y = row(p)
            falling = i > 0 and LET.index(p) < LET.index(ps[i - 1])
            if falling and rng.random() < .85: diamond(x, y)   # (a descending run's notes after its first)
            elif len(ps) == 1 and rng.random() < .22: square(x, y); stem(x, y)   # (a longa)
            elif i == 0 and len(ps) > 1 and rng.random() < .3: square(x, y); stem(x, y, up=rng.random() < .3)
            else: square(x, y)
            x += 2 * half + gap()
        x += rng.uniform(4, 14) if not choir else rng.uniform(6, 20)
    W2 = int(x + 6)
    # Roman words under the staff
    G = ImageFont.truetype(rng.choice(ROMAN), int(rng.uniform(1.3, 1.8) * SPACE * S))
    wx = rng.uniform(0, 30)
    while wx < W2:
        w = rng.choice(words)
        if rng.random() < .3: w = w.upper() if rng.random() < .3 else w.capitalize()
        d.text((wx * S, (T + (nlines - 1) * SPACE + rng.uniform(4, 8)) * S), w, font=G, fill=col, anchor='lt')
        wx += G.getlength(w) / S + rng.uniform(6, 30)
    im = im.crop((0, 0, W2 * S, HEIGHT * S)).resize((W2, HEIGHT), Image.LANCZOS).convert('L')
    a = np.asarray(im, np.float32) / 255
    paper = rng.uniform(170, 235)
    a = a * paper
    a = a * (1 + np.random.default_rng(rng.randrange(1 << 30)).normal(0, .03, (1, W2)))
    im = Image.fromarray(a.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rng.uniform(.3, .9)))
    a = np.asarray(im, np.float32) + np.random.default_rng(rng.randrange(1 << 30)).normal(0, rng.uniform(2, 7), (HEIGHT, W2))
    return Image.fromarray(a.clip(0, 255).astype(np.uint8))


def main(o):
    rng = random.Random(o.seed)
    mel = melodies()
    print(len(mel), 'lines of melody', flush=True)
    words = [w for w in ' '.join(L.leaves(o.text).values()).split() if w.isascii() and w.isalpha()]
    os.makedirs(o.out, exist_ok=True)
    n = 0
    with open(os.path.join(o.out, 'labels.jsonl'), 'w', encoding='utf-8') as f:
        while n < o.count:
            line, custos = rng.choice(mel)
            nl = 5 if rng.random() < o.five else 4
            clef = rng.choice(['c3', 'c4', 'c4', 'c2', 'f3', 'f2', 'c3', 'c1'] if nl == 4 else ['c4', 'c5', 'c3', 'c4', 'f4', 'f3', 'c2'])
            items = C.gabc(line, clef, custos, lines=nl)
            if not items or len(items) < 4: continue
            if len(items) > 36: items = items[:36]
            style = o.style if o.style != 'mixed' else rng.choice(['print', 'print', 'choirbook'])
            im = draw_staff(items, rng, words, style, nl)
            name = f'{n:06d}.jpg'
            im.save(os.path.join(o.out, name), quality=90)
            f.write(json.dumps({'file': name, 'items': items}) + '\n'); n += 1
            if n % 5000 == 0: print(n, flush=True)


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--text', required=True, help='words for under the staves (the Nidaros edition, as gothic.py)')
    a.add_argument('--count', type=int, default=20000)
    a.add_argument('--seed', type=int, default=1)
    a.add_argument('--style', default='mixed', choices=['print', 'choirbook', 'mixed'])
    a.add_argument('--five', type=float, default=0.0, help='the share of staves with five lines (cut as fivestaves.py cuts them: the top line at row 14)')
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'late'))
    main(a.parse_args())
