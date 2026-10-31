"""The words under a manuscript's staves, for the text reader: each staff paired with its line of a chant (cantus.py
labels, or redstaves.py), the text band under it cut as the app cuts it (CGRecognizer.textBand: 64 rows from 3.3 to
6.3 spaces below the top line, 12 pixels to a space across), and labelled with the words Cantus gives that line. Cantus
gives each chant's text as the manuscript spells it (fulltext_ms) and its melody with the manuscript's line breaks
(Volpiano: --- between words, -- between syllables, 7 a line break): the words are matched to the melody's, and each
line takes the syllables sung on it (a word the line breaks, split by syllables: Latin rules, a consonant going with
the vowel after it, two split, b c d g p t before l or r kept together). A chant whose words and melody don't agree in
number is left out, and with it the lines it shares.

    python -I training/mstext.py --source 123631 --staves training/data/ms-123631-v2 --labels labels-rebroken-clean.jsonl --pages /tmp/claude-0/scans123631 [--out training/data/text-ms-123631]

Writes <out>/<staff>.png (the band) and <out>/text.jsonl ({file, text, page, staff, line})."""
import argparse, json, os, re, sys
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cantus as C

HEIGHT, FROM, TO, ACROSS, LEFT, RIGHT = 64, 3.3, 6.3, 12, 0.6, 0.4     # (as js/recognizer.js TEXT)
VOWEL = re.compile(r'ae|oe|au|[aeiouyæœ]', re.I)


def split_syllables(word, n):
    """A word cut into n syllables (or as near as its vowels allow): at each vowel group after the first, the
    consonants before it shared out as Latin does."""
    w = word
    groups = [m for m in VOWEL.finditer(w)]
    # (qu, gu before a vowel: the u is not a vowel)
    groups = [m for m in groups if not (m.group().lower() == 'u' and m.start() > 0 and w[m.start() - 1].lower() in 'qg' and m.end() < len(w) and VOWEL.match(w, m.end()))]
    if len(groups) <= 1 or n <= 1: return [w] + [''] * (n - 1) if n > 1 else [w]
    cuts = []
    for a, b in zip(groups, groups[1:]):
        cons = w[a.end():b.start()]
        if len(cons) <= 1: cut = a.end()
        elif len(cons) >= 2 and cons[-2].lower() in 'bcdgpt' and cons[-1].lower() in 'lr': cut = b.start() - 2
        else: cut = b.start() - 1
        cuts.append(cut)
    parts, at = [], 0
    for c in cuts: parts.append(w[at:c]); at = c
    parts.append(w[at:])
    # (more syllables than the melody has: the last joined; fewer: empty ones at the end)
    while len(parts) > n: parts[-2:] = [parts[-2] + parts[-1]]
    while len(parts) < n: parts.append('')
    return parts


def melody_words(volpiano):
    """The melody's words as numbers of syllables, and after which syllable (counted through the chant) each line
    break falls: ([syllables in word 1, 2, …], [syllable counts before each break], ok)."""
    ev = C.parse(volpiano)
    words, cur, breaks, n = [], 0, [], 0
    syl_open = False
    for e in ev:
        if e[0] == 'note' or e[0] in ('flat', 'natural'):
            if not syl_open: syl_open = True; cur += 1; n += 1
        elif e[0] == 'gap':
            if syl_open and e[1] >= 2: syl_open = False
            if e[1] >= 3 and cur: words.append(cur); cur = 0
        elif e[0] == 'break':
            if syl_open: syl_open = False
            breaks.append((n, e[1]))
        elif e[0] == 'lost': return words, breaks, False
        elif e[0] == 'bar':
            syl_open = False
            if cur: words.append(cur); cur = 0
    if cur: words.append(cur)
    return words, breaks, True


def text_words(t):
    t = re.sub(r'\{[^}]*\}|\[[^\]]*\]|\([^)]*\)', ' ', t or '')
    t = re.sub(r'[^A-Za-zæœÆŒ\s]', ' ', t)
    return t.split()


def line_texts(source):
    """{folio: [text of line 1, 2, …] or None where a chant on the line couldn't be matched}, as cantus.lines
    breaks them."""
    rows = C.chants(source)
    folios = sorted({r['folio'] for r in rows if r['folio']}, key=C.folio_key)
    after = dict(zip(folios, folios[1:]))
    pages = {f: [[]] for f in folios}
    bad = {f: set() for f in folios}
    for r in rows:
        f = r['folio']
        if not f or not C.has_melody(r): continue
        words, breaks, ok = melody_words(r['volpiano'])
        tw = text_words(r.get('fulltext_ms') or r.get('fulltext_standardized'))
        # the syllables, each with its text, in order
        # (a hymn: the melody of its first verse, the text of them all; the first verse sung)
        if ok and len(tw) > len(words) and r.get('genre', '').lower().startswith('h'): tw = tw[:len(words)]
        if ok and len(tw) == len(words):
            syls = [s for wd, n in zip(tw, words) for s in [(p, i == n - 1) for i, p in enumerate(split_syllables(wd, n))]]
        else: syls = None
        page, k = pages[f], 0
        line_no = lambda: len(page) - 1
        if syls is None: bad[f].add(line_no())
        bi = 0
        total = sum(words)
        for s in range(total + 1):
            while bi < len(breaks) and breaks[bi][0] == s:
                kind = breaks[bi][1]; bi += 1
                if kind == 77:
                    f = after.get(f)
                    if not f: break
                    page = pages[f]
                    if page[-1]: page.append([])
                else: page.append([])
                if syls is None: bad[f].add(len(page) - 1)
            if s < total and syls is not None and f:
                text, end = syls[s]
                page[-1].append(text + (' ' if end else ''))
    out, theirs = {}, C.lines(source)
    for f, ls in pages.items():
        while ls and not ls[-1]: ls.pop()
        if f not in theirs or len(theirs[f]['lines']) != len(ls): continue     # (lines counted otherwise: not trusted)
        out[f] = [None if i in bad[f] else re.sub(r'\s+', ' ', ''.join(l)).strip() for i, l in enumerate(ls)]
    return out


def band(gray, lines):
    """The text under a staff, cut as CGRecognizer.textBand cuts it."""
    xs = [np.array(l[0::2], float) for l in lines]; ys = [np.array(l[1::2], float) for l in lines]
    mid = (xs[3][0] + xs[3][-1]) / 2
    g = (np.interp(mid, xs[3], ys[3]) - np.interp(mid, xs[0], ys[0])) / 3
    x0, x1 = xs[3][0] - LEFT * g, xs[3][-1] + RIGHT * g
    W = max(1, int(round((x1 - x0) / g * ACROSS))); step = g / ACROSS
    cx = x0 + (np.arange(W) + 0.5) * step
    cxc = np.clip(cx, xs[0][0], xs[0][-1])
    top, bot = np.interp(cxc, xs[0], ys[0]), np.interp(cxc, xs[3], ys[3])
    sp = (bot - top) / 3
    s = FROM + (np.arange(HEIGHT) + 0.5) / HEIGHT * (TO - FROM)
    py = top[None, :] + s[:, None] * sp[None, :]
    px = np.broadcast_to(cx[None, :], py.shape)
    import staffdata
    return staffdata.bilinear(gray, px, py)


def main(o):
    texts = line_texts(o.source)
    out = o.out or os.path.join(HERE, 'data', f'text-ms-{o.source}')
    os.makedirs(out, exist_ok=True)
    staves = {}
    for l in open(os.path.join(o.staves, 'staves.jsonl'), encoding='utf-8'):
        r = json.loads(l)
        if r.get('file'): staves[r['file']] = r
    rows = [json.loads(l) for l in open(os.path.join(o.staves, o.labels), encoding='utf-8')]
    rows.sort(key=lambda r: r['file'])
    n = skipped = 0
    gray, gpage = None, None
    with open(os.path.join(out, 'text.jsonl'), 'w', encoding='utf-8') as f:
        for r in rows:
            folio = r['file'].rsplit('-', 1)[0]
            ls = texts.get(folio) or []
            j = r.get('line')
            t = ls[j - 1] if j and j - 1 < len(ls) else None
            st = staves.get(r['file'])
            if not t or not st: skipped += 1; continue
            if gpage != st['page']:
                path = next((p for p in (os.path.join(o.pages, st['page'] + e) for e in ('.jpg', '.png')) if os.path.exists(p)), None)
                if not path: skipped += 1; continue
                gray = np.asarray(Image.open(path).convert('L'), np.float32); gpage = st['page']
            name = 't-' + r['file']
            Image.fromarray(band(gray, st['lines'])).save(os.path.join(out, name))
            f.write(json.dumps({'file': name, 'text': t, 'page': folio, 'staff': r['file'], 'line': j}, ensure_ascii=False) + '\n'); n += 1
    print(f'{n} lines of text -> {out}; {skipped} staves left out (their line not matched, or no page)')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--source', required=True)
    a.add_argument('--staves', required=True)
    a.add_argument('--labels', required=True)
    a.add_argument('--pages', required=True)
    a.add_argument('--out')
    main(a.parse_args())
