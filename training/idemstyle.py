"""Synthetic mensural staves in the look of real pages (the IDEM database's choirbooks, as the Occo Codex: an Alamire
workshop's hand on parchment), for the reader to get used to it before it has labels for it: the pages' own parchment,
their ink's colour, their lines' weight and their staves' size measured; then staves of music drawn as
mensuralsynth.py draws them (EMS Serenissima's signs, ligatures by the rules), in that ink and with lines of that
weight, onto the pages' parchment (cut from between and around their staves, scaled so a space is 8 pixels, as the
reader's strips have it), blurred and grained as the photographs are. The music: the labels of staves already made
(mensjrp: the Josquin Research Project's music; mens5: made up), so nothing is fetched.

    python -I training/idemstyle.py measure --pages training/data/scans/occo [--out training/data/idemstyle]
    python -I training/idemstyle.py staves --style training/data/idemstyle --music training/data/mensjrp,training/data/mens5 \\
        --count 20000 [--out training/data/mensidem] [--seed 21]

measure writes <out>/style.json (each page's ink, line colour and weight, a space's pixels) and <out>/parchment-NNN.png
(pieces of parchment with no writing on them, a space 8 pixels); staves writes <out>/NNNNNN.jpg and labels.jsonl, as
mensuralsynth.py does. The pages are only read: nothing of them is kept but bare parchment and a few numbers."""
import argparse, glob, json, os, random, re, sys
import numpy as np
from PIL import Image, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mensuralsynth as M, fivestaves as F

SPACE = 8                                                   # (a space in the reader's strips, in pixels)


# ---------------------------------------------------------------- measuring the pages
def measure_page(path, rng, pieces, want):
    """A page's look: (ink RGB, line RGB, line weight in a space's eighths, a space in pixels), and pieces of its
    parchment added to pieces; None if no staff is found on it."""
    gray, staves = F.page(path)
    if not staves: return None
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    H, W, _ = rgb.shape
    g = float(np.median([gg for _, gg in staves]))
    lum = rgb.mean(2)
    paper = float(np.percentile(lum, 75))
    # the ink: the darkest pixels within the staves' bands, not the lines (their notes)
    inks, lines_rgb, weights = [], [], []
    for lines, gg in staves:
        xa, xb = int(lines[0][0]), int(lines[0][-2])
        for k, l in enumerate(lines):
            for x in np.linspace(xa + 0.1 * (xb - xa), xb - 0.1 * (xb - xa), 12).astype(int):
                y = int(round(F.y_at(l, x)))
                col = lum[max(0, y - int(gg / 3)):min(H, y + int(gg / 3) + 1), x]
                if not len(col): continue
                dark = col < (paper + col.min()) / 2
                if dark.sum() and dark.sum() < gg / 2:      # (a line here, not a note on it)
                    weights.append(dark.sum() / gg * 8)
                    lines_rgb.append(rgb[max(0, y - int(gg / 3)) + int(np.argmin(col)), x])
        ya, yb = int(min(lines[0][1::2]) - gg), int(max(lines[4][1::2]) + gg)
        band = lum[max(0, ya):min(H, yb), max(0, xa):min(W, xb)]
        if band.size:
            cut = np.percentile(band, 3)
            sel = rgb[max(0, ya):min(H, yb), max(0, xa):min(W, xb)][band <= cut]
            if len(sel): inks.append(np.median(sel, 0))
    if not inks or not lines_rgb: return None
    # parchment: windows of a staff's size (scaled so a space is 8 pixels) with nothing written on them
    k = SPACE / g
    small = Image.open(path).convert('RGB').resize((max(1, int(W * k)), max(1, int(H * k))), Image.LANCZOS)
    a = np.asarray(small).astype(np.float32)
    l2 = a.mean(2)
    blank = l2 > paper - 45                                  # (nothing written: within a little of the parchment)
    tries = 0
    hh, ww = M.HEIGHT, 256
    while len(pieces) < want and tries < 400:
        tries += 1
        if l2.shape[0] <= hh or l2.shape[1] <= ww: break
        y, x = rng.randrange(0, l2.shape[0] - hh), rng.randrange(0, l2.shape[1] - ww)
        win = l2[y:y + hh, x:x + ww]
        if blank[y:y + hh, x:x + ww].mean() > 0.995 and win.mean() > 0.6 * paper and win.std() < 18:
            pieces.append(a[y:y + hh, x:x + ww].astype(np.uint8))
    return ([round(float(v), 1) for v in np.median(inks, 0)], [round(float(v), 1) for v in np.median(lines_rgb, 0)],
            round(float(np.median(weights)), 2) if weights else 1.0, round(g, 2))


def measure(o):
    F.N, F.DARK, F.NEAR, F.EVEN = 5, True, 0.3, 0.4              # (ruled in ink, by hand: as cmme.py pair finds Occo's)
    os.makedirs(o.out, exist_ok=True)
    rng = random.Random(o.seed)
    pages = sorted(p for d in o.pages.split(',') for p in glob.glob(os.path.join(d, '*.jp*g')) + glob.glob(os.path.join(d, '*.png')))
    rng.shuffle(pages)
    looks, pieces = [], []
    for p in pages[:o.limit]:
        got = measure_page(p, rng, pieces, len(pieces) + o.per_page)
        if got: looks.append({'page': os.path.basename(p), 'ink': got[0], 'line': got[1], 'weight': got[2], 'space': got[3]})
        print(os.path.basename(p), got, f'({len(pieces)} pieces of parchment)', flush=True)
    for i, a in enumerate(pieces): Image.fromarray(a).save(os.path.join(o.out, f'parchment-{i:04d}.png'))
    json.dump({'pages': looks}, open(os.path.join(o.out, 'style.json'), 'w'), indent=1)
    print(f'{len(looks)} pages measured, {len(pieces)} pieces of parchment -> {o.out}')


# ---------------------------------------------------------------- the staves
VAL = '(Mx|Sb|Sm|Sf|L|B|M|F)'
def items_of(text):
    """CGMensural's text form as mensuralsynth's items (as js/mensural.js parse)."""
    out = []
    for t in re.findall(r'\[[^\]]*\]\*?|\S+', text):
        if t.startswith('['):
            body, whole = (t[1:-2], True) if t.endswith(']*') else (t[1:-1], False)
            notes = []
            for part in body.split():
                bits = part.split('~')
                for j, q in enumerate(bits):
                    m = re.fullmatch(VAL + r'(-?\d+)(\*?)', q)
                    if not m: return None
                    n = {'v': m.group(1), 'p': int(m.group(2))}
                    if j < len(bits) - 1: n['obl'] = True
                    if m.group(3): n['color'] = 'black'
                    notes.append(n)
            out.append(dict({'k': 'lig', 'notes': notes}, **({'color': 'black'} if whole else {})))
            continue
        m = re.fullmatch(r'([cfg])([1-5])', t)
        if m: out.append({'k': 'clef', 'shape': m.group(1).upper(), 'line': int(m.group(2))}); continue
        m = re.fullmatch(r'([OCR])(\.?)(\|?)', t)
        if m: out.append(dict({'k': 'sign', 'sign': m.group(1)}, **({'dot': True} if m.group(2) else {}), **({'stroke': True} if m.group(3) else {}))); continue
        if re.fullmatch(r'\d+(/\d+)?', t): out.append({'k': 'num', 'text': t}); continue
        m = re.fullmatch(VAL + r'(-?\d+)([v^]?)(\*?)', t)
        if m: out.append(dict({'k': 'note', 'v': m.group(1), 'p': int(m.group(2))}, **({'stem': 'down' if m.group(3) == 'v' else 'up'} if m.group(3) else {}), **({'color': 'black'} if m.group(4) else {}))); continue
        m = re.fullmatch(r'r' + VAL + r'(p?)(-?\d+)', t)
        if m: out.append(dict({'k': 'rest', 'v': m.group(1), 'p': int(m.group(3))}, **({'perf': True} if m.group(2) else {}))); continue
        m = re.fullmatch(r'\.(-?\d+)', t)
        if m: out.append({'k': 'dot', 'p': int(m.group(1))}); continue
        m = re.fullmatch(r'([bn#])(-?\d+)', t)
        if m: out.append({'k': 'acc', 'a': m.group(1), 'p': int(m.group(2))}); continue
        m = re.fullmatch(r'\+(-?\d+)', t)
        if m: out.append({'k': 'custos', 'p': int(m.group(1))}); continue
        if re.fullmatch(r'\|{1,3}', t): out.append({'k': 'bar', 'form': {1: 'single', 2: 'double', 3: 'end'}[len(t)]}); continue
        return None
    return out


def staves(o):
    rng = random.Random(o.seed)
    style = [v for v in json.load(open(os.path.join(o.style, 'style.json')))['pages'] if sum(v['ink']) / 3 < 160]   # (a page whose 'ink' is near its parchment: mis-measured)
    pieces = [np.asarray(Image.open(p).convert('RGB')).astype(np.float32) for p in sorted(glob.glob(os.path.join(o.style, 'parchment-*.png')))]
    if not style or not pieces: raise SystemExit(f'nothing measured in {o.style}: run measure first')
    music = []
    for d in o.music.split(','):
        for l in open(os.path.join(d, 'labels.jsonl'), encoding='utf-8'):
            it = items_of(json.loads(l)['text'])
            if it: music.append(it)
    sg = M.signs()
    words = M.WORDS if hasattr(M, 'WORDS') else ['Kyrie', 'eleison', 'Christe', 'Gloria', 'Sanctus', 'Agnus', 'Dei', 'miserere', 'nobis', 'Dominus', 'Deus', 'tecum']
    os.makedirs(o.out, exist_ok=True)
    with open(os.path.join(o.out, 'labels.jsonl'), 'w', encoding='utf-8') as f:
        for n in range(o.count):
            look = rng.choice(style)
            items = M.flip_stems(rng.choice(music), rng)
            jitter = lambda c, d: [max(0, min(255, v + rng.uniform(-d, d))) for v in c]
            strip = M.draw_staff(items, rng, sg, words, 'choirbook', color=True, paper=(255, 255, 255),
                                 line_col=jitter(look['line'], 15), ink_col=jitter(look['ink'], 12), line_w=max(0.3, look['weight'] * rng.uniform(0.8, 1.25)))   # (weight: pixels at 8 to a space)
            strip = strip.resize((max(1, strip.width // M.S), M.HEIGHT), Image.LANCZOS)
            a = np.asarray(strip).astype(np.float32) / 255
            # the parchment under it: pieces side by side as long as the staff, each turned or flipped now and then
            bg, x = np.zeros_like(a), 0
            while x < a.shape[1]:
                pc = rng.choice(pieces)
                if rng.random() < 0.5: pc = pc[:, ::-1]
                w = min(pc.shape[1], a.shape[1] - x)
                bg[:, x:x + w] = pc[:a.shape[0], :w] / 255
                x += w
            out = (a * bg * 255).mean(2)                     # (ink and lines on the parchment: darkened by both)
            im = Image.fromarray(out.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 0.9)))
            g = np.asarray(im, np.float32) + np.random.default_rng(rng.randrange(1 << 30)).normal(0, rng.uniform(1.5, 5), (im.height, im.width))
            name = f'{n:06d}.jpg'
            Image.fromarray(g.clip(0, 255).astype(np.uint8)).save(os.path.join(o.out, name), quality=rng.randint(80, 95))
            t = M.text(items)
            f.write(json.dumps({'file': name, 'text': t, 'tokens': M.tokens(t)}) + '\n')
            if (n + 1) % 2000 == 0: print(n + 1, flush=True)
    print(f'{o.count} staves in the pages\' look -> {o.out}')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('what', choices=['measure', 'staves'])
    a.add_argument('--pages', help='measure: folders of page images, commas between')
    a.add_argument('--style', default=os.path.join(HERE, 'data', 'idemstyle'), help='staves: what measure wrote')
    a.add_argument('--music', default=','.join(os.path.join(HERE, 'data', d) for d in ('mensjrp', 'mens5')), help='staves: folders whose labels.jsonl give the music')
    a.add_argument('--count', type=int, default=20000)
    a.add_argument('--limit', type=int, default=120, help='measure: pages looked at')
    a.add_argument('--per-page', type=int, default=6, help='measure: pieces of parchment from each')
    a.add_argument('--seed', type=int, default=21)
    a.add_argument('--out')
    o = a.parse_args()
    o.out = o.out or (os.path.join(HERE, 'data', 'idemstyle') if o.what == 'measure' else os.path.join(HERE, 'data', 'mensidem'))
    {'measure': measure, 'staves': staves}[o.what](o)
