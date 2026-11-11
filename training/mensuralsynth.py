"""Staves of mensural notation (white notation, as the choirbooks and prints of the 15th to 17th centuries have it) made
up, for a reader of it to learn from before it meets a real page: a clef, often a mensuration sign, then a melody
of mensural values (mostly by step, a leap now and then), with rests, dots, accidentals, coloration, ligatures (as
the rules write them), and a custos or a bar at the end; drawn as the app draws mensural notation (the signs of Elam
Rotem's EMS_Serenissima, from js/serenissima.js; ligatures as shapes, their stems by the rules), straight into a
straightened five-line staff as fivestaves.py cuts them: 64 rows, 8 to a space, the top line at row 14. Ruled red
(a choirbook) or black (a print), in ink and on paper of many shades, blurred and specked, with words under it.

The label is the staff in CGMensural's text form (js/mensural.js): c4 O B5 Sb6 [B5 L2] [B5~B3]* rB4 .5 b6 +5 |

    python -I training/mensuralsynth.py --text breviarium.txt --count 20000 [--out training/data/mens] [--seed 1]

Writes <out>/NNNNNN.jpg and <out>/labels.jsonl ({file, text, tokens}: the text form, and its tokens, as recognizer.py
learns them)."""
import argparse, glob, json, os, random, re, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lines as L

HEIGHT, SPACE, TOP5 = 64, 8, 14
S = 3                                                       # (drawn at three times the size, then shrunk)
VALUES = ['Mx', 'L', 'B', 'Sb', 'M', 'Sm', 'F', 'Sf']
HAS_STEM = {'Mx': 'down', 'L': 'down', 'M': 'up', 'Sm': 'up', 'F': 'up', 'Sf': 'up'}
ROMAN = [p for p in glob.glob('/usr/share/fonts/truetype/*/*.ttf') if any(k in p for k in ('LiberationSerif-Regular', 'LiberationSerif-Italic', 'FreeSerif.ttf', 'DejaVuSerif.ttf'))]


def signs():
    """js/serenissima.js's outlines: {name: [polygons, each [(x, y) in spaces]]}, and each one's ink extent."""
    src = open(os.path.join(HERE, '..', 'js', 'serenissima.js'), encoding='utf-8').read()
    table = json.loads(src[src.index('CGSerenissima = ') + 16: src.rindex(';\n})')])
    out = {}
    for k, v in table.items():
        polys = [[tuple(map(float, q.split())) for q in c.split('L')] for c in re.findall(r'M([^MZ]+)Z', v['d'])]
        out[k] = (polys, v['x0'], v['x1'])
    return out


# ---------------------------------------------------------------- the text form (as js/mensural.js writes it)
def text(items):
    def one(it):
        k = it['k']
        if k == 'clef': return it['shape'].lower() + str(it['line'])
        if k == 'sign': return it['sign'] + ('.' if it.get('dot') else '') + ('|' if it.get('stroke') else '')
        if k == 'num': return it['text']
        if k == 'note': return it['v'] + str(it['p']) + ({'down': 'v', 'up': '^'}[it['stem']] if it.get('stem') else '') + ('*' if it.get('color') == 'black' else '')
        if k == 'rest': return 'r' + it['v'] + ('p' if it.get('perf') else '') + str(it['p'])
        if k == 'lig':
            ns = it['notes']
            return '[' + ''.join(n['v'] + str(n['p']) + ('~' if n.get('obl') and i < len(ns) - 1 else ' ') for i, n in enumerate(ns)).strip() + ']' + ('*' if it.get('color') == 'black' else '')
        if k == 'dot': return '.' + str(it['p'])
        if k == 'acc': return it['a'] + str(it['p'])
        if k == 'custos': return '+' + str(it['p'])
        if k == 'bar': return '|' * {'single': 1, 'double': 2, 'end': 3}[it['form']]
    return ' '.join(one(it) for it in items)


def tokens(t):
    """The text form's tokens, as the reader will learn them: each item, a ligature's brackets and joins apart."""
    return re.findall(r'\]\*|\[|\]|~|[^\s\[\]~]+', t)


# ---------------------------------------------------------------- the rules of ligatures (as js/mensural.js ligRules)
def lig_stems(notes):
    n = len(notes)
    stems = [[] for _ in notes]
    up = lambda i: notes[i + 1]['p'] > notes[i]['p']
    f = notes[0]
    if f['v'] == 'Sb': stems[0].append('upLeft')
    elif f['v'] == 'B' and not up(0): stems[0].append('downLeft')
    elif f['v'] == 'L' and up(0): stems[0].append('downRight')
    last, desc = notes[-1], notes[-1]['p'] < notes[-2]['p']
    if not (n == 2 and f['v'] == 'Sb') and last['v'] == 'L' and not desc: stems[-1].append('downRight')
    for i in range(1, n - 1):
        if notes[i]['v'] == 'L': stems[i].append('downRight')
    return stems


def make_lig(rng, p0, lo, hi):
    """A ligature of two to four notes the rules can write, from about p0."""
    n = rng.choice([2, 2, 2, 3, 3, 4])
    ps = [p0]
    for _ in range(n - 1):
        q = ps[-1] + rng.choice([-3, -2, -1, -1, 1, 1, 2, 3])
        ps.append(max(lo, min(hi, q)) if q != ps[-1] else q + 1)
    cop = rng.random() < 0.2
    vals = ['B'] * n
    if cop: vals[0] = vals[1] = 'Sb'
    elif rng.random() < 0.35: vals[0] = 'L'
    for i in range(1 if not cop else 2, n - 1):
        if rng.random() < 0.05: vals[i] = 'Mx'
    desc = ps[-1] < ps[-2]
    obl = [False] * n
    if not (n == 2 and cop):
        if rng.random() < 0.55: vals[-1] = 'L'                   # (perfection)
        if vals[-1] == 'B' and desc: obl[-2] = True               # (a descending last breve is oblique)
        if vals[-1] == 'L' and desc: obl[-2] = False
        if vals[-1] == 'B' and not desc: obl[-2] = False
    for i in range(0, n - 2):
        if not obl[i] and not (i > 0 and obl[i - 1]) and not obl[i + 1] and ps[i + 1] < ps[i] and rng.random() < 0.15: obl[i] = True   # (obliques descend, one at a time)
    notes = [dict(v=v, p=p, **({'obl': True} if o else {})) for v, p, o in zip(vals, ps, obl)]
    return {'k': 'lig', 'notes': notes}


def compose(rng, length):
    """A staff's items: a clef, perhaps a signature and a sign, then the music."""
    shape, line = rng.choice([('C', 1), ('C', 2), ('C', 3), ('C', 4), ('C', 4), ('C', 3), ('F', 3), ('F', 4), ('F', 4), ('F', 5), ('G', 2)])
    items = [{'k': 'clef', 'shape': shape, 'line': line}]
    # (the B of the clef, flat, now and then: its staff position, under this clef)
    if rng.random() < 0.25:
        at = 2 * (line - 1)
        bpos = at + {'C': -1, 'F': 3, 'G': 2}[shape]
        while bpos < 0: bpos += 7
        while bpos > 8: bpos -= 7
        items.append({'k': 'acc', 'a': 'b', 'p': bpos})
    if rng.random() < 0.45:
        sign = rng.choice(['C', 'C', 'O', 'O', 'R'])
        items.append(dict({'k': 'sign', 'sign': sign}, **({'dot': True} if rng.random() < 0.2 else {}), **({'stroke': True} if rng.random() < 0.35 else {})))
    lo, hi = -2, 10
    p = rng.randint(1, 7)
    wv = [('Mx', .005), ('L', .04), ('B', .14), ('Sb', .30), ('M', .27), ('Sm', .15), ('F', .04), ('Sf', .005)]
    vals, weights = zip(*wv)
    black = 0
    while len(items) < length:
        r = rng.random()
        step = rng.choices([0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5], [12, 22, 22, 10, 10, 6, 6, 3, 3, 1, 1])[0]
        p = max(lo, min(hi, p + step))
        if p < 0 and rng.random() < 0.5: p += 2
        if p > 8 and rng.random() < 0.5: p -= 2
        if r < 0.07:
            v = rng.choice(['B', 'Sb', 'Sb', 'M', 'M', 'Sm', 'L'])
            rp = {'L': rng.choice([2, 4]), 'B': rng.choice([3, 5]), 'Sb': rng.choice([4, 6]), 'M': rng.choice([4, 2]), 'Sm': rng.choice([2, 4])}[v]
            items.append(dict({'k': 'rest', 'v': v, 'p': rp}, **({'perf': True} if v == 'L' and rng.random() < 0.3 else {})))
            continue
        if r < 0.14:
            lig = make_lig(rng, p, lo + 1, hi - 1)
            if rng.random() < 0.08: lig['color'] = 'black'
            items.append(lig); p = lig['notes'][-1]['p']
            continue
        if r < 0.17:
            items.append({'k': 'acc', 'a': rng.choice(['b', 'b', '#', 'n']), 'p': p})
        v = rng.choices(vals, weights)[0]
        note = {'k': 'note', 'v': v, 'p': p}
        if black or rng.random() < 0.03: black = black - 1 if black else rng.randint(1, 3); note['color'] = 'black' if v not in ('Sm', 'F', 'Sf') else note.get('color')
        if note.get('color') is None: note.pop('color', None)
        if v in HAS_STEM and rng.random() < (0.35 if (HAS_STEM[v] == 'up' and p >= 6) else 0.04):
            note['stem'] = 'down' if HAS_STEM[v] == 'up' else 'up'
        items.append(note)
        if v in ('Sb', 'M', 'B') and rng.random() < 0.08: items.append({'k': 'dot', 'p': p if p % 2 else p + 1})
        if rng.random() < 0.01: items.append({'k': 'num', 'text': rng.choice(['3', '3/2', '2'])})
    end = rng.random()
    if end < 0.65: items.append({'k': 'custos', 'p': max(lo + 1, min(hi - 1, p + rng.choice([-2, -1, 0, 1, 2])))})
    elif end < 0.85: items.append({'k': 'bar', 'form': rng.choice(['single', 'double', 'double', 'end'])})
    return items


# ---------------------------------------------------------------- drawing
BLOCK, OBL, HIGH, STEM, PEN = 1.07, 2.1, 0.9, 3.0, 0.13


def draw_staff(items, rng, sg, words, style):
    sp = SPACE * S                                          # (a space, drawn)
    y = lambda p: (TOP5 + 4 * SPACE) * S - p * sp / 2       # (a staff position's row, drawn)
    gap = lambda: rng.uniform(0.35, 1.3) * sp
    # where each item goes, and how wide it is
    W = int((24 + 2.2 * SPACE * len(items) * 1.4) * S)
    ink = np.zeros((HEIGHT * S, W), np.uint8)               # (what is ink: drawn into, then coloured)
    im = Image.fromarray(ink); d = ImageDraw.Draw(im)
    def poly(pts, fill=True, width=1):
        if fill: d.polygon(pts, fill=255)
        else: d.line(pts + [pts[0]], fill=255, width=max(1, int(width)))
    def sign(name, x, p, flip=False):
        polys, x0, x1 = sg[name]
        mask = Image.new('L', im.size, 0); md = ImageDraw.Draw(mask)
        acc = np.zeros(ink.shape, bool)
        for c in polys:                                     # (even-odd: each contour flips what it covers)
            mask.paste(0, (0, 0, *im.size)); md.polygon([((x + ((x0 + x1) - u if flip else u) * sp), y(p) + v * sp) for u, v in c], fill=255)
            acc ^= np.asarray(mask) > 0
        a = np.asarray(im).copy(); a[acc] = 255; im.paste(Image.fromarray(a))
        return x + (x1 + 0.1) * sp
    x = rng.uniform(1.0, 4.0) * sp
    lw = PEN * sp
    for it in items:
        k = it['k']
        if k == 'clef': x = sign('clef' + it['shape'], x, 2 * (it['line'] - 1))
        elif k == 'note':
            stem = it.get('stem') or HAS_STEM.get(it['v'])
            v = it['v']
            if it.get('color') == 'black':
                key = {'L': 'kL', 'B': 'kB', 'Sb': 'kSb', 'M': 'Sm', 'Sm': 'F', 'F': 'Sf', 'Sf': 'Sf'}.get(v)
                key = key + '.' + (stem or 'up') if key in ('kL', 'Sm', 'F', 'Sf') else key
            else: key = v + ('.' + stem if stem else '')
            if key and key in sg: x = sign(key, x, it['p'])
            else:                                           # (a black maxima: a block, its stem down)
                yy, h = y(it['p']), HIGH * sp / 2
                d.rectangle([x + 0.3 * sp, yy - h, x + (0.3 + 2 * BLOCK) * sp, yy + h], fill=255)
                d.line([(x + (0.3 + 2 * BLOCK) * sp, yy), (x + (0.3 + 2 * BLOCK) * sp, yy + STEM * sp)], fill=255, width=int(lw))
                x += (0.6 + 2 * BLOCK) * sp
        elif k == 'rest':
            key = 'rLp' if it['v'] == 'L' and it.get('perf') else {'Mx': 'rL', 'L': 'rL', 'B': 'rB', 'Sb': 'rSb', 'M': 'rM', 'Sm': 'rSm', 'F': 'rF', 'Sf': 'rF'}[it['v']]
            x = sign(key, x, it['p'])
        elif k == 'acc':
            if it['a'] == 'n':
                yy = y(it['p']); a, b = x + 0.35 * sp, x + 0.95 * sp
                d.line([(a, yy - 1.3 * sp), (a, yy + 0.45 * sp), (b, yy + 0.25 * sp)], fill=255, width=int(lw))
                d.line([(b, yy + 1.3 * sp), (b, yy - 0.45 * sp), (a, yy - 0.25 * sp)], fill=255, width=int(lw))
                x += 1.2 * sp
            else: x = sign('flat' if it['a'] == 'b' else 'sharp', x, it['p'])
        elif k == 'custos': x = sign('custos', x, it['p'])
        elif k == 'dot': x = sign('dot', x - 0.3 * sp, it['p'])
        elif k == 'num':
            F = ImageFont.truetype(rng.choice(ROMAN), int(1.7 * sp))
            d.text((x, y(4)), it['text'], font=F, fill=255, anchor='lm'); x += F.getlength(it['text']) + 0.3 * sp
        elif k == 'bar':
            n = {'single': 1, 'double': 2, 'end': 3}[it['form']]
            for j in range(n): d.line([(x + j * 0.35 * sp, y(8)), (x + j * 0.35 * sp, y(0))], fill=255, width=int(lw * (1.6 if j == n - 1 and n == 3 else 1)))
            x += (0.6 + 0.35 * n) * sp
        elif k == 'sign':
            key = ('signO' if it['sign'] == 'O' else 'signC') + ('stroke' if it.get('stroke') else '')
            x1 = sign(key, x, 4, it['sign'] == 'R')
            if it.get('dot'):
                cx, cy, r = (x + x1 - 0.1 * sp) / 2, y(4), 0.14 * sp
                d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
            x = x1
        elif k == 'lig': x = ligature(it, x + 0.2 * sp, y, sp, d, lw)
        x += gap()
    W2 = int(min(W, x + rng.uniform(0.5, 2) * sp))
    notes = np.asarray(im)[:, :W2]
    # the staff's lines (red, brown or black), with ledger lines where notes stand beyond them; and words
    choir = style == 'choirbook'
    lines = Image.new('L', (W2, HEIGHT * S), 0); ld = ImageDraw.Draw(lines)
    lwid = max(1, int(S * (rng.uniform(.9, 1.6) if choir else rng.uniform(.4, .8))))
    for k in range(5):
        yy = (TOP5 + k * SPACE + rng.uniform(-.3, .3)) * S
        ld.line([(0, yy), (W2, yy + rng.uniform(-.6, .6) * S)], fill=255, width=lwid)
    text = Image.new('L', (W2, HEIGHT * S), 0); td = ImageDraw.Draw(text)
    if words and rng.random() < 0.8:
        G = ImageFont.truetype(rng.choice(ROMAN), int(rng.uniform(1.3, 1.8) * sp))
        wx = rng.uniform(0, 30) * S
        while wx < W2:
            w = rng.choice(words)
            if rng.random() < 0.15: w = w.capitalize()
            td.text((wx, (TOP5 + 4 * SPACE + rng.uniform(4, 7)) * S), w, font=G, fill=255, anchor='lt')
            wx += G.getlength(w) + rng.uniform(4, 30) * S
    # colour: paper, then lines, then ink
    paper = np.array([rng.uniform(200, 240), rng.uniform(185, 225), rng.uniform(150, 205)])
    if style == 'print': paper = np.array([rng.uniform(215, 245)] * 3) - np.array([0, rng.uniform(0, 8), rng.uniform(5, 25)])
    line_col = np.array([rng.uniform(150, 215), rng.uniform(40, 95), rng.uniform(35, 85)]) if choir else np.array([rng.uniform(20, 90)] * 3)
    ink_col = np.array([rng.uniform(5, 50)] * 3) + np.array([rng.uniform(0, 25), rng.uniform(0, 12), 0])
    a = np.ones((HEIGHT * S, W2, 3)) * paper
    for layer, col, alpha in ((np.asarray(lines), line_col, 0.95), (np.asarray(text), ink_col, 0.9), (notes, ink_col, 1.0)):
        m = (layer.astype(np.float32) / 255)[..., None] * alpha
        a = a * (1 - m) + col * m
    out = Image.fromarray(a.clip(0, 255).astype(np.uint8)).resize((W2 // S, HEIGHT), Image.LANCZOS).convert('L')
    g = np.asarray(out, np.float32)
    g = g * (1 + np.random.default_rng(rng.randrange(1 << 30)).normal(0, .03, (1, g.shape[1])))
    out = Image.fromarray(g.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rng.uniform(.3, .9)))
    g = np.asarray(out, np.float32) + np.random.default_rng(rng.randrange(1 << 30)).normal(0, rng.uniform(2, 7), g.shape)
    return Image.fromarray(g.clip(0, 255).astype(np.uint8))


def ligature(it, x0, y, sp, d, lw):
    """As js/mensural.js draws one: blocks at their pitches, joined; an oblique one slanting block; stems by the rules."""
    notes, black, h = it['notes'], it.get('color') == 'black', HIGH * sp / 2
    cells, x = [], x0
    for i, n in enumerate(notes):
        if i > 0 and notes[i - 1].get('obl'):
            cells.append((cells[i - 1][0] + (OBL - BLOCK) * sp, cells[i - 1][0] + OBL * sp)); x = cells[i][1]; continue
        w = (2 * BLOCK if n['v'] == 'Mx' else BLOCK) * sp
        cells.append((x, x + w)); x += w
    def quad(a, ya, b, yb):
        pts = [(a, ya - h), (b, yb - h), (b, yb + h), (a, ya + h)]
        if black: d.polygon(pts, fill=255)
        else: d.line(pts + [pts[0]], fill=255, width=max(1, int(lw * 1.4)))
    for i, n in enumerate(notes):
        if i > 0 and notes[i - 1].get('obl'): continue
        if n.get('obl') and i + 1 < len(notes): quad(cells[i][0], y(n['p']), cells[i + 1][1], y(notes[i + 1]['p']))
        else: quad(cells[i][0], y(n['p']), cells[i][1], y(n['p']))
    for i in range(len(notes) - 1):
        if notes[i].get('obl') or notes[i]['p'] == notes[i + 1]['p']: continue
        xj = cells[i][1]; d.line([(xj, y(notes[i]['p'])), (xj, y(notes[i + 1]['p']))], fill=255, width=max(1, int(lw)))
    for i, st in enumerate(lig_stems(notes)):
        for kind in st:
            xs = cells[i][0] if 'Left' in kind else cells[i][1]
            yy = y(notes[i]['p']); dy = (-1 if kind.startswith('up') else 1) * STEM * sp
            d.line([(xs, yy), (xs, yy + dy)], fill=255, width=max(1, int(lw)))
    return cells[-1][1]


def main(o):
    rng = random.Random(o.seed)
    sg = signs()
    words = [w for w in ' '.join(L.leaves(o.text).values()).split() if w.isascii() and w.isalpha()] if o.text else []
    os.makedirs(o.out, exist_ok=True)
    with open(os.path.join(o.out, 'labels.jsonl'), 'w', encoding='utf-8') as f:
        for n in range(o.count):
            items = compose(rng, rng.randint(8, 30))
            style = o.style if o.style != 'mixed' else rng.choice(['choirbook', 'choirbook', 'print'])
            im = draw_staff(items, rng, sg, words, style)
            name = f'{n:06d}.jpg'
            im.save(os.path.join(o.out, name), quality=rng.randint(80, 95))
            t = text(items)
            f.write(json.dumps({'file': name, 'text': t, 'tokens': tokens(t)}) + '\n')
            if (n + 1) % 2000 == 0: print(n + 1, flush=True)


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--text', help='words for under the staves (the Nidaros edition, as gothic.py)')
    a.add_argument('--count', type=int, default=20000)
    a.add_argument('--seed', type=int, default=1)
    a.add_argument('--style', default='mixed', choices=['choirbook', 'print', 'mixed'])
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'mens'))
    main(a.parse_args())
