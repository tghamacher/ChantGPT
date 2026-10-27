"""Manuscripts from the Cantus Database (https://cantusdatabase.org): their chants' melodies, as Cantus transcribes
them in Volpiano, page by page and line by line; and their pages, from the library's IIIF server.

    python -I training/cantus.py fetch --source 123631                  # the chants (CSV) -> training/data/cantus/
    python -I training/cantus.py images --source 123631 [--folios 011r-020v] [--wait 2]
                                                                        # the pages -> training/data/scans/123631/
    python -I training/cantus.py lines --source 123631 [--folio 015r]   # what each page's lines hold
    python -I training/cantus.py labels --source 123631 --staves training/data/ms-123631 --model training/data/model2/best.pt
        # the staves found on its pages (staves_of.js) paired with its lines, each with the clef that fits what the
        # model reads on it: <staves>/labels.jsonl, for recognizer.py (rebreak, clean, train --real)
    python -I training/cantus.py collect --source 123631 [--downloads DIR] [--share D:\\ChantGPT\\chantgpt-data --folios 011r-021r]
        # the zips the app saved (Save pages, from the library's IIIF) -> training/data/scans/123631/<folio>.jpg;
        # --share: those folios zipped into a clone of the training-data branch, committed and pushed

Where the library won't serve pages to a program (Gallica, behind Cloudflare), the app fetches them in the browser
(open the manifest, Save pages; or the link index.html?iiif=<manifest>&save=1-1124) and collect files them.

Volpiano (Cantus's "Volpiano protocols"): 1 the clef; pitches 9 a b … s from the G at the bottom of the gamut up
(no i), upper case for a liquescent; i, y, z a flat before the B it stands by (I, Y, Z a natural); hyphens between
neumes (one), syllables (two), words (three); 3 and 4 Cantus's barlines (editorial, not the manuscript's); 7 the end of
a line in the manuscript, 77 of a page, 777 of a column; 6------6 pitches that can't be read. Cantus gives pitch,
not the staff: where a line's notes sit depends on its clef, which only the page shows (gabc() takes it).
"""
import argparse, csv, glob, io, json, os, re, subprocess, sys, time, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = 'https://cantusdatabase.org'
AGENT = 'ChantGPT (chant recognition research; https://github.com/tghamacher/ChantGPT)'
PITCHES = '9abcdefghjklmnopqrs'                  # steps 0 (the gamut's G) to 18
FLATS = {'y': 'b', 'i': 'j', 'z': 'q'}           # a flat (natural, upper case) and the B it is for


def get(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': AGENT}), timeout=120) as r:
                return r.read()
        except Exception as e:
            if k == tries - 1: raise
            print(f'  ({e}; again in {5 * 2 ** k} s)', file=sys.stderr); time.sleep(5 * 2 ** k)


def csv_path(source): return os.path.join(HERE, 'data', 'cantus', f'{source}.csv')


def chants(source):
    """The source's chants, in its order: Cantus's CSV, as dicts (folio, sequence, incipit, genre, mode, volpiano,
    fulltext_ms, image_link, …)."""
    with open(csv_path(source), encoding='utf-8') as f: return list(csv.DictReader(f))


def fetch(o):
    os.makedirs(os.path.dirname(csv_path(o.source)), exist_ok=True)
    data = get(f'{SITE}/source/{o.source}/csv/')
    with open(csv_path(o.source), 'wb') as f: f.write(data)
    rows = chants(o.source)
    print(f'{len(rows)} chants, {sum(has_melody(r) for r in rows)} with their melody -> {csv_path(o.source)}')


def has_melody(r): return len(re.sub(r'[^a-sA-S9]', '', r['volpiano'])) > 2


# ---------------------------------------------------------------- pages: IIIF
def iiif(link):
    """A Cantus image link as (IIIF image URL of a page n, n): Gallica (…/ark:/12148/<id>/f<n>.item) and the
    Bayerische Staatsbibliothek (digitale-sammlungen.de/…/view/<id>?page=<n>)."""
    m = re.search(r'gallica\.bnf\.fr/ark:/12148/(\w+)/f(\d+)', link)
    if m: return (lambda n, i=m.group(1): f'https://gallica.bnf.fr/iiif/ark:/12148/{i}/f{n}/full/full/0/native.jpg'), int(m.group(2))
    m = re.search(r'digitale-sammlungen\.de/\w+/view/(bsb\d+)\?page=(\d+)', link)
    if m: return (lambda n, i=m.group(1): f'https://api.digitale-sammlungen.de/iiif/image/v2/{i}_{n:05d}/full/full/0/default.jpg'), int(m.group(2))
    return None, None


def folio_key(f):
    m = re.match(r'(\d+)([rv]?)', f)
    return (int(m.group(1)), m.group(2)) if m else (10 ** 6, f)


def page_images(source):
    """Each folio (side) with chants, and its image URL: from the chants' links; a page the last chant on a folio
    runs onto (77) is the next image."""
    out = {}
    rows = chants(source)
    folios = sorted({r['folio'] for r in rows if r['folio']}, key=folio_key)
    for r in rows:
        url, n = iiif(r['image_link'])
        if url and r['folio'] not in out: out[r['folio']] = (url, n)
    for f, g in zip(folios, folios[1:]):                  # (a folio no chant begins on: the one before's next image)
        if f in out and g not in out: out[g] = (out[f][0], out[f][1] + 1)
    return {f: url(n) for f, (url, n) in sorted(out.items(), key=lambda v: folio_key(v[0]))}


def images(o):
    out = o.out or os.path.join(HERE, 'data', 'scans', str(o.source))
    os.makedirs(out, exist_ok=True)
    pages = page_images(o.source)
    lo, hi = (o.folios.split('-') + [None])[:2] if o.folios else (None, None)
    hi = hi or lo
    todo = [f for f in pages if (not lo or folio_key(lo) <= folio_key(f) <= folio_key(hi))]
    for k, f in enumerate(todo):
        path = os.path.join(out, f + '.jpg')
        if os.path.exists(path): continue
        data = get(pages[f])
        if not data.startswith(b'\xff\xd8'): raise SystemExit(f'{f}: not an image from {pages[f]} (the library refused?)')
        with open(path, 'wb') as fh: fh.write(data)
        print(f'{k + 1}/{len(todo)} {f} ({len(data) // 1024} KB)', flush=True)
        time.sleep(o.wait)
    print(f'{len(todo)} pages -> {out}')


def view_of(url):
    """The page number (from 1, the IIIF canvas's) in a page's image URL."""
    m = re.search(r'/f(\d+)/full/', url) or re.search(r'_(\d{5})/full/', url)
    return int(m.group(1)) if m else None


def collect(o):
    """The app's zips (images named '<page number, 4 digits> <label>.jpg'), each image filed as its folio."""
    out = o.out or os.path.join(HERE, 'data', 'scans', str(o.source))
    os.makedirs(out, exist_ok=True)
    pages = page_images(o.source)
    folio = {view_of(u): f for f, u in pages.items()}
    ident = re.search(r'ark:/12148/(\w+)|(bsb\d+)', next(iter(pages.values())))
    ident = ident and (ident.group(1) or ident.group(2))
    downloads = o.downloads or os.path.join(os.path.expanduser('~'), 'Downloads')
    zips = [z for z in glob.glob(os.path.join(downloads, '*.zip')) if re.search(r' \d+-\d+\.zip$', z)]
    n = skipped = 0
    def ours(z):                                        # (the app writes the manifest it saved from in source.txt)
        with zipfile.ZipFile(z) as zf:
            return 'source.txt' in zf.namelist() and bool(ident) and ident in zf.read('source.txt').decode('utf-8', 'replace')
    zips = [z for z in zips if ours(z)]
    for z in sorted(zips):
        with zipfile.ZipFile(z) as zf:
            for name in zf.namelist():
                m = re.match(r'(\d{4})\b.*\.(jpe?g|png)$', name)
                if not m: continue
                f = folio.get(int(m.group(1)))
                if not f: skipped += 1; continue
                with open(os.path.join(out, f + '.jpg'), 'wb') as fh: fh.write(zf.read(name))
                n += 1
    print(f'{n} pages filed by folio -> {out} (from {len(zips)} zips in {downloads}; {skipped} pages with no chant left out)')
    if o.share:
        share(o, out)


def share(o, out):
    """Folios (--folios lo-hi, or all) zipped into a clone of the training-data branch, committed and pushed: zips of
    up to about 90 MB, each pushed as it is made; with --width, each page made no wider (as JPEG)."""
    lo, hi = ('', '') if o.folios == 'all' else ((o.folios.split('-') + [None])[:2] if o.folios else ('011r', '021r'))
    hi = hi or lo
    files = sorted((f for f in os.listdir(out) if f.endswith('.jpg') and (not lo or folio_key(lo) <= folio_key(f[:-4]) <= folio_key(hi))), key=lambda f: folio_key(f[:-4]))
    if not files: raise SystemExit(f'No pages {o.folios} in {out}.')
    dest = os.path.join(o.share, f'cantus-{o.source}')
    os.makedirs(dest, exist_ok=True)
    git = lambda *a: subprocess.run(['git', '-C', o.share, *a], check=True)
    git('pull', '--quiet')
    def page(f):
        if not o.width: return open(os.path.join(out, f), 'rb').read()
        from PIL import Image
        im = Image.open(os.path.join(out, f))
        if im.width > o.width: im = im.resize((o.width, round(im.height * o.width / im.width)), Image.LANCZOS)
        b = io.BytesIO(); im.convert('RGB').save(b, 'JPEG', quality=88); return b.getvalue()
    part, size, batch, sent = 0, 0, [], 0
    def flush():
        nonlocal part, size, batch, sent
        if not batch: return
        part += 1
        name = f'pages-{batch[0][0][:-4]}-{batch[-1][0][:-4]}{"-w" + str(o.width) if o.width else ""}.zip'
        with zipfile.ZipFile(os.path.join(dest, name), 'w', zipfile.ZIP_STORED) as zf:
            for f, data in batch: zf.writestr(f, data)
        git('add', os.path.join(f'cantus-{o.source}', name))
        git('commit', '--quiet', '-m', f'Pages {batch[0][0][:-4]}-{batch[-1][0][:-4]} of Cantus source {o.source}')
        for k in range(4):
            if not subprocess.run(['git', '-C', o.share, 'push', '--quiet']).returncode: break
            subprocess.run(['git', '-C', o.share, 'pull', '--rebase', '--quiet']); time.sleep(10 * 2 ** k)
        sent += len(batch)
        print(f'{sent} of {len(files)} pages -> {name}, pushed', flush=True)
        batch, size = [], 0
    for f in files:
        data = page(f)
        if size + len(data) > 90e6: flush()
        batch.append((f, data)); size += len(data)
    flush()


# ---------------------------------------------------------------- melodies: Volpiano
def parse(v):
    """A Volpiano string as events: ('note', step, liquescent), ('flat' | 'natural', step), ('gap', hyphens), ('bar',),
    ('break', 7 | 77 | 777), ('lost',) (pitches not legible)."""
    out, i = [], 0
    while i < len(v):
        c = v[i]
        if c == '-':
            j = i
            while j < len(v) and v[j] == '-': j += 1
            out.append(('gap', j - i)); i = j; continue
        if c == '7':
            j = i
            while j < len(v) and v[j] == '7': j += 1
            out.append(('break', int(v[i:j][:3]))); i = j; continue
        if c == '6':
            j = v.find('6', i + 1)
            out.append(('lost',)); i = (j + 1) if j > 0 else len(v); continue
        if c in '34': out.append(('bar',))
        elif c.lower() in FLATS: out.append(('flat' if c.islower() else 'natural', PITCHES.index(FLATS[c.lower()])))
        elif c.lower() in PITCHES and c != '1': out.append(('note', PITCHES.index(c.lower()), c.isupper()))
        i += 1
    return out


def syllables(events):
    """Events as syllables, each a list of neumes, each a list of notes and accidentals ((kind, step, liquescent)):
    split at two or more hyphens (a syllable), one (a neume); a bar and a break kept as markers between syllables."""
    out, syl, neume = [], [], []
    def end_neume():
        nonlocal neume
        if neume: syl.append(neume); neume = []
    def end_syl():
        nonlocal syl
        end_neume()
        if syl: out.append(syl); syl = []
    for e in events:
        if e[0] == 'gap':
            end_neume() if e[1] == 1 else end_syl()
        elif e[0] in ('bar', 'break', 'lost'):
            end_syl(); out.append(e)
        else:
            neume.append(e if e[0] == 'note' else (e[0], e[1], False))
    end_syl()
    return out


def lines(source):
    """Each page's lines, as the manuscript breaks them: {folio: {'lines': [[syllable, …], …], 'complete': every
    chant on it has its melody, 'chants': [ids]}}. A chant that doesn't end a line runs on in the next one's line;
    after 77 it goes on on the next folio; 777 begins a column (a line too)."""
    rows = chants(source)
    folios = sorted({r['folio'] for r in rows if r['folio']}, key=folio_key)
    after = dict(zip(folios, folios[1:]))
    pages = {f: {'lines': [[]], 'complete': True, 'chants': [], 'columns': [0]} for f in folios}
    for r in rows:
        if not r['folio']: continue
        page = pages[r['folio']]
        if not has_melody(r):
            page['complete'] = False; continue
        page['chants'].append(r.get('node_id') or r['incipit'])
        f = r['folio']
        for s in syllables(parse(r['volpiano'])):
            if s[0] == 'break':
                if s[1] == 77:
                    f = after.get(f)
                    if not f: break
                    page = pages[f]
                    if page['lines'][-1]: page['lines'].append([])
                else:
                    page['lines'].append([])
                    if s[1] == 777: page['columns'].append(len(page['lines']) - 1)
            elif s[0] in ('bar', 'lost'):
                if s[0] == 'lost': page['complete'] = False
            else:
                page['lines'][-1].append(s)
    for p in pages.values():
        while p['lines'] and not p['lines'][-1]: p['lines'].pop()
    return pages


# ---------------------------------------------------------------- melodies as GABC, on a staff with its clef
def shift_for(steps, clef):
    """How many steps up the staff's positions (GABC a = 0 … m = 12) are from Volpiano's: the clef's note (C for a
    c clef, F for an f clef) on its line, at the octave that keeps the most notes on the staff (then the most central)."""
    line = int(clef[-1])
    at = 3 + 2 * (line - 1)                               # the line's position: d, f, h, j, l
    best = None
    for base in ((3, 10, 17) if clef[0] == 'c' else (6, 13)):
        sh = at - base
        on = sum(0 <= s + sh <= 12 for s in steps)
        mid = -abs(sum(s + sh for s in steps) / max(1, len(steps)) - 6)
        if best is None or (on, mid) > best[0]: best = ((on, mid), sh)
    return best[1]


def gabc(line, clef, custos=None):
    """A line's syllables as GABC groups (one for each syllable; / between neumes), the clef first and the custos (the
    next line's first note) last; or None when a note falls off the staff."""
    steps = [n[1] for s in line for neume in s for n in neume]
    if not steps: return None
    sh = shift_for(steps + ([custos] if custos is not None else []), clef)
    pos = lambda st: 'abcdefghijklm'[st + sh] if 0 <= st + sh <= 12 else None
    items = [clef]
    for s in line:
        g = []
        for neume in s:
            t = ''
            for kind, st, liq in neume:
                p = pos(st)
                if p is None: return None
                t += p + ('x' if kind == 'flat' else 'y' if kind == 'natural' else '~' if liq else '')
            g.append(t)
        items.append('/'.join(g))
    if custos is not None:
        p = pos(custos)
        if p: items.append(p + '+')
    return items


def first_step(line):
    for s in line:
        for neume in s:
            for kind, st, _ in neume:
                if kind == 'note': return st
    return None


CLEFS = ['c1', 'c2', 'c3', 'c4', 'f2', 'f3', 'f4']


def positions(tokens):
    """The staff positions (GABC letters) of the notes among tokens (recognizer.py's or staffdata.py's)."""
    return [t[0].lower() for t in tokens if re.fullmatch(r'[a-mA-M][vVoOwsr]?[~<>]?', t)]


def edits(a, b):
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            cur = d[j]; d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1])); prev = cur
    return d[len(b)]


def fit_clef(read, line, custos):
    """The clef under which a line's notes (Cantus's pitches) sit where the model read notes on the staff: (clef,
    GABC items, the share of notes that differ). read: the tokens the model read."""
    seen = positions([t for t in read if not t.endswith('+')])
    best = None
    for clef in CLEFS:
        items = gabc(line, clef, custos)
        if not items: continue
        want = positions(staffdata_tokens(items[1:-1] if items[-1].endswith('+') else items[1:]))
        d = edits(seen, want) / max(1, len(want))
        # (a tie: the clef the model read, if it read one)
        key = (d, 0 if read and read[0] == clef else 1)
        if best is None or key < best[0]: best = (key, clef, items)
    return (best[1], best[2], best[0][0]) if best else (None, None, 1.0)


def staffdata_tokens(items):
    sys.path.insert(0, HERE)
    import staffdata
    return staffdata.tokens(items)


def labels(o):
    """Each page whose staves (as staves_of.js found them) are as many as its lines (Cantus's 7s), every chant on it
    with its melody: staff k gets line k, with the clef that best fits what the model reads there and the next line's
    first note as its custos. Written to <staves>/labels.jsonl ({file, items, page, chant, staff, fit}); a page is its
    own 'chant', so that recognizer.py rebreak can move a neume from line to line within it."""
    sys.path.insert(0, HERE)
    import recognizer, torch
    m, s = recognizer.restore(o.model)
    pages = lines(o.source)
    folios = list(pages)
    found = {}
    for l in open(os.path.join(o.staves, 'staves.jsonl'), encoding='utf-8'):
        r = json.loads(l)
        if r.get('file'): found.setdefault(r['page'], []).append(r)
    kept = skipped = staves = 0
    why = {}
    with open(os.path.join(o.staves, 'labels.jsonl'), 'w', encoding='utf-8') as out:
        for f, rows in sorted(found.items(), key=lambda v: folio_key(v[0])):
            p = pages.get(f)
            if not p: why['not in Cantus'] = why.get('not in Cantus', 0) + 1; continue
            if not p['complete']: why['a chant without its melody'] = why.get('a chant without its melody', 0) + 1; continue
            rows.sort(key=lambda r: r['k'])
            if len(rows) != len(p['lines']):
                why['staves found not as many as lines'] = why.get('staves found not as many as lines', 0) + 1; continue
            nxt = folios[folios.index(f) + 1] if folios.index(f) + 1 < len(folios) else None
            for k, (r, line) in enumerate(zip(rows, p['lines'])):
                after = p['lines'][k + 1] if k + 1 < len(p['lines']) else (pages[nxt]['lines'][0] if nxt and pages[nxt]['lines'] else None)
                x, n = recognizer.collate([recognizer.ink(recognizer.image(o.staves, r['file']))])
                with torch.no_grad(): read, _ = recognizer.greedy(m(x), n, s['vocab'])[0]
                clef, items, d = fit_clef(read, line, first_step(after) if after else None)
                if not items: skipped += 1; continue
                out.write(json.dumps({'file': r['file'], 'items': items, 'page': folios.index(f), 'chant': f,
                                      'staff': f'f{f}s{k + 1}', 'fit': round(d, 3)}) + '\n')
                staves += 1
            kept += 1
    print(f'{kept} pages paired, {staves} staves -> {os.path.join(o.staves, "labels.jsonl")}; pages left out: {why or "none"}; {skipped} lines off every staff')


def show(o):
    pages = lines(o.source)
    shown = [o.folio] if o.folio else list(pages)[:3]
    for f in shown:
        p = pages[f]
        print(f'{f}: {len(p["lines"])} lines ({"every chant with its melody" if p["complete"] else "not every chant"}); columns begin at {p["columns"]}')
        for k, l in enumerate(p['lines']):
            nxt = first_step(p['lines'][k + 1]) if k + 1 < len(p['lines']) else None
            print(f'  {k + 1:2d}', ' '.join(gabc(l, 'c4', nxt) or ['(off a c4 staff)']))
    if not o.folio:
        n = sum(p['complete'] for p in pages.values())
        print(f'{len(pages)} folios, {n} with every chant\'s melody; {sum(len(p["lines"]) for p in pages.values() if p["complete"])} lines on those')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('what', choices=['fetch', 'images', 'lines', 'collect', 'labels'])
    a.add_argument('--staves', help='labels: the folder staves_of.js wrote')
    a.add_argument('--model', help='labels: the recognizer checkpoint that reads the staves')
    a.add_argument('--source', required=True, help='the Cantus source id (Paris lat. 15181: 123631)')
    a.add_argument('--folios', help='images, collect --share: only these, e.g. 011r-020v')
    a.add_argument('--downloads', help='collect: where the zips are (your Downloads folder)')
    a.add_argument('--share', help='collect: a clone of the training-data branch, to push the --folios to (all: every one)')
    a.add_argument('--width', type=int, help='collect --share: pages made no wider than this')
    a.add_argument('--folio', help='lines: this one')
    a.add_argument('--out')
    a.add_argument('--wait', type=float, default=2.0, help='images: seconds between pages (be kind to the library)')
    o = a.parse_args()
    {'fetch': fetch, 'images': images, 'lines': show, 'collect': collect, 'labels': labels}[o.what](o)
