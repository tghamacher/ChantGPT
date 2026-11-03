"""Staves of German Gothic notation (Hufnagel: each note a stroke with its head at the top, like a horseshoe nail)
made up, for the note reader to learn the notes of a book like Köln, Dombibliothek, Cod. 1161 before its own staves
are paired with Cantus's melodies (the reader trained on square notes reads next to nothing there). Drawn straight into
a straightened staff (staffdata.straighten: 64 rows, 8 to a space, the top line at row 20): four lines, the F line red
(pale in grey), one more inked, the others scored and barely there; a clef letter; the notes of a real melody (Cantus's
lines, cantus.gabc: each line's syllables, under a clef that keeps it on the staff), a head and a stem each, a
neume's notes close together; a custos; Gothic words under the staff and a little of the line above; paper, ink and blur
varied. The label: the GABC items, as cantus.py labels writes them.

    python -I training/hufnagel.py --fonts DIR --text breviarium.txt --count 30000 [--out training/data/hufnagel]

DIR: blackletter .ttf fonts (as gothic.py). Writes <out>/NNNNNN.jpg and <out>/labels.jsonl ({file, items})."""
import argparse, glob, json, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cantus as C
import lines as L

TOP, SPACE, HEIGHT = 20, 8, 64
ROW = lambda p: TOP + (12 - 'abcdefghijklm'.index(p) - 3) * SPACE / 2 + 0.0   # (j the top line, d the bottom)


def melodies():
    """Every line of every Cantus source here, as (line, custos)."""
    out = []
    for path in sorted(glob.glob(os.path.join(HERE, 'data', 'cantus', '*.csv'))):
        src = os.path.basename(path)[:-4]
        try: pages = C.lines(src)
        except Exception: continue
        for p in pages.values():
            ls = p['lines']
            for j, line in enumerate(ls):
                if line: out.append((line, C.first_step(ls[j + 1]) if j + 1 < len(ls) else None))
    return out


def draw_staff(items, rng, fonts, words, style='hufnagel'):
    clef = items[0]
    W = 40 + 18 * len(items) + rng.randint(0, 40)
    S = 3                                                    # (drawn at 3×, then shrunk: smoother strokes)
    im = Image.new('L', (W * S, HEIGHT * S), 255)
    d = ImageDraw.Draw(im)
    rows = [TOP + k * SPACE for k in range(4)]               # (top to bottom: j, h, f, d)
    fline = {'f1': 3, 'f2': 2, 'f3': 1, 'f4': 0, 'c1': None, 'c2': None, 'c3': None, 'c4': None}.get(clef)
    red = fline if fline is not None else rng.randrange(4)
    inked = (red - 2) if red >= 2 else red + 2
    for k, y in enumerate(rows):
        shade = rng.randint(140, 175) if k == red else rng.randint(70, 120) if k == inked else rng.randint(200, 235)
        if style == 'points': shade = rng.randint(150, 190)      # (all four ruled alike, pale)
        elif k not in (red, inked) and rng.random() < .4: continue
        wob = rng.uniform(-1.2, 1.2)
        d.line([(0, (y + wob) * S), (W * S, (y - wob) * S)], fill=shade, width=max(1, int(S * rng.uniform(.6, 1.2))))
    ink = rng.randint(10, 60) if style != 'points' else rng.randint(40, 120)
    # the clef: its letter on its line
    F = ImageFont.truetype(rng.choice(fonts), int(SPACE * (2.2 if style != 'points' else rng.uniform(1.2, 1.8)) * S))
    cy = TOP + (4 - int(clef[1])) * SPACE
    d.text((4 * S, cy * S), clef[0].upper() if style == 'points' and clef[0] == 'f' else clef[0], font=F, fill=ink, anchor='lm')
    x = 18 + rng.uniform(0, 4)
    head = rng.uniform(4.5, 6.5); stem = rng.uniform(1.6, 2.4) * SPACE; thick = rng.uniform(2.2, 3.2); slope = rng.uniform(.25, .6)
    if style == 'points':                                     # (the ruled line the words are written on, below)
        y5 = TOP + 4 * SPACE + rng.uniform(-1, 1)
        d.line([(0, y5 * S), (W * S, y5 * S)], fill=rng.randint(150, 190), width=max(1, int(S * .8)))
    def note(x, y, kind):
        if style == 'points':                                 # a small point or tick (now and then a stroke rising from it)
            r = rng.uniform(.7, 1.3)
            if rng.random() < .4:                             # (a short slanting tick, not a round point)
                dx = rng.uniform(1, 2.5)
                d.line([((x + 2 - dx) * S, (y + dx * .4) * S), ((x + 2 + dx) * S, (y - dx * .4) * S)], fill=ink, width=max(2, int(S * r)))
            else: d.ellipse([((x + 2 - r) * S, (y - r) * S), ((x + 2 + r) * S, (y + r) * S)], fill=ink)
            if rng.random() < .3: d.line([((x + 2 + r * .6) * S, y * S), ((x + 2 + r * .6) * S, (y - SPACE * rng.uniform(1, 1.6)) * S)], fill=ink, width=max(1, int(S * .5)))
            return
        # the head: a short thick stroke rising to the right, its top at the note's row; the stem down from its left
        d.line([(x * S, (y + 1) * S), ((x + head) * S, (y + 1 - head * slope) * S)], fill=ink, width=int(thick * S))
        if kind != 'punctum' or rng.random() < .85:
            d.line([((x + .6) * S, (y + 1) * S), ((x + .6) * S, (y + 1 + stem * rng.uniform(.8, 1.1)) * S)], fill=ink, width=max(2, int(thick * S * .55)))
    for it in items[1:]:
        if it.endswith('+'):                                  # the custos: a small stroke and its tail
            y = ROW(it[0]); d.line([(x * S, y * S), ((x + 3) * S, (y + 3) * S), ((x + 6) * S, (y - 4) * S)], fill=ink, width=max(2, S)); x += 8; continue
        for k, neume in enumerate(it.split('/')):
            ps = [c for c in neume if c in 'abcdefghijklm']
            for i, p in enumerate(ps):
                note(x, ROW(p), 'virga')
                if i + 1 < len(ps): x += rng.uniform(4.5, 7) if style != 'points' else rng.uniform(3.5, 6)
            x += rng.uniform(6, 9)
        x += rng.uniform(6, 16) if style != 'points' else rng.uniform(8, 28)
    W2 = int(x + 6)
    # words under the staff (and a little of those above)
    pts = style == 'points'
    G = ImageFont.truetype(rng.choice(fonts), int(rng.uniform(1.5, 1.9) * SPACE * S if not pts else rng.uniform(1.1, 1.5) * SPACE * S))
    tink = (lambda: rng.randint(20, 80)) if not pts else (lambda: rng.randint(50, 120))
    wx = rng.uniform(0, 30)
    while wx < W2:
        w = rng.choice(words)
        if pts: d.text((wx * S, (TOP + 4 * SPACE + rng.uniform(-.5, 1)) * S), w, font=G, fill=tink(), anchor='ls')   # (written on the fifth line)
        else: d.text((wx * S, (TOP + 3 * SPACE + rng.uniform(5, 8)) * S), w, font=G, fill=tink(), anchor='lt')
        wx += G.getlength(w) / S + (rng.uniform(4, 30) if not pts else rng.uniform(2, 10))
    if pts:                                                   # (and the words of the staff above, on the ruled line over this one)
        wx = rng.uniform(-20, 10)
        while wx < W2:
            w = rng.choice(words)
            d.text((wx * S, (TOP - SPACE + rng.uniform(-.5, 1)) * S), w, font=G, fill=tink(), anchor='ls')
            wx += G.getlength(w) / S + (rng.uniform(4, 30) if not pts else rng.uniform(2, 10))
    elif rng.random() < .5:
        wx = rng.uniform(-20, 10)
        while wx < W2:
            w = rng.choice(words)
            d.text((wx * S, (rng.uniform(-6, 2)) * S), w, font=G, fill=rng.randint(20, 80), anchor='lt')
            wx += G.getlength(w) / S + (rng.uniform(4, 30) if not pts else rng.uniform(2, 10))
    im = im.crop((0, 0, W2 * S, HEIGHT * S)).resize((W2, HEIGHT), Image.LANCZOS)
    a = np.asarray(im, np.float32) / 255
    paper = rng.uniform(165, 225)
    a = a * paper + (1 - a) * 0
    a = a * (1 + np.random.default_rng(rng.randrange(1 << 30)).normal(0, .03, (1, W2)))
    im = Image.fromarray(a.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rng.uniform(.3, .9)))
    a = np.asarray(im, np.float32) + np.random.default_rng(rng.randrange(1 << 30)).normal(0, rng.uniform(2, 7), (HEIGHT, W2))
    return Image.fromarray(a.clip(0, 255).astype(np.uint8))


def main(o):
    rng = random.Random(o.seed)
    mel = melodies()
    print(len(mel), 'lines of melody', flush=True)
    fonts = [p for p in sorted(glob.glob(os.path.join(o.fonts, '*.ttf'))) if 'dejavu' not in p.lower() and 'jacquard' not in p.lower()]
    words = ' '.join(L.leaves(o.text).values()).split()
    os.makedirs(o.out, exist_ok=True)
    n = 0
    with open(os.path.join(o.out, 'labels.jsonl'), 'w', encoding='utf-8') as f:
        while n < o.count:
            line, custos = rng.choice(mel)
            clef = rng.choice(['f2', 'f3', 'f1', 'f2', 'f3', 'f4', 'c3', 'c4'] if o.style != 'points' else ['c3', 'c4', 'c4', 'c2', 'f3', 'f2', 'f4', 'c3'])
            items = C.gabc(line, clef, custos)
            if not items or len(items) < 4: continue
            if len(items) > 40: items = items[:40]
            im = draw_staff(items, rng, fonts, words, o.style)
            name = f'{n:06d}.jpg'
            im.save(os.path.join(o.out, name), quality=90)
            f.write(json.dumps({'file': name, 'items': items}) + '\n'); n += 1
            if n % 5000 == 0: print(n, flush=True)


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--fonts', required=True)
    a.add_argument('--text', required=True, help='words for under the staves (the Nidaros edition, as gothic.py)')
    a.add_argument('--count', type=int, default=30000)
    a.add_argument('--seed', type=int, default=1)
    a.add_argument('--style', default='hufnagel', choices=['hufnagel', 'points'], help='points: notes as points on staves ruled evenly, all four lines pale (Paris lat. 12044)')
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'hufnagel'))
    main(a.parse_args())
