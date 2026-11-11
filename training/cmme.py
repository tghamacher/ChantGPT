"""The Occo Codex (Brussels, KBR, IV 922; Amsterdam, c. 1515-17, from Alamire's workshop) as CMME edits it (The Occo
Codex, ed. Jaap van Benthem, Marnix van Berchum, Anna Dieleman, Theodor Dumitrescu and Frans Wiering; Computerized
Mensural Music Editing, https://www.cmme.org), paired with its pages as IDEM serves them (Alamire Foundation; the images
the Royal Library of Belgium's, digitised by Alamire Digital Lab): the edition keeps the manuscript's notation (its
values, ligatures, coloration, clefs, custodes and signs) and where each of its staves and pages ends, so each staff
found on a page can be given what CMME says is on it.

PRIVATE: CMME gives no licence for its editions; until the user has asked the project, what is made here stays on
this computer (training/data/, which git leaves out): no zip of it on training-data, no model from it in the app.

    python -I training/cmme.py fetch                       # the edition's files -> training/data/cmme/ (a few at a time)
    python -I training/cmme.py staves                      # its staves in CGMensural's text form -> training/data/cmme/occo.jsonl
    python -I training/cmme.py pair --scans training/data/scans/occo --model training/data/mens0075/best.pt
        # the staves found on the pages (fivestaves.py), each read by the model and given the edition's staff it reads
        # most like (if near enough, and of the opening most of the page's staves are of) -> training/data/occo/

Other sources CMME collates, the same way (their staff breaks are among its readings too: The Other Josquin, project
14; Berchem, project 9), by the name CMME gives the source's reading, e.g. Kassel 4° Ms. Mus. 24's partbooks:
    python -I training/cmme.py fetch --projects 14,9
    python -I training/cmme.py staves --source "KasL 24" --name kasl24
    python -I training/cmme.py pair --name kasl24 --scans training/data/scans/kasl24-1,training/data/scans/kasl24-2 --model …

The pages: open https://data.idemdatabase.org/IE7950914/manifest in the app with &save=all&width=2400 (the app saves
them in zips in Downloads, a page a second), then: cantus.py collect --source occo --manifest <that address>.

The edition in CGMensural's text form (js/mensural.js):
  - where the edition and the Occo Codex differ (CMME's variant readings), the Occo Codex's reading; the staff and page
    breaks are among them;
  - a staff's place (CMME's StaffLoc: 1 the bottom line, 2 the space above) as steps up from the bottom line (0);
    a note's from its pitch and the clef;
  - rests: a semibreve rest hangs from its line, a minim rest stands on it, a breve's and a longa's middle; a longa
    rest across three spaces is a perfect one (rLp);
  - a Bmol "clef" (a flat, the signature or not) b; a written number (Mensuration's Number) the proportion; a barline |;
  - what can't be said (two notes at once, a gap in the source, a change of colour) leaves the staff out; editorial
    additions (Editorial) are not the manuscript's and are left out; lyrics, fermatas and signa are not drawn.
"""
import argparse, json, os, re, sys, time, urllib.request
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = 'https://www.cmme.org'
AGENT = 'ChantGPT (music recognition research; https://github.com/tghamacher/ChantGPT)'
NS = '{http://www.cmme.org}'
DIR = os.path.join(HERE, 'data', 'cmme')
OCCO = 'BrusBR IV.922'
PROJECT = 4                                                  # (CMME's editorial project: The Occo Codex)
VAL = {'Maxima': 'Mx', 'Longa': 'L', 'Brevis': 'B', 'Semibrevis': 'Sb', 'Minima': 'M', 'Semiminima': 'Sm', 'Fusa': 'F', 'Semifusa': 'Sf'}
STEMMED_DOWN = {'Mx', 'L'}                                   # (CGMensural's default stems: these down, the small values up)
LETTERS = 'ABCDEFG'                                          # (CMME's octaves begin at A: A3 B3 C3 … G3, C3 middle C)


def get(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': AGENT}), timeout=120) as r:
                return r.read()
        except Exception as e:
            if k == tries - 1: raise
            print(f'  ({e}; again in {5 * 2 ** k} s)', file=sys.stderr); time.sleep(5 * 2 ** k)


def fetch(o):
    """The projects' compositions, and each one's files (score data)."""
    os.makedirs(DIR, exist_ok=True)
    pieces = set()
    for project in o.projects.split(','):
        page = get(f'{SITE}/database/projects/{int(project)}').decode('utf-8', 'replace'); time.sleep(o.wait)
        pieces |= set(re.findall(r'/database/pieces/(\d+)', page))
    pieces = sorted(pieces, key=int)
    files = []
    for p in pieces:
        html = get(f'{SITE}/database/pieces/{p}').decode('utf-8', 'replace'); time.sleep(o.wait)
        files += [f for f in re.findall(r'/data/music/([\w./-]+\.cmme\.xml)', html) if f not in files]
    got = 0
    for f in files:
        path = os.path.join(DIR, f.replace('/', '__'))
        if os.path.exists(path) and parses(path): continue
        open(path, 'wb').write(get(f'{SITE}/data/music/{f}')); time.sleep(o.wait)
        got += 1
        print(f'{f}{"" if parses(path) else " (not whole on the server: left out)"}', flush=True)
    print(f'{len(files)} files of {len(pieces)} compositions ({got} fetched now) -> {DIR}')


def parses(path):
    try: ET.parse(path); return True
    except ET.ParseError: return False


# ---------------------------------------------------------------- the edition, staff by staff
def T(e): return e.tag[len(NS):] if e.tag.startswith(NS) else e.tag
def kid(e, name): return e.find(NS + name)
def txt(e, name, default=None):
    k = kid(e, name)
    return k.text.strip() if k is not None and k.text else default


def step(e):
    """A pitch (LetterName, OctaveNum) as diatonic steps (A0 = 0)."""
    return int(txt(e, 'OctaveNum')) * 7 + LETTERS.index(txt(e, 'LetterName').upper())


class Staff(Exception): pass                                  # (something the text form can't say: the staff left out)


def readings(events, version):
    """The events as the Occo Codex has them: where CMME gives readings, the one for version (or the default's)."""
    for e in events:
        if T(e) != 'VariantReadings': yield e; continue
        chosen = None
        for r in e.findall(NS + 'Reading'):
            ids = [v.text for v in r.findall(NS + 'VariantVersionID')]
            if version in ids: chosen = r; break
            if 'DEFAULT' in ids and chosen is None: chosen = r
        music = kid(chosen, 'Music') if chosen is not None else None
        if music is not None: yield from readings(list(music), version)


def voice_staves(events, version):
    """One voice's events in the Occo Codex's reading, cut where its staves end: [(page, [tokens] or None)], page
    counting the openings from the voice's first."""
    out, cur, page, bad = [], [], 0, False
    clef = None                                              # (position p of the clef's pitch, its step)
    ligature, lig_black = None, False

    def pos(e):
        if clef is None: raise Staff('a note before any clef')
        return clef[0] + step(e) - clef[1]

    def end(page_end):
        nonlocal cur, page, bad
        if ligature: bad = True                              # (a ligature across the break)
        out.append((page, None if bad or not cur else cur))
        cur, bad = [], False
        if page_end: page += 1

    def add(e):
        nonlocal clef, ligature, lig_black, bad
        t = T(e)
        if kid(e, 'Editorial') is not None: return            # (the editor's, not the manuscript's)
        if t == 'LineEnd':
            end(kid(e, 'PageEnd') is not None); return
        if t == 'Clef':
            app, loc = txt(e, 'Appearance'), int(txt(e, 'StaffLoc'))
            if app == 'Bmol': cur.append(f'b{loc - 1}'); return
            if app in ('Bqua', 'Diesis'): cur.append(f'{"n" if app == "Bqua" else "#"}{loc - 1}'); return
            shape = {'C': 'c', 'F': 'f', 'Frnd': 'f', 'G': 'g'}.get(app)
            if not shape or loc % 2 == 0: raise Staff(f'clef {app} at {loc}')
            clef = (loc - 1, step(kid(e, 'Pitch')))
            cur.append(f'{shape}{(loc + 1) // 2}'); return
        if t == 'Note':
            v = VAL[txt(e, 'Type')]
            p = pos(e)
            black = kid(e, 'Colored') is not None
            lig = txt(e, 'Lig')
            if ligature is not None and v not in ('Mx', 'L', 'B', 'Sb'):
                # (a note no ligature holds after one begun: where a variant reading took the ligature's last note
                # away, its first is left marked; what was begun ends here)
                if len(ligature) == 1:
                    cur.append(ligature[0].rstrip('~') + ('*' if lig_black else ''))
                else:
                    cur.append('[' + ' '.join(ligature).replace('~ ', '~').rstrip('~') + (']*' if lig_black else ']'))
                ligature = None
            if ligature is not None or lig:
                if ligature is None: ligature, lig_black = [], black
                if v not in ('Mx', 'L', 'B', 'Sb') or black != lig_black:
                    ligature = None
                    raise Staff('a ligature of what CGMensural can\'t say (partly black, or of small notes)')
                ligature.append(f'{v}{p}' + ('~' if lig == 'Obliqua' else ''))
                if not lig:                                  # (its last note)
                    # (a last breve below the note before it is written oblique: one drawn square there is a longa,
                    # by the rules of ligatures (CGMensural checks them); an edition that says breve there is left out)
                    if len(ligature) > 1 and v == 'B' and not ligature[-2].endswith('~') and int(re.match(r'[A-Za-z]+(-?\d+)', ligature[-2]).group(1)) > p:
                        ligature = None
                        raise Staff('a square descending last breve')
                    body = ' '.join(ligature).replace('~ ', '~')
                    cur.append('[' + body + (']*' if lig_black else ']')); ligature = None
                return
            stem = txt(kid(e, 'Stem'), 'Dir') if kid(e, 'Stem') is not None else None
            mark = ''
            if stem == 'Up' and v in STEMMED_DOWN: mark = '^'
            elif stem == 'Down' and v not in STEMMED_DOWN and v not in ('B', 'Sb'): mark = 'v'
            cur.append(f'{v}{p}{mark}{"*" if black else ""}'); return
        if t == 'Rest':
            v = VAL[txt(e, 'Type')]
            b, n = int(txt(e, 'BottomStaffLine')), int(txt(e, 'NumSpaces'))
            p = 2 * (b - 1) + n                              # (the middle of the spaces it fills, or its line)
            perf = v == 'L' and n == 3
            cur.append(f'r{v}{"p" if perf else ""}{p}'); return
        if t == 'Dot':
            if kid(e, 'StaffLoc') is not None: cur.append(f'.{int(txt(e, "StaffLoc")) - 1}')
            elif kid(e, 'Pitch') is not None: cur.append(f'.{pos(kid(e, "Pitch"))}')
            return
        if t == 'Custos':
            cur.append(f'+{pos(e)}'); return
        if t == 'Mensuration':
            sign = kid(e, 'Sign')
            if sign is not None:
                s = txt(sign, 'MainSymbol')
                if s not in ('C', 'O'): raise Staff(f'sign {s}')
                if txt(sign, 'Orientation') == 'Reversed': s = 'R'
                s += '.' if kid(sign, 'Dot') is not None else ''
                s += '|' if txt(sign, 'Strokes') == '1' else ''
                cur.append(s)
            num = kid(e, 'Number')
            if num is not None:
                n, d = txt(num, 'Num'), txt(num, 'Den')
                cur.append(n + (f'/{d}' if d else ''))
            return
        if t == 'MiscItem':
            if kid(e, 'Barline') is not None:
                n = int(txt(kid(e, 'Barline'), 'NumLines', '1'))
                cur.append('|' * max(1, min(3, n)))
            elif kid(e, 'Lacuna') is not None: bad = True
            return
        if t == 'MultiEvent':
            kinds = [T(k) for k in e]
            if kinds.count('Note') > 1: bad = True; return     # (two notes at once)
            for k in e: add(k)
            return
        if t == 'ColorChange': bad = True; return
        # (OriginalText, ModernText, Proportion (the editor's reckoning), ModernKeySignature, …: not drawn)

    for e in readings(events, version):
        try: add(e)
        except Staff: bad = True
        except (KeyError, ValueError, TypeError, AttributeError): bad = True
    if cur: end(False)
    return out


def edition(path, source=OCCO):
    """A file's staves: [{piece, voice, page, line, text, tokens}] (text None where the staff can't be said)."""
    root = ET.parse(path).getroot()
    gen = kid(root, 'GeneralData')
    versions = gen.findall(NS + 'VariantVersion')
    # (the source's reading: a version taken from it that isn't the edition's own (named by its source, or the
    # version's ID the source's name, as The Other Josquin names them); else the edition's, if edited from it)
    named = lambda v: txt(v, 'ID') == source or (kid(v, 'Source') is not None and txt(kid(v, 'Source'), 'Name') == source)
    occo = next((txt(v, 'ID') for v in versions if kid(v, 'Default') is None and named(v)), None)
    default_is_occo = any(kid(v, 'Default') is not None and named(v) for v in versions)
    if not occo and not default_is_occo: return []
    version = occo or 'DEFAULT'
    title = f'{txt(gen, "Composer", "")}: {txt(gen, "Title", "")} {txt(gen, "Section", "")}'.strip()
    names = [txt(v, 'Name', '') for v in kid(root, 'VoiceData').findall(NS + 'Voice')]
    events = {}                                              # voice -> its events, section after section
    for sec in root.findall(NS + 'MusicSection'):
        for mm in sec:
            for v in mm.findall(NS + 'Voice'):
                n = int(txt(v, 'VoiceNum'))
                el = kid(v, 'EventList')
                if el is not None: events.setdefault(n, []).extend(list(el))
    out = []
    for n, evs in sorted(events.items()):
        k = 0
        for page, tokens in voice_staves(evs, version):
            k += 1
            out.append({'piece': title, 'file': os.path.basename(path), 'voice': n, 'voice_name': names[n - 1] if n <= len(names) else '',
                        'page': page, 'line': k, 'text': ' '.join(tokens) if tokens else None, 'tokens': tokens})
    return out


def staves(o):
    rows = []
    files = sorted(f for f in os.listdir(DIR) if f.endswith('.cmme.xml'))
    for f in files:
        if not parses(os.path.join(DIR, f)): print(f'{f}: not whole, left out'); continue
        rows += edition(os.path.join(DIR, f), o.source)
    with open(os.path.join(DIR, o.name + '.jsonl'), 'w', encoding='utf-8') as fh:
        for r in rows: fh.write(json.dumps(r) + '\n')
    said = [r for r in rows if r['text']]
    print(f'{len(rows)} staves in {len(files)} files, {len(said)} of them said in the text form '
          f'({sum(len(r["tokens"]) for r in said)} signs) of {o.source} -> {os.path.join(DIR, o.name + ".jsonl")}')


# ---------------------------------------------------------------- pairing with the pages
SKIP = {'[', ']', ']*', '|', '||', '|||'}
def signs(tokens):
    """What is compared: the signs, without ligature brackets and bars (which the reader and the edition may place
    differently), the oblique mark taken off."""
    return [t.rstrip('~') for t in tokens if t not in SKIP and t != '~']


def edits(a, b):
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return d[len(b)]


def pair(o):
    sys.path.insert(0, HERE)
    import numpy as np, torch, recognizer
    from collections import Counter
    from PIL import Image
    import fivestaves as F
    F.N, F.DARK, F.NEAR, F.EVEN = 5, True, 0.3, 0.4           # (ruled by hand)
    m, s = recognizer.restore(o.model)
    rows = [json.loads(l) for l in open(os.path.join(DIR, o.name + '.jsonl'), encoding='utf-8')]
    cands = [r for r in rows if r['text']]
    group = lambda r: (r['file'], r['page'])                 # (an opening of a composition's section)
    vocab = {t: j for j, t in enumerate(sorted({t for r in cands for t in signs(r['tokens'])}))}
    bags = np.zeros((len(cands), len(vocab) + 1), np.float32)   # (each edition staff's signs, counted; the last column: others)
    for i, r in enumerate(cands):
        for t in signs(r['tokens']): bags[i, vocab[t]] += 1
    sizes = bags.sum(1)
    os.makedirs(o.out, exist_ok=True)
    dirs = o.scans.split(',')                                # (several: a set of partbooks, each its own folder)
    pages = [(d, f) for d in dirs for f in sorted(os.listdir(d)) if re.search(r'\.(jpe?g|png)$', f, re.I)]
    found = []                                               # (page, k, file, reading)
    for d, pg in pages:
        name = re.sub(r'\W', '', (os.path.basename(os.path.normpath(d)) + '_' if len(dirs) > 1 else '') + os.path.splitext(pg)[0])
        try: gray, st = F.page(os.path.join(d, pg))
        except Exception as e: print(f'{pg}: {e}'); continue
        arrays = [F.straighten5(gray, lines).astype(np.uint8) for lines, g in st]
        for k, a in enumerate(arrays):
            x, n = recognizer.collate([recognizer.ink(a)])
            with torch.no_grad(): read = recognizer.greedy(m(x), n, s['vocab'])[0][0]
            file = f'{name}-{k + 1}.png'
            Image.fromarray(a).save(os.path.join(o.out, file))
            found.append((name, k, file, read))
        print(f'{pg}: {len(arrays)} staves', flush=True)
    # each staff's nearest staves in the edition (a bag of signs to choose a few, then the edits between them)
    best = {}
    for name, k, file, read in found:
        sg = signs(read)
        if len(sg) < 5: continue
        bag = np.zeros(bags.shape[1], np.float32)
        for t in sg: bag[vocab.get(t, -1)] += 1
        share = np.minimum(bags, bag).sum(1) / np.maximum(sizes, len(sg))
        near = np.argsort(-share)[:o.top].tolist()
        scored = sorted((edits(sg, signs(cands[i]['tokens'])) / max(len(sg), len(cands[i]['tokens'])), i) for i in near)
        best[file] = (name, scored)
    # the page's opening(s): those most of its staves are nearest to; a staff kept only if its edition staff is of one
    by_page = {}
    for file, (name, scored) in best.items(): by_page.setdefault(name, []).append((file, scored))
    used, out = {}, []
    for name, items in by_page.items():
        votes = Counter(group(cands[sc[0][1]]) for f, sc in items if sc and sc[0][0] < o.worth)
        groups = {g for g, v in votes.items() if v >= 2}
        for file, scored in items:
            for cost, i in scored:
                if cost >= o.worth: break
                if group(cands[i]) in groups:
                    if i not in used or used[i][0] > cost: used[i] = (cost, file)
                    break
    kept = {file: (cost, i) for i, (cost, file) in used.items()}
    with open(os.path.join(o.out, 'labels.jsonl'), 'w', encoding='utf-8') as fh:
        for file, (cost, i) in sorted(kept.items()):
            r = cands[i]
            fh.write(json.dumps({'file': file, 'text': r['text'], 'tokens': r['tokens'], 'fit': round(cost, 3),
                                 'from': f'{r["file"]} voice {r["voice"]} staff {r["line"]}'}) + '\n')
    for name, k, file, read in found:                         # (the staves not paired: not kept)
        if file not in kept:
            try: os.remove(os.path.join(o.out, file))
            except OSError: pass
    print(f'{len(kept)} staves paired with the edition, of {len(found)} found on {len(pages)} pages '
          f'(the edition has {len(cands)}) -> {o.out}')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('what', choices=['fetch', 'staves', 'pair'])
    a.add_argument('--wait', type=float, default=2.0, help='fetch: seconds between requests')
    a.add_argument('--projects', default=str(PROJECT), help='fetch: CMME\'s editorial projects (4 Occo, 9 Berchem, 14 The Other Josquin)')
    a.add_argument('--source', default=OCCO, help='staves: the source, as CMME names its reading (BrusBR IV.922, KasL 24, RosU 49, …)')
    a.add_argument('--name', default='occo', help='staves, pair: what its staves are called (training/data/cmme/<name>.jsonl)')
    a.add_argument('--scans', help='pair: the pages (cantus.py collect), a folder or several, comma between (training/data/scans/<name>)')
    a.add_argument('--model', help='pair: the mensural reader\'s checkpoint')
    a.add_argument('--out', help='pair: training/data/<name>')
    a.add_argument('--worth', type=float, default=0.6, help='pair: kept if fewer than this share of signs differ')
    a.add_argument('--top', type=int, default=25, help='pair: edition staves compared closely with each staff found')
    o = a.parse_args()
    o.scans = o.scans or os.path.join(HERE, 'data', 'scans', o.name)
    o.out = o.out or os.path.join(HERE, 'data', o.name)
    {'fetch': fetch, 'staves': staves, 'pair': pair}[o.what](o)
