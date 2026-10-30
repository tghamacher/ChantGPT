"""Lines of text from a printed book with no notes and a transcription that keeps only its leaves (not its lines), for
the text reader: the Nidaros Breviary (Paris, 1519), from the National Library of Norway's scans and Ingrid Sperber's
edition (National Library of Norway, 2019; published by Bokselskap). The edition marks each leaf where it begins:
{197 | M.iiij.} is scan 197 (the scans counted from 0, two before the IIIF canvas's own index) and the folio as printed.

    python -I training/lines.py --text breviarium.txt --from 197 --to 250 [--out training/data/nidaros]

breviarium.txt: the edition as `pdftotext -layout` gives it (kept out of the repository). For each leaf: its two pages
fetched (IIIF), their columns and lines found (the ink, black or red, projected across: a band of ink is a line, one
much taller is lines run together, cut at the book's line spacing), each line cut as a strip like the text under a
staff (CGRecognizer.textBand: 64 rows, letters squeezed across as there), and the leaf's text spread over its lines in
proportion to how wide each is. Rough, at first: training on it, the reader learns enough to find where each line's
text really ends (recognizer.py rebreak), and is trained again. The text: letters and spaces (and ℟ ℣); the editor's
punctuation, notes and apparatus left out. Writes <out>/NNNN-c-ll.png and <out>/text.jsonl ({file, text, leaf}); a
leaf done is not done again."""
import argparse, io, json, os, re, sys, time, urllib.request
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
AGENT = 'ChantGPT/0.1 (training a chant reader; https://github.com/tghamacher/ChantGPT)'
IMAGE = 'https://www.nb.no/services/image/resolver/URN:NBN:no-nb_digibok_2007092813001_{:04d}/full/{},/0/default.jpg'
WIDTH = 1472
HEIGHT, SQUEEZE = 64, 12 / 21.33              # (as textBand: 64 rows to 3 staff spaces; 12 px a space across)


def page(n, cache):
    path = os.path.join(cache, f'{n:04d}.jpg')
    if not os.path.exists(path):
        os.makedirs(cache, exist_ok=True)
        for k in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(IMAGE.format(n, WIDTH), headers={'User-Agent': AGENT}), timeout=120) as r:
                    open(path + '.part', 'wb').write(r.read())
                os.replace(path + '.part', path); break
            except Exception as e:
                if k == 3: raise
                time.sleep(5 * 2 ** k)
    return np.asarray(Image.open(path).convert('RGB')).astype(np.float32)


def ink_of(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return ((r + g + b) / 3 < 110) | ((r - g > 60) & (r > 120))


def bands(on, least=8):
    out, i, n = [], 0, len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]: j += 1
            if j - i >= least: out.append((i, j))
            i = j
        else: i += 1
    return out


def columns(ink):
    """The page's columns of text: [x0, x1], split at the gutter (the least ink between a third and two thirds across)."""
    H, W = ink.shape
    prof = np.convolve(ink.sum(0), np.ones(15) / 15, 'same')
    g = int(W * .35) + int(np.argmin(prof[int(W * .35):int(W * .65)]))
    out = []
    for a, b in ((0, g), (g, W)):
        xs = np.where(ink[:, a:b].sum(0) > H * 0.02)[0]
        if len(xs) > 20: out.append((a + xs[0], a + xs[-1] + 1))
    return out


def lines_of(ink, x0, x1):
    """The lines in a column: [y0, y1], a band too tall cut into as many as the line spacing says it holds."""
    rows = np.convolve(ink[:, x0:x1].sum(1), np.ones(5) / 5, 'same')
    bs = bands(rows > 0.03 * (x1 - x0))
    if len(bs) < 3: return []
    heights = sorted(b - a for a, b in bs)
    h = heights[len(heights) // 3]                                  # (a single line's height: the shorter bands')
    starts = [a for a, _ in bs]
    pitch = float(np.median(np.diff(starts))) if len(starts) > 2 else 1.3 * h
    pitch = min(max(pitch, 1.05 * h), 2.0 * h)
    # (the running head, the leaf's title and folio: set off from the text by a wider gap; not text the edition gives)
    if len(bs) > 2 and bs[1][0] - bs[0][0] > 1.4 * pitch: bs = bs[1:]
    out = []
    for a, b in bs:
        k = max(1, round((b - a + (pitch - h)) / pitch))
        for j in range(k): out.append((int(a + j * (b - a) / k), int(a + (j + 1) * (b - a) / k)))
    return out


def strip(rgb, x0, x1, y0, y1):
    """A line cut as the text reader sees its strips: the line's middle the strip's, a little above and below, the
    columns squeezed by as much as textBand squeezes its letters."""
    gray = rgb.mean(2)
    mid, h = (y0 + y1) / 2, (y1 - y0)
    top, bot = int(max(0, mid - 0.7 * h)), int(min(gray.shape[0], mid + 0.7 * h))
    im = Image.fromarray(gray[top:bot, x0:x1].clip(0, 255).astype(np.uint8))
    s = HEIGHT / max(1, bot - top)
    return im.resize((max(8, int((x1 - x0) * s * SQUEEZE)), HEIGHT), Image.BILINEAR)


# ---------------------------------------------------------------- the edition's text, leaf by leaf
MARK = re.compile(r'\{(\d+) \| ([^}]*)\}')


def leaves(path):
    """{scan: text} from the edition: its notes, apparatus and page numbers left out; letters and spaces only."""
    keep = []
    for l in open(path, encoding='utf-8'):
        s = l.rstrip('\n')
        if re.fullmatch(r'\s*\d+\s*', s) or ']' in s and not MARK.search(s): continue      # (page numbers, notes' numbers, the apparatus)
        keep.append(s.strip())
    text = ' '.join(keep)
    out, parts = {}, MARK.split(text)
    # parts: text, scan, folio, text, scan, folio, text …
    for k in range(1, len(parts) - 2, 3):
        body = parts[k + 2]
        body = re.sub(r'(?<=\w)\d+', '', body)                     # (a note's number after a word)
        body = re.sub(r'<[^>]*>', '', body)                        # (the editor's additions, <me>, as printed: no)
        body = re.sub(r'[^\w\s℟℣]', ' ', body)
        body = re.sub(r'[\d_]', ' ', body)
        out[int(parts[k])] = re.sub(r'\s+', ' ', body).strip()
    return out


def main(o):
    text = leaves(o.text)
    out = o.out
    os.makedirs(out, exist_ok=True)
    labels = os.path.join(out, 'text.jsonl')
    done = set()
    if os.path.exists(labels):
        for l in open(labels, encoding='utf-8'):
            try: done.add(json.loads(l)['leaf'])
            except ValueError: pass
    scans = sorted(s for s in text if o.first <= s <= o.last and s not in done)
    with open(labels, 'a', encoding='utf-8') as f:
        for s in scans:
            lines = []
            for n in (s + 2, s + 3):                                # (the leaf's recto and verso, as the IIIF canvases count)
                rgb = page(n, os.path.join(out, 'pages'))
                ink = ink_of(rgb)
                for c, (x0, x1) in enumerate(columns(ink)):
                    col = []
                    for k, (y0, y1) in enumerate(lines_of(ink, x0, x1)):
                        xs = np.where(ink[y0:y1, x0:x1].sum(0) > 0)[0]
                        if len(xs) < 10: continue
                        col.append((n, c, k, x0 + xs[0], x0 + xs[-1] + 1, y0, y1, rgb))
                    # (the running head, the leaf's title or folio, over the column: much narrower than its lines)
                    if len(col) > 3 and col[0][4] - col[0][3] < 0.6 * float(np.median([v[4] - v[3] for v in col])): col = col[1:]
                    lines += col
            words = text[s].split(' ')
            if not lines or not words: continue
            total = sum(b - a for _, _, _, a, b, _, _, _ in lines)
            # (the words spread over the lines by width: each line takes the words its share of the letters reaches)
            letters = sum(len(w) + 1 for w in words)
            w, got = 0, 0.0
            for n, c, k, a, b, y0, y1, rgb in lines:
                got += (b - a) / total * letters
                mine = []
                while w < len(words) and (sum(len(x) + 1 for x in words[:w]) + len(words[w]) / 2) < got: mine.append(words[w]); w += 1
                if not mine: continue
                name = f'{n:04d}-{c}-{k:02d}.png'
                strip(rgb, a, b, y0, y1).save(os.path.join(out, name))
                f.write(json.dumps({'file': name, 'text': ' '.join(mine), 'leaf': s}, ensure_ascii=False) + '\n')
            f.flush()
            print(f'leaf {s}: {len(lines)} lines, {len(words)} words', flush=True)


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--text', required=True, help='the edition, as pdftotext -layout gives it')
    a.add_argument('--from', dest='first', type=int, default=0)
    a.add_argument('--to', dest='last', type=int, default=10 ** 6)
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'nidaros'))
    main(a.parse_args())
