"""GregoBase's chants, as one JSON line each: the corpus the training data is made from.

GregoBase (https://gregobase.selapa.net) keeps a dump of its database in its GitHub repository
(gregorio-project/GregoBase); it is read here, and the chants added on the site since are fetched one by one.

    python training/gregobase.py build [--dump gregobase_online.sql] [--out training/data/gregobase.jsonl]
    python training/gregobase.py update [--out ...] [--wait 1.0]   # the chants added on the site since the dump
    python training/gregobase.py book --source 1 [--book gr1908.book.json]   # one book's index, for the app

Each line: {id, incipit, office_part, mode, version, cantusid, transcriber, gabc: [the GABC bodies],
gabc_verses, headers, sources: [{source, book, year, editor, page, sequence, extent}], tags, copyrighted,
duplicateof, from: "dump" | "site"}. Chants GregoBase marks as copyrighted are kept, with the flag, so a user of the
corpus can leave them out.
"""
import argparse, json, os, re, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = 'https://github.com/gregorio-project/GregoBase'
SITE = 'https://gregobase.selapa.net'
# the office parts, as the dump has them and as the site spells them out (GregoBase's include/txt.php)
PARTS = {'al': 'Alleluia', 'an': 'Antiphona', 'ca': 'Canticum', 'co': 'Communio', 'gr': 'Graduale', 'hy': 'Hymnus',
         'in': 'Introitus', 'im': 'Improperia', 'ky': 'Kyriale', 'of': 'Offertorium', 'pa': 'Prosa', 'ps': 'Psalmus',
         're': 'Responsorium', 'rb': 'Responsorium breve', 'rh': 'Rhythmus', 'se': 'Sequentia', 'su': 'Supplicatio',
         'tr': 'Tractus', 'tp': 'Tropa', 'or': 'Toni Communes', 'pr': 'Praefationes', 'va': 'Varia'}
CODES = {v: k for k, v in PARTS.items()}
ESC = {'n': '\n', 'r': '\r', 't': '\t', '0': '\0', 'Z': '\x1a', 'b': '\b'}


def statements(sql):
    """Each INSERT in a MySQL dump: (table, column names, rows as lists of str | int | float | None)."""
    for m in re.finditer(r"INSERT INTO `(\w+)` \(([^)]*)\) VALUES\s*", sql):
        cols = [c.strip(' `') for c in m.group(2).split(',')]
        rows, i = values(sql, m.end())
        yield m.group(1), cols, rows


def values(s, i):
    """The tuples of a VALUES list from s[i], up to its closing ';'; and where it ended."""
    rows = []
    while True:
        while s[i] in ' \r\n\t,': i += 1
        if s[i] == ';': return rows, i + 1
        assert s[i] == '(', s[i:i + 40]
        i += 1; row = []
        while True:
            while s[i] in ' \r\n\t': i += 1
            if s[i] == "'":
                i += 1; out = []
                while True:
                    c = s[i]
                    if c == '\\': out.append(ESC.get(s[i + 1], s[i + 1])); i += 2
                    elif c == "'" and s[i + 1] == "'": out.append("'"); i += 2
                    elif c == "'": i += 1; break
                    else:
                        j = i
                        while s[j] not in "\\'": j += 1
                        out.append(s[i:j]); i = j
                row.append(''.join(out))
            else:
                j = i
                while s[j] not in ',)': j += 1
                w = s[i:j].strip(); i = j
                row.append(None if w == 'NULL' else float(w) if '.' in w else int(w))
            while s[i] in ' \r\n\t': i += 1
            if s[i] == ',': i += 1; continue
            assert s[i] == ')'; i += 1; break
        rows.append(row)


def bodies(field):
    """GregoBase keeps a chant's GABC as JSON: one string, or a list of ['gabc' | 'tex', text, {}] elements."""
    if not field: return []
    try: v = json.loads(field)
    except ValueError: return [field]
    if isinstance(v, str): return [v]
    return [e[1] for e in v if isinstance(e, list) and e and e[0] == 'gabc']


def tables(sql):
    t = {}
    for name, cols, rows in statements(sql):
        t.setdefault(name.replace('gregobase_', ''), []).extend(dict(zip(cols, r)) for r in rows)
    return t


def sources(t):
    def pages(v):
        try: return json.loads(v) if v else None
        except ValueError: return None
    return {s['id']: {'title': s['title'], 'year': s['year'], 'editor': s['editor'], 'pages': pages(s.get('pages'))}
            for s in t.get('sources', [])}


def book(rows, src, sid):
    """A book's index, for the app: its pages (as numbered in the book, in order) and the chants on each, in order,
    with their GABC: what to place on a scan of it, page by page."""
    pages = [str(p) for p in src.get('pages') or []]   # (labels as text: some sources give some as numbers)
    at = {p: i for i, p in enumerate(pages)}
    out = []
    for r in rows:
        if r.get('duplicateof') or not r['gabc']: continue
        for w in r['sources']:
            if w.get('source') != sid: continue
            out.append({'id': r['id'], 'page': str(w['page']), 'sequence': w.get('sequence') or 1, 'extent': w.get('extent') or 1,
                        'incipit': r['incipit'], 'office_part': r['office_part'], 'mode': r['mode'], 'gabc': r['gabc'][0]})
    out.sort(key=lambda c: (at.get(c['page'], 1e9), c['sequence']))
    return {'format': 'chantgpt-book', 'version': 1, 'from': 'GregoBase (gregobase.selapa.net)',
            'source': {'gregobase': sid, 'title': src['title'], 'year': src['year'], 'editor': src['editor']},
            'pages': pages, 'chants': out}


def chants(t):
    books = sources(t)
    tagname = {g['id']: g['tag'] for g in t.get('tags', [])}
    where, tags = {}, {}
    for r in t.get('chant_sources', []):
        b = books.get(r['source'], {})
        where.setdefault(r['chant_id'], []).append({'source': r['source'], 'book': b.get('title'), 'year': b.get('year'),
                                                    'editor': b.get('editor'), 'page': r['page'],
                                                    'sequence': r['sequence'], 'extent': r['extent']})
    for r in t.get('chant_tags', []):
        tags.setdefault(r['chant_id'], []).append(tagname.get(r['tag_id'], r['tag_id']))
    for c in t['chants']:
        yield {'id': c['id'], 'incipit': c['incipit'], 'office_part': c.get('office-part'), 'mode': c.get('mode'),
               'version': c.get('version'), 'cantusid': c.get('cantusid'), 'transcriber': c.get('transcriber'),
               'gabc': bodies(c.get('gabc')), 'gabc_verses': c.get('gabc_verses'), 'headers': c.get('headers'),
               'sources': where.get(c['id'], []), 'tags': tags.get(c['id'], []),
               'copyrighted': bool(c.get('copyrighted')), 'duplicateof': c.get('duplicateof'), 'from': 'dump'}


def dump_path(given):
    if given: return given
    d = os.path.join(HERE, 'data', 'GregoBase')
    if not os.path.isdir(d):
        subprocess.run(['git', 'clone', '-q', '--depth', '1', REPO, d], check=True)
    return os.path.join(d, 'gregobase_online.sql')


def read(out):
    with open(out, encoding='utf-8') as f: rows = [json.loads(l) for l in f if l.strip()]
    for r in rows: r['office_part'] = CODES.get(r['office_part'], r['office_part'])   # (as fetched before codes were kept)
    return rows


def write(out, rows):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out + '.part', 'w', encoding='utf-8') as f:
        for r in sorted(rows, key=lambda r: r['id']): f.write(json.dumps(r, ensure_ascii=False) + '\n')
    os.replace(out + '.part', out)


def site_chant(id, books):
    """One chant from the site's GABC download (its headers name the book and page); None if there's no such id."""
    req = urllib.request.Request(f'{SITE}/download.php?id={id}&format=gabc', headers={'User-Agent': 'ChantGPT corpus builder'})
    text = urllib.request.urlopen(req, timeout=60).read().decode('utf-8', 'replace')
    if '%%' not in text: return None
    head, body = text.split('%%', 1)
    h = {}
    for line in head.splitlines():
        if ':' in line: k, v = line.split(':', 1); h.setdefault(k.strip(), []).append(v.strip().rstrip(';'))
    where = []
    for b in (h.get('book') or [''])[0].split(' & '):
        m = re.match(r'(.*), (\d{4}), p\. (.*)$', b.strip())
        if not m: continue
        sid = next((k for k, v in books.items() if v['title'] == m.group(1) and str(v['year']) == m.group(2)), None)
        where.append({'source': sid, 'book': m.group(1), 'year': int(m.group(2)), 'page': m.group(3)})
    one = lambda k: (h.get(k) or [None])[0]
    part = one('office-part')
    return {'id': id, 'incipit': one('name'), 'office_part': CODES.get(part, part), 'mode': one('mode'), 'version': None,
            'cantusid': None, 'transcriber': one('transcriber'), 'gabc': [body.strip()], 'gabc_verses': None,
            'headers': None, 'sources': where, 'tags': [], 'copyrighted': False, 'duplicateof': None, 'from': 'site'}


def newest(wait):
    """The highest chant id on the site, from its list of recent changes."""
    req = urllib.request.Request(f'{SITE}/updates.php', headers={'User-Agent': 'ChantGPT corpus builder'})
    page = urllib.request.urlopen(req, timeout=60).read().decode('utf-8', 'replace')
    return max(int(n) for n in re.findall(r'chant\.php\?id=(\d+)', page))


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('what', choices=['build', 'update', 'book'])
    a.add_argument('--source', type=int, help='for book: its GregoBase source number (1: the Graduale Romanum of 1908)')
    a.add_argument('--book', help='for book: where to write its index')
    a.add_argument('--dump')
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'gregobase.jsonl'))
    a.add_argument('--wait', type=float, default=1.0, help='seconds between requests to the site')
    o = a.parse_args()
    if o.what == 'book':
        with open(dump_path(o.dump), encoding='utf-8') as f: src = sources(tables(f.read()))[o.source]
        b = book(read(o.out), src, o.source)
        dest = o.book or os.path.join(os.path.dirname(o.out), f'gregobase-{o.source}.book.json')
        with open(dest, 'w', encoding='utf-8') as f: json.dump(b, f, ensure_ascii=False)
        print(f"{src['title']} ({src['year']}): {len(b['pages'])} pages, {len(b['chants'])} chants -> {dest}")
    elif o.what == 'build':
        with open(dump_path(o.dump), encoding='utf-8') as f: t = tables(f.read())
        rows = list(chants(t))
        # the chants already fetched from the site, newer than the dump, are kept
        have = {r['id'] for r in rows}
        if os.path.exists(o.out): rows += [r for r in read(o.out) if r.get('from') == 'site' and r['id'] not in have]
        write(o.out, rows)
        with open(os.path.join(os.path.dirname(o.out), 'gregobase-sources.json'), 'w', encoding='utf-8') as f:
            json.dump(sources(t), f, ensure_ascii=False, indent=1)
        print(f'{len(rows)} chants from the dump -> {o.out}')
    else:
        rows = read(o.out)
        with open(os.path.join(os.path.dirname(o.out), 'gregobase-sources.json'), encoding='utf-8') as f:
            books = {int(k): v for k, v in json.load(f).items()}
        have = {r['id'] for r in rows}
        top, added = newest(o.wait), 0
        for id in range(max(have) + 1, top + 1):
            try: c = site_chant(id, books)
            except Exception as e: print(f'{id}: {e}', file=sys.stderr); c = None
            if c: rows.append(c); added += 1
            if added and added % 100 == 0: write(o.out, rows); print(f'… {id} of {top}', file=sys.stderr)
            time.sleep(o.wait)
        write(o.out, rows)
        print(f'{added} chants from the site (to id {top}) -> {o.out}')


if __name__ == '__main__':
    main()
