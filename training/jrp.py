"""The Josquin Research Project's scores (https://josquin.stanford.edu; the dataset github.com/josquin-research-project/
jrp-scores, CC BY-NC 4.0, Jesse Rodin, Craig Sapp et al.) as staves of mensural notation, for mensuralsynth.py to draw:
real music of c. 1420-1540 (Josquin, La Rue, Ockeghem, Obrecht, Busnoys, Dufay, Isaac …) instead of made-up melodies.

JRP keeps the original note values (a breve is a breve), the mensuration signs, and where the sources have
ligatures (*lig … *Xlig) and coloration (*col … *Xcol); its accidentals are the sources' unless marked editorial (i, j).
Its clefs are modern, and it has no line breaks: here each voice is given the clef a scribe would have used for its
range (as Serenissima Press chooses period clefs: one that keeps every note within a ledger line of the staff), and is
broken into staves of 10 to 30 signs, each beginning with its clef (and flat), each ending with a custos (or, where a
section ends, a double bar). Editorial accidentals are left out; a note the sources write as a long at the end (l) is
a long. A staff with anything the text form can't say (a value no note has, a ligature the rules don't allow, a note
out of reach) is left out.

    git clone --depth 1 https://github.com/josquin-research-project/jrp-scores /path/to/jrp
    python -I training/jrp.py --scores /path/to/jrp [--out training/data/jrp/lines.jsonl]

Writes one staff a line (and words.txt beside it, the words the voices sing, for mensuralsynth.py --words): {piece, voice, items (mensuralsynth's items), text (CGMensural's text form)}."""
import argparse, glob, json, os, random, re, sys
from fractions import Fraction as Fr
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mensuralsynth as M

VALUE = {Fr(8): 'Mx', Fr(4): 'L', Fr(2): 'B', Fr(1): 'Sb', Fr(1, 2): 'M', Fr(1, 4): 'Sm', Fr(1, 8): 'F', Fr(1, 16): 'Sf'}
CLEFS = [('C', 1), ('C', 3), ('C', 4), ('F', 4), ('G', 2), ('C', 2), ('F', 3)]   # (the common ones first, as Serenissima Press)
CLEF_AT = {'C': 28, 'F': 24, 'G': 32}                       # (the pitch each clef names: c', f, g', as diatonic numbers)
LO, HI = -2, 10                                             # (within a ledger line of the staff)


def duration(tok):
    """A kern token's duration in semibreves (1 = a whole note = a semibreve, JRP keeping the original values)."""
    m = re.match(r'(\d+)(?:%(\d+))?(\.*)', tok)
    if not m: return None
    r = m.group(1)
    if re.fullmatch(r'0+', r): d = Fr(2 ** len(r))
    else: d = Fr(int(m.group(2) or 1), int(r)) if int(r) else None
    if d is None: return None
    dots = len(m.group(3))
    return d * (2 - Fr(1, 2 ** dots)) if dots else d


def pitch(tok):
    """(diatonic number: c' = 28, the accidental as written in the sources or None, editorial?)"""
    m = re.search(r'([a-gA-G])\1*', tok)
    if not m: return None
    letters = m.group(0)
    step = 'cdefgab'.index(letters[0].lower())
    octave = 3 + len(letters) if letters[0].islower() else 4 - len(letters)
    acc = re.search(r'(#+|-+|n)([ij]?)', tok[m.end():])
    return octave * 7 + step, (acc.group(1)[0] if acc else None), bool(acc and acc.group(2))


def written(d, perfect_b, major):
    """A duration as a mensural value: (value, dot, black), or None. Under perfect tempus a breve of three semibreves is
    a breve; under major prolation a semibreve of three minims a semibreve; three of the next value smaller, coloured,
    take the time of two (black)."""
    if perfect_b and d == 3: return 'B', False, False
    if major and d == Fr(3, 2): return 'Sb', False, False
    if d in VALUE: return VALUE[d], False, False
    if d * Fr(2, 3) in VALUE: return VALUE[d * Fr(2, 3)], True, False
    if d * Fr(3, 2) in VALUE: return VALUE[d * Fr(3, 2)], False, True
    return None


def spines(path):
    """The file's **kern spines, each [(kind, value)] in order: ('tok', t), ('*', interpretation), ('=', barline)."""
    rows = [l.rstrip('\n').split('\t') for l in open(path, encoding='utf-8', errors='replace') if l.strip() and not l.startswith('!!')]
    if not rows or any(c in ('*^', '*v', '*+', '*-') and not all(x == '*-' for x in r) for r in rows for c in r): return None, {}
    heads = rows[0]
    kern = [i for i, h in enumerate(heads) if h == '**kern']
    out = {i: [] for i in kern}
    names = {}
    for r in rows[1:]:
        if len(r) != len(heads): return None, {}
        for i in kern:
            c = r[i]
            if c.startswith('!'): continue
            if c.startswith('*I"'): names[i] = c[3:]
            if c.startswith('='): out[i].append(('=', c))
            elif c.startswith('*'): out[i].append(('*', c))
            elif c != '.': out[i].append(('tok', c.split(' ')[0]))
    return out, names


def voice_items(events):
    """One voice as mensuralsynth's items (no clef yet: notes at diatonic numbers, 'd'), with 'section' marks."""
    items, perfect_b, major, key, lig, col, tie = [], False, False, set(), None, False, None
    bad = False

    def put(it):
        if lig is not None and it['k'] == 'note': lig.append(it)
        else: items.append(it)

    for kind, v in events:
        if kind == '*':
            if v.startswith('*met('):
                s = v[5:-1]
                if not s: continue
                perfect_b, major = 'O' in s, '.' in s
                m = re.fullmatch(r'([CO])?(\.)?(\|)?/?(\d(?:/\d)?)?', s)
                if not m: continue
                if m.group(1): items.append(dict({'k': 'sign', 'sign': m.group(1)}, **({'dot': True} if m.group(2) else {}), **({'stroke': True} if m.group(3) else {})))
                if m.group(4) and m.group(4) in ('2', '3', '3/2'): items.append({'k': 'num', 'text': m.group(4)})
            elif v.startswith('*k['):
                key = {(a[0], a[1]) for a in re.findall(r'([a-g])([-#])', v)}
                items.append({'k': 'key', 'key': sorted(key)})
            elif v == '*lig': lig = []
            elif v == '*Xlig':
                if lig: items.append({'k': 'lig', 'notes': lig})
                lig = None
            elif v == '*col': col = True
            elif v == '*Xcol': col = False
            continue
        if kind == '=':
            if v.startswith('=='): items.append({'k': 'section'})
            continue
        t = v
        d = duration(t)
        if d is None: bad = True; continue
        if 'r' in t:                                        # (a silence the edition writes bar by bar: one, as the sources)
            if items and items[-1]['k'] == 'rest' and items[-1]['perfect_b'] == perfect_b and lig is None: items[-1]['d'] += d
            else: items.append({'k': 'rest', 'd': d, 'perfect_b': perfect_b})
            continue
        pt = pitch(t)
        if pt is None: bad = True; continue
        dia, acc, editorial = pt
        if '_' in t or ']' in t:                            # (tied on: the edition's tie across its barline, one note)
            if tie is not None: tie['d'] += d
            if ']' in t: tie = None
            continue
        note = {'k': 'note', 'dia': dia, 'd': d, 'perfect_b': perfect_b, 'major': major}
        if 'l' in t: note['long'] = True
        if col: note['black'] = True
        if acc and not editorial and (t[re.search(r'[a-gA-G]', t).start()].lower(), acc) not in key and not (acc == 'n' and not any(k[0] == t[0].lower() for k in key)):
            put({'k': 'acc', 'a': {'-': 'b', '#': '#', 'n': 'n'}[acc], 'dia': dia})
        put(note)
        tie = note if '[' in t else None
    return items, bad


def finish(it):
    """A note's value from its (merged) duration: False if none fits."""
    if it.get('long'): it['v'] = 'L'; return True
    w = written(it['d'], it['perfect_b'], it['major'])
    if not w: return False
    it['v'], it['dot'], black = w
    if black: it['black'] = True
    return True


def rests(d, perfect_b):
    """A rest's duration as rests' values (a breve rest worth three semibreves under perfect tempus)."""
    out, sizes = [], [('L', 4 if not perfect_b else 6), ('B', 3 if perfect_b else 2), ('Sb', 1), ('M', Fr(1, 2)), ('Sm', Fr(1, 4)), ('F', Fr(1, 8))]
    for v, s in sizes:
        while d >= s: out.append(v); d -= s
    return out if d == 0 and len(out) <= 6 else None


REST_AT = {'L': (2, 4), 'B': (3, 5), 'Sb': (4, 6), 'M': (2, 4), 'Sm': (2, 4), 'F': (2, 4)}


def choose_clef(dias):
    lo, hi = min(dias), max(dias)
    best = None
    for k, (shape, line) in enumerate(CLEFS):
        base = 2 * (line - 1) - CLEF_AT[shape]
        a, b = lo + base, hi + base
        over = max(0, LO - a) + max(0, b - HI)
        score = (over, abs((a + b) / 2 - 4) + 0.3 * k)
        if best is None or score < best[0]: best = (score, (shape, line), base)
    return best[1], best[2]


def staves(items, rng):
    """One voice's items cut into staves: [[items]] in CGMensural's terms (positions on the chosen clef)."""
    dias = [n['dia'] for it in items for n in (it['notes'] if it['k'] == 'lig' else [it]) if it['k'] == 'note' or it['k'] == 'lig']
    if not dias: return []
    (shape, line), base = choose_clef(dias)
    key = []
    music = []                                               # (the items placed, a section's end marked)
    ok = True
    for it in items:
        k = it['k']
        if k == 'key': key = it['key']; continue
        if k == 'section': music.append({'k': 'section'}); continue
        if k in ('sign', 'num'): music.append(dict(it)); continue
        if k == 'acc': music.append({'k': 'acc', 'a': it['a'], 'p': it['dia'] + base}); continue
        if k == 'rest':
            vs = rests(it['d'], it['perfect_b'])
            if vs is None: music.append({'k': 'bad'}); continue
            for v in vs: music.append({'k': 'rest', 'v': v, 'p': rng.choice(REST_AT[v])})
            continue
        if k == 'note':
            if not finish(it): music.append({'k': 'bad'}); continue
            n = {'k': 'note', 'v': it['v'], 'p': it['dia'] + base}
            if it.get('black'): n['color'] = 'black'
            music.append(n)
            if it.get('dot'): music.append({'k': 'dot', 'p': n['p'] if n['p'] % 2 else n['p'] + 1})
            continue
        if k == 'lig':
            ns = it['notes']
            good = len(ns) >= 2 and all(finish(n) and not n.get('dot') for n in ns)
            vals = [n.get('v') for n in ns]
            if good: good = all(v in ('Mx', 'L', 'B', 'Sb') for v in vals) and ('Sb' not in vals or (vals[0] == vals[1] == 'Sb' and 'Sb' not in vals[2:]))
            black = {bool(n.get('black')) for n in ns}
            if good:
                notes = [dict({'v': n['v'], 'p': n['dia'] + base}, **({'color': 'black'} if n.get('black') and len(black) > 1 else {})) for n in ns]
                if notes[-1]['v'] == 'B' and notes[-1]['p'] < notes[-2]['p'] and not (len(notes) == 2 and notes[0]['v'] == 'Sb'): notes[-2]['obl'] = True
                if notes[-1]['v'] == 'B' and notes[-1]['p'] > notes[-2]['p'] and notes[0]['v'] == 'Sb' and len(notes) == 2: pass
                if any(n.get('obl') and n.get('color') != m.get('color') for n, m in zip(notes, notes[1:])):
                    music.append({'k': 'bad'}); continue           # (an oblique half black: not as CGMensural writes it)
                lg = {'k': 'lig', 'notes': notes}
                if black == {True}: lg['color'] = 'black'
                music.append(lg)
            else:                                            # (not as the rules write it: the notes apart)
                for n in ns:
                    if not finish(n): music.append({'k': 'bad'}); continue
                    music.append(dict({'k': 'note', 'v': n['v'], 'p': n['dia'] + base}, **({'color': 'black'} if n.get('black') else {})))
            continue
    # cut into staves
    out, i = [], 0
    while i < len(music):
        want = rng.randint(10, 30)
        body = []
        while i < len(music) and len(body) < want and music[i]['k'] != 'section':
            body.append(music[i]); i += 1
        ended = i < len(music) and music[i]['k'] == 'section'
        if ended: i += 1
        if not any(b['k'] in ('note', 'lig', 'rest') for b in body): continue
        head = [{'k': 'clef', 'shape': shape, 'line': line}]
        for step, acc in key:
            if acc != '-': continue
            d0 = 'cdefgab'.index(step)
            ps = [o * 7 + d0 + base for o in range(1, 7) if 0 <= o * 7 + d0 + base <= 8]
            if ps: head.append({'k': 'acc', 'a': 'b', 'p': rng.choice(ps)})
        tail = []
        if ended or i >= len(music): tail = [{'k': 'bar', 'form': 'double' if i < len(music) else rng.choice(['double', 'end'])}]
        else:
            nxt = next((m for m in music[i:] if m['k'] in ('note', 'lig')), None)
            if nxt: tail = [{'k': 'custos', 'p': (nxt['notes'][0] if nxt['k'] == 'lig' else nxt)['p']}]
        st = head + body + tail
        ps = [n['p'] for it in st for n in (it['notes'] if it['k'] == 'lig' else [it]) if it['k'] in ('note', 'lig', 'custos', 'acc')]
        if any(it['k'] == 'bad' for it in st) or any(p < LO or p > HI for p in ps): continue
        if sum(it['k'] == 'rest' for it in st) > 0.4 * len(body): continue           # (a voice resting: not a staff)
        out.append(st)
    return out


def lyrics(path):
    """The words sung (the **text spines), syllables joined: for under the staves drawn."""
    rows = [l.rstrip('\n').split('\t') for l in open(path, encoding='utf-8', errors='replace') if l.strip() and not l.startswith('!!')]
    if not rows: return []
    out = []
    for i in [i for i, h in enumerate(rows[0]) if h == '**text']:
        cur = ''
        for r in rows[1:]:
            if i >= len(r): break
            c = r[i]
            if c.startswith(('*', '=', '!')) or c == '.': continue
            c = re.sub(r'[^\w\-]', '', c.replace('|', ''))
            if not c: continue
            if c.startswith('-'): cur += c.strip('-')
            else:
                if cur: out.append(cur)
                cur = c.strip('-')
            if not c.endswith('-'):
                if cur: out.append(cur)
                cur = ''
    return [w for w in out if w.isalpha() and w.isascii()]


def main(o):
    rng = random.Random(o.seed)
    os.makedirs(os.path.dirname(o.out), exist_ok=True)
    files = sorted(glob.glob(os.path.join(o.scores, '*', '*.krn')))
    n = kept = skipped = 0
    words = []
    with open(o.out, 'w', encoding='utf-8') as fh:
        for f in files:
            words += lyrics(f)
            sp, names = spines(f)
            if sp is None: skipped += 1; continue
            for i, ev in sp.items():
                items, bad = voice_items(ev)
                for st in staves(items, rng):
                    t = M.text(st)
                    fh.write(json.dumps({'piece': os.path.basename(f)[:-4], 'voice': names.get(i, ''), 'items': st, 'text': t}) + '\n')
                    kept += 1
            n += 1
    open(os.path.join(os.path.dirname(o.out), 'words.txt'), 'w', encoding='utf-8').write(' '.join(words))
    print(f'{len(words)} words sung, for under the staves -> {os.path.join(os.path.dirname(o.out), "words.txt")}')
    print(f'{kept} staves from {n} scores ({skipped} left out: voices split in two) -> {o.out}')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--scores', required=True, help='a clone of jrp-scores')
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'jrp', 'lines.jsonl'))
    a.add_argument('--seed', type=int, default=1)
    main(a.parse_args())
