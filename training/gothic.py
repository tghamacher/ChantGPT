"""Lines of Gothic type made up, for the text reader to learn the letters of a book like the Nidaros Breviary (1519)
before it reads the book's own lines: the edition's text, in pieces, set in a blackletter font with the print's commonest
abbreviations (a stroke for m or n, dñs, & for et, q; for que), its long s and r rotunda, a stop or colon here and there
and a hyphen where a line breaks a word; neighbouring lines above and below as a strip has them; paper, ink, blur and
noise varied; cut and scaled as lines.py cuts the book's lines. The label: the words as the edition spells them.

    python -I training/gothic.py --text breviarium.txt --fonts DIR --count 40000 [--out training/data/gothic]

DIR: .ttf fonts (UnifrakturMaguntia, UnifrakturCook, Grenze Gotisch, Texturina, Pirata One: Google Fonts, OFL), and
DejaVuSans.ttf or another with ℟ ℣ for those. Writes <out>/NNNNNN.png and <out>/labels.jsonl ({file, text})."""
import argparse, glob, json, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lines as L

MACRON = dict(zip('aeiou', 'āēīōū'))
NAMES = {'dominus': 'dñs', 'domine': 'dñe', 'domini': 'dñi', 'domino': 'dño', 'dominum': 'dñm', 'deus': 'deꝰ',
         'sanctus': 'sctūs', 'sancti': 'sctī', 'gloria': 'glꝛia', 'christus': 'xp̄s', 'christi': 'xp̄i'}


def shown(word, rng, long_s, rot_r):
    """How a word might be printed: its letters, abbreviated now and then."""
    low = word.lower()
    if word == 'Ⱥ': return 'ā'
    if word == 'Ꝯ': return '9'
    if word in ('℟', '℣'): return word
    if low in NAMES and rng.random() < .6: return NAMES[low].replace('ꝛ', 'ꝛ' if rot_r else 'o')
    if low == 'et' and rng.random() < .5: return '&'
    out = word
    if out.endswith('que') and len(out) > 4 and rng.random() < .3: out = out[:-3] + 'q;'
    s = list(out)
    for i in range(len(s) - 1):                                 # (a vowel's stroke for the m or n after it)
        if s[i] in MACRON and s[i + 1] in 'mn' and (i + 2 == len(s) or s[i + 2] not in 'aeiouy') and rng.random() < .45:
            s[i], s[i + 1] = MACRON[s[i]], ''
    out = ''.join(s)
    if long_s: out = ''.join('ſ' if c == 's' and k + 1 < len(out) else c for k, c in enumerate(out))
    if rot_r: out = ''.join('ꝛ' if c == 'r' and k and out[k - 1] in 'obpdh' else c for k, c in enumerate(out))
    return out


def piece(words, rng, fonts):
    """A run of words about a line long, as printed and as labelled."""
    font = rng.choice(fonts)
    i = rng.randrange(len(words))
    want, show, n = [], [], 0
    target = rng.randint(18, 40)
    while n < target and i < len(words):
        w = words[i]; i += 1
        s = shown(w, rng, font['long_s'], font['rot_r'])
        if rng.random() < .12 and w not in ('℟', '℣'): s += rng.choice('.:/')
        want.append(w); show.append(s); n += len(s) + 1
    if len(want) > 1 and rng.random() < .3 and len(want[-1]) > 4:  # (a word broken at the line's end)
        k = rng.randint(2, len(want[-1]) - 2)
        want[-1], show[-1] = want[-1][:k], want[-1][:k] + rng.choice('=-')
    if rng.random() < .35 and len(want) > 1 and len(want[0]) > 4:  # (the rest of one broken at the line before)
        k = rng.randint(2, len(want[0]) - 2)
        want[0], show[0] = want[0][k:], show[0][max(0, len(show[0]) - (len(want[0]) - k)):]
    return font, ' '.join(want), ' '.join(show)


def draw(text, font, size, other):
    """The line drawn black on white, a ℟ or ℣ in the other font."""
    F, G = ImageFont.truetype(font['path'], size), ImageFont.truetype(other, int(size * .8))
    parts = [(c, G) if c in '℟℣' else (c, F) for c in text]
    W = int(sum(f.getlength(c) for c, f in parts)) + size
    im = Image.new('L', (W, size * 2), 255)
    d, x = ImageDraw.Draw(im), size // 4
    for c, f in parts:
        d.text((x, size // 2), c, font=f, fill=0); x += f.getlength(c)
    return im


def make(words, rng, fonts, other):
    font, want, show = piece(words, rng, fonts)
    size = 48
    main = np.asarray(draw(show, font, size, other)) < 128
    xs = np.where(main.any(0))[0]
    if len(xs) < 10: return None
    x0, x1 = xs[0], xs[-1] + 1
    rows = main[:, x0:x1].sum(1)
    on = rows > 0.03 * (x1 - x0)
    ys = np.where(on)[0]
    if len(ys) < 5: return None
    y0, y1 = ys[0], ys[-1] + 1                                  # (the line's band, as lines.py's row projection finds it)
    h = y1 - y0
    pitch = h * rng.uniform(1.0, 1.35)
    H = int(h * 6 + size * 2)
    page = np.zeros((H, main.shape[1]), bool)
    mid0 = H // 2
    page[mid0 - y0 - h // 2: mid0 - y0 - h // 2 + main.shape[0]] |= main
    for sgn in (-1, 1):                                         # (the lines above and below)
        if rng.random() < .85:
            _, _, s = piece(words, rng, [font])
            o = np.asarray(draw(s, font, size, other)) < 128
            o = o[:, :main.shape[1]]
            top = int(mid0 - y0 - h // 2 + sgn * pitch)
            a, b = max(0, top), min(H, top + o.shape[0])
            page[a:b, :o.shape[1]] |= o[a - top:b - top]
    bold = rng.choice([0, 0, 3]) if font['thin'] else rng.choice([0, 0, 0, 3])
    im = Image.fromarray(np.where(page, 0, 255).astype(np.uint8))
    if bold: im = im.filter(ImageFilter.MinFilter(bold))
    paper, inkv = rng.uniform(150, 225), rng.uniform(15, 80)
    if rng.random() < .15: inkv = rng.uniform(80, 120)          # (red, in grey)
    a = np.asarray(im, np.float32) / 255
    a = inkv + a * (paper - inkv)
    a += np.asarray(Image.fromarray(np.random.default_rng(rng.randrange(1 << 30)).normal(0, 1, (8, 8)).astype(np.float32)).resize((a.shape[1], a.shape[0]), Image.BICUBIC)) * rng.uniform(0, 12)
    im = Image.fromarray(a.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rng.uniform(.4, 1.6)))
    mid, cy = mid0, mid0
    top, bot = int(max(0, cy - 0.7 * h)), int(min(H, cy + 0.7 * h))
    top += rng.randint(-2, 2); bot += rng.randint(-2, 2)
    cut = im.crop((max(0, x0 - rng.randint(0, 4)), top, x1 + rng.randint(0, 4), bot))
    s = L.HEIGHT / max(1, bot - top)
    cut = cut.resize((max(8, int(cut.width * s * L.SQUEEZE * rng.uniform(.9, 1.1))), L.HEIGHT), Image.BILINEAR)
    a = np.asarray(cut, np.float32) + np.random.default_rng(rng.randrange(1 << 30)).normal(0, rng.uniform(2, 10), (cut.height, cut.width))
    return Image.fromarray(a.clip(0, 255).astype(np.uint8)), want


def main(o):
    text = L.leaves(o.text)
    words = ' '.join(text[k] for k in sorted(text)).split()
    fonts = []
    for p in sorted(glob.glob(os.path.join(o.fonts, '*.ttf'))):
        name = os.path.basename(p).lower()
        if 'dejavu' in name or 'jacquard' in name: continue
        F = ImageFont.truetype(p, 40)
        tofu = bytes(F.getmask('\uffff'))
        has = lambda c: F.getmask(c).getbbox() is not None and bytes(F.getmask(c)) != tofu
        fonts.append({'path': p, 'long_s': has('ſ'), 'rot_r': has('ꝛ'), 'thin': 'texturina' in name or 'grenze' in name})
    other = glob.glob(os.path.join(o.fonts, 'DejaVuSans.ttf')) or glob.glob('/usr/share/fonts/**/DejaVuSans.ttf', recursive=True)
    os.makedirs(o.out, exist_ok=True)
    rng = random.Random(o.seed)
    with open(os.path.join(o.out, 'labels.jsonl'), 'w', encoding='utf-8') as f:
        n = 0
        while n < o.count:
            r = make(words, rng, fonts, other[0])
            if not r or not r[1].strip(): continue
            name = f'{n:06d}.png'
            r[0].save(os.path.join(o.out, name))
            f.write(json.dumps({'file': name, 'text': r[1]}, ensure_ascii=False) + '\n'); n += 1
            if n % 5000 == 0: print(n, flush=True)


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--text', required=True)
    a.add_argument('--fonts', required=True)
    a.add_argument('--count', type=int, default=40000)
    a.add_argument('--seed', type=int, default=1)
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'gothic'))
    main(a.parse_args())
