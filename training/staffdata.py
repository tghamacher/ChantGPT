"""Staves for the recognizer: each staff cut out of its page and straightened along its own lines, at one size, with
the tokens it shows.

    python -I training/staffdata.py synth [--pages training/data/synth] [--out training/data/staves]

Each staff becomes a grey image HEIGHT pixels high, SPACE pixels to a space: its top line at row TOP, its bottom line
at row TOP + 3 * SPACE, the rows between following the lines wherever they bend; and the same SPACE pixels to a space
along the staff. The tokens (see tokens()) are what the recognizer learns to read off it. Writes <out>/<page>-<n>.png
and <out>/labels.jsonl ({file, tokens, width}).

The same straightening is done in the app (js/recognizer.js), so that what it reads looks like what it learnt from.
"""
import argparse, json, os, re, sys
import numpy as np
from PIL import Image

SPACE, TOP, HEIGHT = 8, 20, 64          # 2.5 spaces above the top line, 2.5 below the bottom one
LEFT, RIGHT = 0.6, 0.4                  # spaces before the staff's start and after its end

LETTERS = 'abcdefghijklm'
SHAPES = 'vVoOwsr'                      # virga, reversed virga, oriscus, reversed oriscus, quilisma, stropha, cavum
LIQ = '~<>'


def kind(g):
    """As js/chant.js says what a GABC group is."""
    if re.fullmatch(r'[cf]b?[1-5]', g): return 'clef'
    if re.fullmatch(r'[a-mA-M]\+', g): return 'custos'
    if re.fullmatch(r"(::|:\??|;\d?|,\d?|`\d?|\^)['_0-9]*", g) or g in (':', '::', ';', ',', '`'): return 'bar'
    return 'neume'


def bar(g):
    for b in ('::', ':', ';', ',', '`'):
        if g.startswith(b): return b
    return ','


def neume_tokens(g):
    """The tokens of a group of neume material: a token for each note (its letter, upper case for an inclinatum, then
    its shape and liquescence), each accidental (its letter and x, y or #), each mora (.), episema (_) and ictus (');
    / between glyphs."""
    out, i, n = [], 0, len(g)
    while i < n:
        c = g[i]
        if c.lower() in LETTERS:
            if i + 1 < n and g[i + 1] in 'xy#':
                out.append(c.lower() + g[i + 1]); i += 2
                while i < n and g[i] in '#?': i += 1
                continue
            i += 1
            mods = ''
            while i < n and g[i] in SHAPES + LIQ + 'q':
                mods += g[i]; i += 1
            shape = next((m for m in mods if m in SHAPES), '')
            liq = next((m for m in mods if m in LIQ), '')
            # a bivirga or a tristropha: the same note again
            reps = max(1, mods.count(shape)) if shape in 'vs' and shape else 1
            for k in range(reps): out.append(c + shape + (liq if k == reps - 1 else ''))
        elif c == '.':
            out.append('.'); i += 1
            while i < n and g[i] in '.0123': i += 1
        elif c == '_':
            out.append('_'); i += 1
            while i < n and g[i] in '_0123456789': i += 1
        elif c == "'":
            out.append("'"); i += 1
            while i < n and g[i] in '0123456789': i += 1
        elif c in '/! ':
            if out and out[-1] != '/': out.append('/')
            i += 1
        else:
            i += 1                       # fusion (@) and what isn't drawn
    while out and out[-1] == '/': out.pop()
    return out


def tokens(items):
    """A staff's tokens, from its items' GABC in order: a clef as itself (c4, cb3), a bar as , ; : :: or `, a custos as
    its letter and +, neume material as neume_tokens(); | between items."""
    out = []
    # (a custos, a bar or a clef written up against other signs, f+::c4, split off them, as js/chant.js does)
    items = [p for g in items for p in ([g] if kind(g) != 'neume' else re.split(r"([a-mA-M]\+|::|:'?|;[0-9]?|,[0-9]?|`)", g)) if p]
    for g in items:
        k = kind(g)
        t = [g] if k in ('clef', 'custos') else [bar(g)] if k == 'bar' else neume_tokens(g)
        if not t: continue
        if out: out.append('|')
        out.extend(t)
    return out


def straighten(gray, lines):
    """A staff (lines: four polylines [x0, y0, x1, y1, …] in the image's pixels) cut out and straightened: HEIGHT rows,
    SPACE pixels to a space; the columns along the staff from LEFT spaces before it to RIGHT after."""
    xs = [np.array(l[0::2], float) for l in lines]
    ys = [np.array(l[1::2], float) for l in lines]
    mid = (xs[0][0] + xs[0][-1]) / 2                       # the spacing, at the staff's middle (as js/recognizer.js)
    g = float(np.interp(mid, xs[3], ys[3]) - np.interp(mid, xs[0], ys[0])) / 3
    x0, x1 = xs[0][0] - LEFT * g, xs[0][-1] + RIGHT * g
    W = max(1, int(round((x1 - x0) / g * SPACE)))
    cx = x0 + (np.arange(W) + 0.5) * g / SPACE
    top, bot = np.interp(cx, xs[0], ys[0]), np.interp(cx, xs[3], ys[3])
    v = (np.arange(HEIGHT) + 0.5 - TOP) / (3 * SPACE)
    py = top[None, :] + v[:, None] * (bot - top)[None, :]
    px = np.broadcast_to(cx[None, :], py.shape)
    return bilinear(gray, px, py)


def bilinear(img, px, py):
    h, w = img.shape
    x0 = np.clip(np.floor(px).astype(int), 0, w - 2); y0 = np.clip(np.floor(py).astype(int), 0, h - 2)
    fx = np.clip(px - x0, 0, 1); fy = np.clip(py - y0, 0, 1)
    a = img[y0, x0] * (1 - fx) + img[y0, x0 + 1] * fx
    b = img[y0 + 1, x0] * (1 - fx) + img[y0 + 1, x0 + 1] * fx
    out = a * (1 - fy) + b * fy
    out[(px < 0) | (px > w - 1) | (py < 0) | (py > h - 1)] = 255
    return np.clip(out, 0, 255).astype(np.uint8)


def synth(pages, out):
    os.makedirs(out, exist_ok=True)
    names = sorted(f[:-5] for f in os.listdir(pages) if f.startswith('synth-') and f.endswith('.json'))
    n = 0
    with open(os.path.join(out, 'labels.jsonl'), 'w', encoding='utf-8') as lab:
        for name in names:
            with open(os.path.join(pages, name + '.json'), encoding='utf-8') as f: j = json.load(f)
            gray = np.asarray(Image.open(os.path.join(pages, name + '.jpg')).convert('L'), dtype=np.float32)
            for st in j['doc']['pages'][0]['staves']:
                items = [it['g'] for syl in st['syllables'] for it in syl['items']]
                img = straighten(gray, st['lines'])
                file = f'{name}-{st["id"]}.png'
                Image.fromarray(img).save(os.path.join(out, file), optimize=True)
                lab.write(json.dumps({'file': file, 'tokens': tokens(items), 'width': img.shape[1]}) + '\n')
                n += 1
    print(f'{n} staves from {len(names)} pages -> {out}')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('what', choices=['synth'])
    a.add_argument('--pages', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'synth'))
    a.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'staves'))
    o = a.parse_args()
    synth(o.pages, o.out)
