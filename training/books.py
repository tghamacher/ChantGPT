"""Real staves from any book GregoBase has indexed whose scan is on the Internet Archive, with nobody's help: the scan
fetched, the book's index made (gregobase.py book), where its page "1" is in the scan found from the page numbers
printed on the scan's pages (its text layer), and align.js run over it, a few pages at a time so that a stop (this
computer's, or the network's) loses little.

    python -I training/books.py run --source 7 --ia antiphonalemonasticum1934 [--to 200]

Writes training/data/book-<source>/ (the staves, labels.jsonl) as align.js does; the scan goes to
training/data/scans/ia-<identifier>.pdf. Run again, it carries on where it stopped. The books done so far are listed
in training/README.md."""
import argparse, collections, json, os, re, subprocess, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
AGENT = 'ChantGPT/0.1 (training a chant reader; https://github.com/tghamacher/ChantGPT)'
CHUNK = 25


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': AGENT}), timeout=300) as r: return r.read()


def scan(ia):
    """The item's PDF (the open one; an item lent only, with its PDF kept back, can't be had), fetched once."""
    path = os.path.join(DATA, 'scans', f'ia-{ia}.pdf')
    if os.path.exists(path): return path
    meta = json.loads(get(f'https://archive.org/metadata/{ia}'))
    if meta.get('metadata', {}).get('access-restricted-item'): raise SystemExit(f'{ia}: lent only; its PDF is kept back')
    pdfs = [f for f in meta.get('files', []) if f['name'].lower().endswith('.pdf') and not f.get('private')
            and not f['name'].lower().endswith(('_text.pdf', '_encrypted.pdf'))]
    if not pdfs: raise SystemExit(f'{ia}: no PDF')
    name = max(pdfs, key=lambda f: int(f.get('size', 0)))['name']
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print(f'fetching {name} ({int(max(int(f.get("size", 0)) for f in pdfs)) >> 20} MB)', flush=True)
    url = f'https://archive.org/download/{ia}/' + urllib.request.quote(name)
    subprocess.run(['curl', '-sS', '-L', '--retry', '5', '-A', AGENT, '-o', path + '.part', url], check=True)
    os.replace(path + '.part', path)
    return path


def index(source):
    path = os.path.join(DATA, f'gregobase-{source}.book.json')
    if not os.path.exists(path):
        subprocess.run([sys.executable, '-I', os.path.join(HERE, 'gregobase.py'), 'book', '--source', str(source), '--book', path], check=True)
    return path


def pages_in(pdf):
    out = subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout
    return int(re.search(r'Pages:\s+(\d+)', out).group(1))


def offset(pdf, pages, ia=None):
    """Where the book's pages are in the scan: the scan page minus the page's place in the book's list, as most of the
    page numbers printed on the scan's pages say: the Archive's reading of them (its page numbers file), else the
    scan's own text layer. None if neither says."""
    at = {p: i for i, p in enumerate(pages)}
    votes = collections.Counter()
    if ia:
        meta = json.loads(get(f'https://archive.org/metadata/{ia}'))
        f = next((f['name'] for f in meta.get('files', []) if f['name'].endswith('_page_numbers.json')), None)
        if f:
            for r in json.loads(get(f'https://archive.org/download/{ia}/' + urllib.request.quote(f))).get('pages', []):
                if r.get('pageNumber') in at: votes[r['leafNum'] + 1 - at[r['pageNumber']]] += 1   # (leaves from 0)
    n = pages_in(pdf) if not votes else 0
    for k in range(1, n + 1, max(1, n // 120)):         # (a hundred or so pages is plenty)
        text = subprocess.run(['pdftotext', '-f', str(k), '-l', str(k), '-layout', pdf, '-'], capture_output=True, text=True).stdout
        lines = [l for l in text.splitlines() if l.strip()]
        for l in lines[:2] + lines[-2:]:
            for num in re.findall(r'(?<![\w.])(\d{1,4})(?![\w.])', l):
                if num in at: votes[k - at[num]] += 1
    if not votes: return None
    best, n_best = votes.most_common(1)[0]
    print(f'the book\'s pages are {best} on in the scan ({n_best} page numbers say so; next: {votes.most_common(3)[1:]})', flush=True)
    return best if n_best >= 5 else None


def run(o):
    pdf = scan(o.ia)
    book = index(o.source)
    pages = json.load(open(book, encoding='utf-8'))['pages']
    out = os.path.join(DATA, f'book-{o.source}')
    os.makedirs(out, exist_ok=True)
    state_path = os.path.join(out, '.progress.json')
    state = json.load(open(state_path)) if os.path.exists(state_path) else {}
    if 'offset' not in state:
        d = o.offset if o.offset is not None else offset(pdf, pages, o.ia)
        if d is None: raise SystemExit('the scan\'s page numbers could not be read: give --offset (scan page minus place in the book\'s list)')
        state = {'offset': d, 'done': 0}
        json.dump(state, open(state_path, 'w'))
    d = state['offset']
    # (align.js: --at, a scan page from 1; --label, the book's page there)
    first = next(i for i, p in enumerate(pages) if re.fullmatch(r'\d+', p))
    at, label = first + d, pages[first]
    last = min(pages_in(pdf), (o.to if o.to else len(pages) + d))
    start = max(state['done'] + 1, max(1, d))
    for a in range(start, last + 1, CHUNK):
        b = min(last, a + CHUNK - 1)
        r = subprocess.run(['node', os.path.join(HERE, 'align.js'), '--pdf', pdf, '--book', book, '--at', str(at), '--label', label,
                            '--from', str(a), '--to', str(b), '--out', out], capture_output=True, text=True)
        tail = (r.stdout.strip().splitlines() or [''])[-1]
        print(f'scan pages {a}-{b}: {tail}', flush=True)
        if r.returncode: print(r.stderr[-800:], flush=True); raise SystemExit(f'align.js stopped at scan pages {a}-{b}')
        state['done'] = b
        json.dump(state, open(state_path, 'w'))
    # (a chunk run twice, after a stop: its staves once)
    path = os.path.join(out, 'labels.jsonl')
    seen, rows = set(), []
    for l in open(path, encoding='utf-8') if os.path.exists(path) else []:
        r = json.loads(l)
        if r['file'] not in seen: seen.add(r['file']); rows.append(l)
    open(path, 'w', encoding='utf-8').writelines(rows)
    print(f'{len(rows)} staves with their GABC -> {out}')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('what', choices=['run'])
    a.add_argument('--source', type=int, required=True, help='the GregoBase source (its number)')
    a.add_argument('--ia', required=True, help='the Internet Archive item with its scan')
    a.add_argument('--offset', type=int, help='scan page minus place in the book\'s list (found from the scan if left out)')
    a.add_argument('--to', type=int, help='only so far into the scan')
    o = a.parse_args()
    run(o)
