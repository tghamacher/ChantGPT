"""Editions paired with the sources they were made from: each staff on a facsimile's page given what an edition of the
same music says is on it. The reader reads the staff; the stretch of the edition it reads most like is found (the
edition's voices searched by their intervals, so that a transposed edition is found as readily as one at pitch); and
the reading is put right by the edition, note by note: a note's place on the staff from the edition's pitch, a note
the reader missed put in, one it saw that isn't there taken out. What an edition can't say about the page (the
clef's shape, a ligature, a custos, a dot, a mensuration sign, the black of a note) is the reader's, where the edition's
durations agree with it.

The edition may be:
  - at the source's pitch and values (the Josquin Research Project's, which keep the sources' note values: a breve a
    breve) or transposed, or with the values halved or quartered (as most modern editions are): both are found
    (the transposition as the shift, in steps, that most staves read; the reduction as the one most notes' durations
    fit), and undone;
  - Humdrum **kern (JRP's .krn) or MusicXML (.musicxml, .xml, .mxl: Serenissima Press's, MuseScore's, Sibelius's …);
    an edition's bar lines, ties, editorial accidentals and modern clefs don't matter (only its pitches as steps of the
    scale and its durations are used).

Use editions you may use for training: the JRP's (CC BY-NC 4.0), your own, ones their editors have said you may.

    python -I training/edition.py pair --editions training/data/jrp-jos/Jos2*.krn --scans training/data/scans/petrucci-jos1 \\
        --model training/data/m0086/best.pt --print [--out training/data/petrucci] [--worth 0.3]
    python -I training/edition.py selftest --editions /path/to/jrp/Jos/Jos0302a-*.krn     # (no pages, no reader needed)
    python -I training/edition.py pages --downloads "C:\\Users\\…\\EMS Tools" --out training/data/scans/petrucci
        # (IMSLP's PDFs, downloaded by the user: a folder of page images each, facing pages cut in two)

pair writes <out>/<page>-<k>.png (straightened as fivestaves.py cuts five-line staves) and <out>/labels.jsonl ({file,
text, tokens, fixed (how many signs the edition put right), fit, from}); and says the transposition and reduction it
found for each edition. --print: a printed book's staves (printstaves.py); else ruled by hand (fivestaves.py).

selftest: each edition's voices cut into staves as a scribe would write them (jrp.py), read as a reader would, wrongly
now and then (a step off, a value mistaken, a note missed or one seen that isn't there); the edition itself written
out transposed down a fourth with its values halved, as MusicXML; and the readings put right by it: how often the
labels come out as the staves really are."""
import argparse, glob, io, json, os, random, re, sys, time, zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from fractions import Fraction as Fr
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

VAL = '(Mx|Sb|Sm|Sf|L|B|M|F)'
BASE = {'Mx': Fr(8), 'L': Fr(4), 'B': Fr(2), 'Sb': Fr(1), 'M': Fr(1, 2), 'Sm': Fr(1, 4), 'F': Fr(1, 8), 'Sf': Fr(1, 16)}
BY_DUR = {d: v for v, d in BASE.items()}
CLEF_AT = {'c': 28, 'f': 24, 'g': 32}                       # (the pitch each clef names, as steps: c' = 28)
CLEFS = ['c1', 'c2', 'c3', 'c4', 'c5', 'f3', 'f4', 'f5', 'g1', 'g2']
REDUCTIONS = [Fr(1), Fr(2), Fr(4), Fr(1, 2)]                # (the source's values the edition's times this)
SHIFT = 'shift'
OFFBEAT = 0.3                                                # (a staff more of whose notes than this don't last as the edition's: not kept)
IN_TIME = 0.15                                               # (a staff in time with the edition: as few as this don't; of an edition's staves, IN_TIME_SHARE must be)
IN_TIME_SHARE = 0.2
COMMON = 30000                                               # (an interval trigram in more places than this: not used to find a staff)


def clef_base(tok):
    """A clef's base: a note's place on the staff (0 the bottom line) is its pitch (steps) plus this."""
    return 2 * (int(tok[1]) - 1) - CLEF_AT[tok[0]]


# ---- editions: each voice as [('n', step, dur) or ('r', dur)], dur in semibreves (None: a final note held, any length)

def kern_voices(path):
    import jrp
    sp, names = jrp.spines(path)
    if sp is None: return []
    out = []
    for i, ev in sp.items():
        items, bad = jrp.voice_items(ev)
        evs = []
        for it in items:
            if it['k'] in ('note', 'lig'):
                for n in (it['notes'] if it['k'] == 'lig' else [it]):
                    evs.append(['n', n['dia'], None if n.get('long') else Fr(n['d'])])
            elif it['k'] == 'rest':
                if evs and evs[-1][0] == 'r': evs[-1][1] += it['d']
                else: evs.append(['r', Fr(it['d'])])
        if any(e[0] == 'n' for e in evs): out.append((names.get(i, str(i)), evs))
    return out


def musicxml_root(path):
    if path.lower().endswith('.mxl'):
        z = zipfile.ZipFile(path)
        name = None
        if 'META-INF/container.xml' in z.namelist():
            c = ET.fromstring(z.read('META-INF/container.xml'))
            rf = next((e for e in c.iter() if e.tag.endswith('rootfile')), None)
            if rf is not None: name = rf.get('full-path')
        name = name or next(n for n in z.namelist() if n.endswith('.xml') and not n.startswith('META-INF'))
        return ET.fromstring(z.read(name))
    return ET.parse(path).getroot()


def musicxml_voices(path):
    """MusicXML's parts (partwise), each its first voice: notes and rests, ties joined, chords' lower notes left."""
    root = musicxml_root(path)
    strip = lambda t: t.split('}', 1)[-1]
    names = {p.get('id'): (p.findtext('part-name') or p.get('id')) for p in root.iter('score-part')}
    out = []
    for part in root.iter('part'):
        div, evs, voice, tied = Fr(1), [], None, False
        for m in part.iter('measure'):
            for e in m:
                tag = strip(e.tag)
                if tag == 'attributes' and e.findtext('divisions'): div = Fr(int(float(e.findtext('divisions'))))
                if tag != 'note' or e.find('chord') is not None or e.find('grace') is not None: continue
                v = e.findtext('voice') or '1'
                if voice is None: voice = v
                if v != voice or e.findtext('duration') is None: continue
                d = Fr(int(float(e.findtext('duration')))) / div / 4        # (quarters to whole notes: semibreves)
                if e.find('rest') is not None:
                    if evs and evs[-1][0] == 'r': evs[-1][1] += d
                    else: evs.append(['r', d])
                    tied = False; continue
                p = e.find('pitch')
                if p is None: continue
                step = int(p.findtext('octave')) * 7 + 'CDEFGAB'.index(p.findtext('step').upper())
                ties = {t.get('type') for t in e.findall('tie')}
                if tied and evs and evs[-1][0] == 'n' and evs[-1][1] == step:
                    if evs[-1][2] is not None: evs[-1][2] += d
                else:
                    held = e.find('notations/fermata') is not None
                    evs.append(['n', step, None if held else d])
                tied = 'start' in ties
        if any(x[0] == 'n' for x in evs): out.append((names.get(part.get('id'), part.get('id')), evs))
    return out


def load(paths):
    """{edition name: [(voice name, events)]}."""
    out = {}
    for p in paths:
        name = os.path.splitext(os.path.basename(p))[0]
        try:
            vs = kern_voices(p) if p.lower().endswith('.krn') else musicxml_voices(p)
        except Exception as e:
            print(f'{p}: not read ({e})'); continue
        if vs: out[name] = vs
    return out


# ---- a reading: its tokens as events, each knowing the tokens it came from

def events_of(tokens):
    """[{kind 'n'|'r', p, v, black, dot, at: [token indices], lig: inside a ligature}] and the clef (the first)."""
    evs, clef, lig = [], None, False
    for i, t in enumerate(tokens):
        if re.fullmatch(r'[cfg][1-5]', t):
            if clef is None: clef = t
            continue
        if t == '[': lig = True; continue
        if t in (']', ']*'): lig = False; continue
        m = re.fullmatch(VAL + r'(-?\d+)([v^]?)(\*?)', t)
        if m:
            evs.append({'kind': 'n', 'v': m.group(1), 'p': int(m.group(2)), 'black': bool(m.group(4)), 'dot': False, 'at': [i], 'lig': lig})
            continue
        m = re.fullmatch(r'r' + VAL + r'(p?)(-?\d+)', t)
        if m:
            d = BASE[m.group(1)] * (Fr(3, 2) if m.group(2) else 1)
            if evs and evs[-1]['kind'] == 'r' and evs[-1]['at'][-1] == i - 1:
                evs[-1]['ds'].append((m.group(1), bool(m.group(2)))); evs[-1]['at'].append(i)
            else:
                evs.append({'kind': 'r', 'ds': [(m.group(1), bool(m.group(2)))], 'p': int(m.group(3)), 'at': [i], 'lig': False})
            continue
        if re.fullmatch(r'\.-?\d+', t) and evs and evs[-1]['kind'] == 'n': evs[-1]['dot'] = True; evs[-1]['at'].append(i)
    return evs, clef


UP = {'Sb': 'B', 'M': 'Sb', 'B': 'L', 'L': 'Mx'}


def note_fits(e, d, perf=None):
    """Can the reader's note e last d semibreves (in the source's values)? Plain: its value, perfected (a dot the
    reader didn't see is the reader's to say), or altered (if the next larger value may be perfect here: perf, the
    values that may; None, any); black: two thirds of it, or of it perfect; dotted: half again."""
    if d is None: return True
    v = e['v']; b = BASE[v]
    may = lambda x: perf is None or x in perf
    if e['dot']: ok = {b * Fr(3, 2), b}
    elif e['black']: ok = {b * Fr(2, 3)} | ({b} if may(v) else set())
    else: ok = {b, b * Fr(3, 2)} | ({b * 2} if v in UP and may(UP[v]) else set())   # (perfect, not dotted: the reader saw no dot)
    return d in ok


def perfect_here(tokens, evs, ops, stretch, red, carried=()):
    """The values that may be perfect on a staff: those the mensuration signs read make so (O: the breve; C. or O.:
    the semibreve), those a note read without a dot lasts half again of in the edition (a dotted note's half again is
    its dot's), and those the voice's last staff had (carried)."""
    perf = set(carried)
    for t in tokens:
        if t in ('C', 'C|'): perf -= {'B', 'Sb'}
        if t.startswith('O'): perf.add('B')
        if t in ('C.', 'O.', 'C.|', 'O.|'): perf.add('Sb')
    for op, i, j in ops:
        if op == 'm' and evs[i]['kind'] == 'n' and not evs[i]['dot'] and not evs[i]['black'] and 0 <= j < len(stretch):
            e = stretch[j]
            if e[0] == 'n' and e[2] is not None and e[2] * red == BASE[evs[i]['v']] * Fr(3, 2): perf.add(evs[i]['v'])
    return perf


def rest_options(ds):
    """The lengths a run of rests can mean: a breve rest two semibreves or (under perfect tempus) three, a longa four or six."""
    opts = {Fr(0)}
    for v, perfect in ds:
        b = BASE[v] * (Fr(3, 2) if perfect else 1)
        step = {b} | ({b * Fr(3, 2)} if v in ('B', 'L') and not perfect else set())
        opts = {o + s for o in opts for s in step}
    return opts


# ---- the search: the edition's notes indexed by their intervals, three at a time

def rhythm(a, b):
    """From one note's length to the next's: longer (1), shorter (-1), or about the same (0: within half again, so
    that a perfect breve and an imperfect one, a dotted note and its plain neighbour, read the same)."""
    if a is None or b is None or not a or not b: return 0
    import math
    r = math.log2(b / a)
    return 0 if abs(r) < 0.7 else (1 if r > 0 else -1)


def read_length(e):
    """A note read: its length as its sign says it (dotted half again, black two thirds), perfection aside."""
    return BASE[e['v']] * (Fr(3, 2) if e['dot'] else 1) * (Fr(2, 3) if e['black'] else 1)


class Index:
    def __init__(self, eds):
        self.voices = []                                     # (edition, voice name, events, the notes' event indices)
        self.grams = defaultdict(list)                       # (three intervals)
        self.rgrams = defaultdict(list)                      # (three intervals and the rhythm between the four notes)
        for ed, vs in eds.items():
            for vn, evs in vs:
                notes = [k for k, e in enumerate(evs) if e[0] == 'n']
                vid = len(self.voices)
                self.voices.append((ed, vn, evs, notes))
                steps = [evs[k][1] for k in notes]
                ds = [evs[k][2] for k in notes]
                for i in range(len(steps) - 3):
                    g = (steps[i + 1] - steps[i], steps[i + 2] - steps[i + 1], steps[i + 3] - steps[i + 2])
                    self.grams[g].append((vid, i))
                    self.rgrams[g + tuple(rhythm(ds[i + k], ds[i + k + 1]) for k in range(3))].append((vid, i))

    def candidates(self, ps, ds=None, top=8):
        """Where in the edition a run of places on the staff (ps: its notes' places, in order; ds: their lengths as
        read) may be: [(votes, voice, the edition's note index the staff's first note would be, shift: place minus
        step)]. A run of intervals with its rhythm counts twice; a run of intervals so common it is everywhere, not
        at all."""
        votes = Counter(); shifts = defaultdict(Counter)
        def vote(hits, j, w):
            for vid, i in hits:
                key = (vid, (i - j) // 3)
                votes[key] += w
                shifts[key][(ps[j] - self.voices[vid][2][self.voices[vid][3][i]][1], i - j)] += 1
        for j in range(len(ps) - 3):
            g = (ps[j + 1] - ps[j], ps[j + 2] - ps[j + 1], ps[j + 3] - ps[j + 2])
            hits = self.grams.get(g, ())
            if len(hits) <= COMMON: vote(hits, j, 1)
            if ds:
                rh = self.rgrams.get(g + tuple(rhythm(ds[j + k], ds[j + k + 1]) for k in range(3)), ())
                if len(rh) <= COMMON: vote(rh, j, 2)
        out = []
        for key, n in votes.most_common(top):
            if n < 3: break
            (shift, start), _ = shifts[key].most_common(1)[0]
            out.append((n, key[0], start, shift))
        return out


def align(staff, ed, shift, red, custos=None, perf=None, fixed_start=False):
    """The cheapest way to make the staff's events (staff) the edition's (ed, a stretch of a voice), the edition's
    first and last events free to be left out (the staff begins and ends anywhere in it). red: the reduction (None:
    durations not yet known, so not weighed). Returns (cost, [(op, i, j)]: 'm' paired, 'd' the staff's left out, 'i' the
    edition's put in), j0 and j1 the stretch used."""
    n, m = len(staff), len(ed)
    INF = 1e9
    D = [[INF] * (m + 1) for _ in range(n + 1)]
    B = [[None] * (m + 1) for _ in range(n + 1)]
    for j in range(m + 1): D[0][j] = 1.2 * j if fixed_start else 0   # (fixed: the staff begins where the edition does)
    def sub(a, b):
        if a['kind'] == 'n' and b[0] == 'n':
            c = 0 if a['p'] == b[1] + shift else 1
            if red is not None and not note_fits(a, None if b[2] is None else b[2] * red, perf): c += 0.5
            return c
        if a['kind'] == 'r' and b[0] == 'r':
            return 0 if red is None or b[1] * red in rest_options(a['ds']) else 0.5
        return 1.6
    for i in range(1, n + 1):
        for j in range(0, m + 1):
            best, how = D[i - 1][j] + 1.2, 'd'
            if j:
                c = D[i - 1][j - 1] + sub(staff[i - 1], ed[j - 1])
                if c < best: best, how = c, 'm'
                c = D[i][j - 1] + 1.2
                if c < best: best, how = c, 'i'
            D[i][j], B[i][j] = best, how
    def end_cost(j):                                         # (the custos: the place of the edition's next note)
        if custos is None: return 0
        nxt = next((e for e in ed[j:] if e[0] == 'n'), None)
        return 0.4 if nxt is None else (0 if nxt[1] + shift == custos else 0.8)
    j1 = min(range(m + 1), key=lambda j: D[n][j] + end_cost(j))
    ops, i, j = [], n, j1
    while i > 0:
        how = B[i][j]
        ops.append((how, i - 1, j - 1))
        if how == 'm': i, j = i - 1, j - 1
        elif how == 'd': i -= 1
        else: j -= 1
    j0 = j
    return D[n][j1], ops[::-1], j0, j1


def match(index, tokens, worth, hint=None):
    """The stretch of the edition a reading is of: (cost share, voice id, j0, j1, shift, ops, events) or None. hint:
    (voice id, event index, shift) where the staff before it ended (the next staff on a page, or the page after, most
    often goes on with the same voice), tried as well."""
    evs, clef = events_of(tokens)
    notes_read = [e for e in evs if e['kind'] == 'n']
    ps = [e['p'] for e in notes_read]
    if len(ps) < 6 or clef is None: return None
    cands = index.candidates(ps, [read_length(e) for e in notes_read])
    if hint:
        vid, j, shift = hint
        cands.append((0, vid, sum(1 for e in index.voices[vid][2][:j] if e[0] == 'n'), shift))
    best = None
    for votes, vid, start, shift in cands:
        ed, vn, eevs, notes = index.voices[vid]
        first = notes[max(0, min(len(notes) - 1, start))] if start >= 0 else 0
        lo = max(0, first - 15); hi = min(len(eevs), first + 2 * len(evs) + 15)
        cost, ops, j0, j1 = align(evs, eevs[lo:hi], shift, None, custos_of(tokens))
        share = cost / len(evs)
        if best is None or share < best[0]: best = (share, vid, lo + j0, lo + j1, shift, [(op, i, j - j0) for op, i, j in ops], evs)
    return best if best and best[0] <= worth else None


def custos_of(tokens):
    c = [int(t[1:]) for t in tokens if re.fullmatch(r'\+-?\d+', t)]
    return c[-1] if c else None


def written(d, perf=()):
    """A length (semibreves, the source's values) as one sign, if a plain one says it: (value, dot); half again of a
    value that may be perfect here (perf), that value, perfect."""
    if d in BY_DUR: return BY_DUR[d], False
    if d * Fr(2, 3) in BY_DUR and BY_DUR[d * Fr(2, 3)] in perf: return BY_DUR[d * Fr(2, 3)], False
    if d * Fr(2, 3) in BY_DUR: return BY_DUR[d * Fr(2, 3)], True
    return None


def rest_place(v, near, perfect=False):
    """A rest's place: the semibreve's, minim's (and smaller), the longa's and the maxima's on a line (even), the
    breve's and a perfect longa's in a space (odd), near where the reader saw it."""
    space = v == 'B' or (v == 'L' and perfect)
    return near if (near % 2 == 1) == space else near + 1


def label(tokens, index, m, red, start=None, carried=()):
    """The reading put right by the edition: (tokens, how many signs changed) or None (something the edition can't
    say for certain: a note to put in with no single sign for its length, a change inside a ligature)."""
    share, vid, j0, j1, shift, _, evs = m
    ed, vn, eevs, notes = index.voices[vid]
    lo, hi = (start if start is not None else max(0, j0 - 4)), min(len(eevs), j1 + 4)
    perf = perfect_here(tokens, evs, m[5], eevs[j0:j1], red, carried)
    cost, ops, a, b = align(evs, eevs[lo:hi], shift, red, custos_of(tokens), perf, start is not None)
    stretch = eevs[lo + a:lo + b]
    ops = [(op, i, j - a) for op, i, j in ops]
    j0, b = lo + a, b - a
    out_at = {}                                              # (a token index: what it becomes; [] to leave it out)
    before = defaultdict(list)                               # (a token index: what is put in before it)
    fixed = 0
    def render(e, near):
        if e[0] == 'n':
            if e[2] is None: return None
            w = written(e[2] * red, perf)
            if not w: return None
            t = [f'{w[0]}{e[1] + shift}']
            if w[1]: t.append(f'.{e[1] + shift if (e[1] + shift) % 2 else e[1] + shift + 1}')
            return t
        import jrp
        vs = jrp.rests(e[1] * red, False)
        if not vs: return None
        return [f'r{v}{rest_place(v, near)}' for v in vs]
    last_tok = 0
    paired = offbeat = 0
    for op, i, j in ops:
        if op == 'm':
            s, e = evs[i], stretch[j]
            if s['kind'] == 'n' and e[0] == 'n':
                p = e[1] + shift
                paired += 1
                if not note_fits(s, None if e[2] is None else e[2] * red, perf):
                    if s['lig']: return None
                    r = render(e, s['p'])
                    if r is None: return None
                    out_at[s['at'][0]] = r
                    for k in s['at'][1:]: out_at[k] = []
                    fixed += 1; offbeat += 1
                elif p != s['p']:
                    t = tokens[s['at'][0]]
                    out_at[s['at'][0]] = [re.sub(r'(-?\d+)', str(p), t, count=1)]
                    if s['dot']:
                        for k in s['at'][1:]: out_at[k] = [f'.{p if p % 2 else p + 1}']
                    fixed += 1
            elif s['kind'] == 'r' and e[0] == 'r':
                paired += 1
                if e[1] * red not in rest_options(s['ds']):
                    offbeat += 1
                    r = render(e, s['p'])
                    if r is None: return None
                    out_at[s['at'][0]] = r
                    for k in s['at'][1:]: out_at[k] = []
                    fixed += 1
            else:
                if s['lig']: return None
                r = render(e, s['p'])
                if r is None: return None
                out_at[s['at'][0]] = r
                for k in s['at'][1:]: out_at[k] = []
                fixed += 1
            last_tok = s['at'][-1] + 1
        elif op == 'd':
            s = evs[i]
            if s['lig']: return None
            for k in s['at']: out_at[k] = []
            fixed += 1
            last_tok = s['at'][-1] + 1
        else:
            e = stretch[j]
            nxt = next((evs[ii]['at'][0] for o2, ii, _ in ops if o2 != 'i' and evs[ii]['at'][0] >= last_tok), len(tokens))
            # (put in where the next event of the staff begins; not inside a ligature)
            inside = sum(1 for t in tokens[:nxt] if t == '[') > sum(1 for t in tokens[:nxt] if t in (']', ']*'))
            if inside: return None
            r = render(e, evs[min(i + 1, len(evs) - 1)]['p'] if evs else 4)
            if r is None: return None
            before[nxt] += r
            fixed += 1
    # the clef: the one that, with the shift found, says the edition's pitches (the reader's if it does)
    clef = next(t for t in tokens if re.fullmatch(r'[cfg][1-5]', t))
    out = []
    for k, t in enumerate(tokens + ['']):
        out += before.get(k, [])
        if k == len(tokens): break
        if k in out_at: out += out_at[k]
        else: out.append(t)
    # the custos: the next note's place
    after = next((e for e in eevs[j0 + b:] if e[0] == 'n'), None)
    if after is not None:
        for k, t in enumerate(out):
            if re.fullmatch(r'\+-?\d+', t):
                q = f'+{after[1] + shift}'
                if t != q: out[k] = q; fixed += 1
    return out, fixed, perf, j0 + b, offbeat / max(1, paired)


# ---- pages

def gutter(gray):
    """Where a scan of two facing pages divides: the column, in its middle fifth, that varies least down its length
    (the fold's shadow, or the gap between two pages scanned side by side: no staff crosses it)."""
    import numpy as np
    W = gray.shape[1]
    a, b = int(0.4 * W), int(0.6 * W)
    sd = gray[:, a:b].std(0)
    sd = np.convolve(sd, np.ones(9) / 9, 'same')
    return a + int(np.argmin(sd[4:-4])) + 4


def sideways(im):
    """Is a page's image turned on its side (its staves' lines running down it, not across)?"""
    import numpy as np
    import printstaves as P
    small = im.copy(); small.thumbnail((1600, 1600))
    g = np.asarray(small).astype(np.float32)
    dark = g < (P.otsu(g) + float(np.percentile(g, 90))) / 2   # (faint lines too, halfway to the paper)
    def lines(d):                                            # (long thin runs across: lines, not a dark border or gap)
        thin = d & ~(np.roll(d, 3, 0) & np.roll(d, -3, 0))
        return P.runs(thin).sum()
    return lines(dark.T) > 2 * lines(dark)


def turn_by_reader(ims, model):
    """Which way to turn sideways pages up (90: anticlockwise, -90: clockwise): the one under which the reader reads
    their staves more surely (the music read upside down is read unsurely)."""
    import numpy as np, torch, recognizer
    import fivestaves as F, printstaves as P
    mdl, s = recognizer.restore(model)
    score = {}
    for turn in (90, -90):
        sure = []
        for im in ims:
            r = im.rotate(turn, expand=True); r.thumbnail((2400, 1800))     # (the size the staff finder knows)
            g = np.asarray(r).astype(np.float32)
            for lines, gg in P.find(g)[:4]:
                a = F.straighten5(g, lines).astype(np.uint8)
                x, n = recognizer.collate([recognizer.ink(a)])
                with torch.no_grad(): pr = torch.softmax(mdl(x), 1)[0, :, :int(n[0])]
                best = pr.max(0).values; arg = pr.argmax(0)
                if (arg != 0).any(): sure.append(float(best[arg != 0].mean()))
        score[turn] = float(np.mean(sure)) if sure else 0.0
    return max(score, key=score.get), score


def pages(o):
    """The PDFs downloaded from IMSLP (their names begin IMSLP or hold PMLP), each a folder of page images: a page's
    image as the PDF holds it (or drawn at 300 dpi, if it holds it otherwise), gray; turned up if it lies on its side
    (the way the reader reads it better, with --model; else anticlockwise); a scan of two facing pages (wider than
    tall) cut in two at its fold; its longer side at most --size."""
    import numpy as np
    from PIL import Image
    try: import pymupdf as fitz
    except ImportError: import fitz
    pdfs = sorted(p for p in glob.glob(os.path.join(o.downloads, '*.pdf')) if re.search(r'IMSLP|PMLP', os.path.basename(p), re.I))
    if not pdfs: raise SystemExit(f'no IMSLP PDFs in {o.downloads}')
    def image(doc, page):
        ims = page.get_images(full=True)
        if len(ims) == 1:
            try: return Image.open(io.BytesIO(doc.extract_image(ims[0][0])['image'])).convert('L')
            except Exception: pass
        pix = page.get_pixmap(dpi=300)
        return Image.frombytes('RGB' if pix.n >= 3 else 'L', (pix.width, pix.height), pix.samples).convert('L')
    for p in pdfs:
        name = re.sub(r'\W+', '_', re.sub(r'^IMSLP\d+-PMLP\d+-', '', os.path.splitext(os.path.basename(p))[0])).strip('_')[:60]
        out = os.path.join(o.out, name)
        if os.path.isdir(out) and os.listdir(out) and not o.again: print(f'{name}: done before'); continue
        if os.path.isdir(out):
            for f in glob.glob(os.path.join(out, '*.png')): os.remove(f)
        os.makedirs(out, exist_ok=True)
        doc = fitz.open(p)
        # (which way a sideways book is turned up: decided once for the PDF, from a few of its pages)
        turn = None
        sample = [image(doc, doc[k]) for k in range(len(doc))[len(doc) // 4: len(doc) // 4 + 12: 3]]
        side = [im for im in sample if sideways(im)]
        if len(side) * 2 >= len(sample) and side:
            if o.model:
                turn, score = turn_by_reader(side, o.model)
                print(f'{name}: on its side; turned {"anticlockwise" if turn == 90 else "clockwise"} (the reader\'s sureness {score})')
            else: turn = 90
        n = 0
        for k, page in enumerate(doc):
            im = image(doc, page)
            if turn is not None and sideways(im): im = im.rotate(turn, expand=True)
            halves = [im]
            if im.width > 1.15 * im.height:                    # (two facing pages)
                c = gutter(np.asarray(im).astype(np.float32))
                halves = [im.crop((0, 0, c, im.height)), im.crop((c, 0, im.width, im.height))]
            for h in halves:
                f = min(o.size / max(h.size), o.width / h.width)  # (no wider than the staff finder knows: ~1200)
                if f < 1: h = h.resize((int(h.width * f), int(h.height * f)), Image.LANCZOS)
                n += 1
                h.save(os.path.join(out, f'p{n:04d}.png'))
        print(f'{name}: {len(doc)} pages in the PDF -> {n} page images in {out}', flush=True)


def show(o):
    """A few pages of each folder (--per pages, evenly through it), the staves found drawn on them and each staff's
    reading written beside: <out>/<folder>-<page>.jpg (half size) and <out>/readings.txt, to see how the reader and
    the staff finder take a book."""
    import numpy as np, torch, recognizer
    from PIL import Image, ImageDraw
    import fivestaves as F, printstaves as P
    mdl, s = recognizer.restore(o.model)
    os.makedirs(o.out, exist_ok=True)
    dirs = [os.path.join(o.scans, x) for x in sorted(os.listdir(o.scans)) if os.path.isdir(os.path.join(o.scans, x))] or [o.scans]
    with open(os.path.join(o.out, 'readings.txt'), 'w', encoding='utf-8') as fh:
        for d in dirs:
            pages = sorted(f for f in os.listdir(d) if re.search(r'\.(jpe?g|png|tiff?)$', f, re.I))
            for pg in pages[len(pages) // (2 * o.per)::max(1, len(pages) // o.per)][:o.per]:
                im = Image.open(os.path.join(d, pg)).convert('L')
                gray = np.asarray(im).astype(np.float32)
                if np.median(gray) < 100: gray = 255 - gray
                st = P.find(gray) if o.print else F.page(os.path.join(d, pg))[1]
                rgb = im.convert('RGB'); dr = ImageDraw.Draw(rgb)
                name = f'{os.path.basename(d)}-{os.path.splitext(pg)[0]}'
                fh.write(f'== {name}: {im.size[0]}x{im.size[1]}, {len(st)} staves\n')
                for k, (lines, g) in enumerate(st):
                    for l in lines: dr.line(list(zip(l[0::2], l[1::2])), fill=(0, 120, 255), width=2)
                    dr.text((max(0, lines[0][0] - 30), lines[0][1]), str(k + 1), fill=(220, 0, 0))
                    a = F.straighten5(gray, lines).astype(np.uint8)
                    x, n = recognizer.collate([recognizer.ink(a)])
                    with torch.no_grad(): read = recognizer.greedy(mdl(x), n, s['vocab'])[0][0]
                    fh.write(f'{k + 1} (space {g:.1f}px): {" ".join(read)}\n')
                    if k < 3: Image.fromarray(a).save(os.path.join(o.out, f'{name}-staff{k + 1}.png'))
                rgb.resize((rgb.width // 2, rgb.height // 2)).save(os.path.join(o.out, name + '.jpg'), quality=80)
    print(f'{len(dirs)} folders shown -> {o.out}')


def pair(o):
    import numpy as np, torch, recognizer, selftrain
    from PIL import Image
    import fivestaves as F
    eds = load(sorted({p for g in o.editions for p in glob.glob(g)}))
    if not eds: raise SystemExit('no editions read')
    index = Index(eds)
    print(f'{len(eds)} editions, {len(index.voices)} voices, {sum(len(v[3]) for v in index.voices)} notes')
    mdl, s = recognizer.restore(o.model)
    if o.print:
        import printstaves as P
        def staves_on(path):
            gray = np.asarray(Image.open(path).convert('L')).astype(np.float32)
            if np.median(gray) < 100: gray = 255 - gray
            return gray, P.find(gray)
    else:
        F.N, F.DARK, F.NEAR, F.EVEN = 5, True, 0.3, 0.4
        staves_on = F.page
    os.makedirs(o.out, exist_ok=True)
    dirs = []
    for d in o.scans.split(','):                              # (a folder of folders: each of them, a book or partbook)
        subs = sorted(os.path.join(d, x) for x in os.listdir(d) if os.path.isdir(os.path.join(d, x)))
        dirs += subs if subs and not any(re.search(r'\.(jpe?g|png|tiff?)$', f, re.I) for f in os.listdir(d)) else [d]
    if o.only: dirs = [d for d in dirs if re.search(o.only, os.path.basename(d), re.I)]
    if o.skip: dirs = [d for d in dirs if not re.search(o.skip, os.path.basename(d), re.I)]
    if not dirs:                                              # (nothing to pair: said, and no labels, not a failure)
        print('no folders of pages to pair'); os.makedirs(o.out, exist_ok=True)
        open(os.path.join(o.out, 'labels.jsonl'), 'w').close(); return
    pages = [(d, f) for d in dirs for f in sorted(os.listdir(d)) if re.search(r'\.(jpe?g|png|tiff?)$', f, re.I)]
    found = []                                               # (file, tokens, match)
    prev = None                                              # (where the last staff found ended)
    for d, pg in pages:
        name = re.sub(r'\W', '', (os.path.basename(os.path.normpath(d)) + '_' if len(dirs) > 1 else '') + os.path.splitext(pg)[0])
        t0 = time.time()
        print(f'{os.path.basename(d)}/{pg} …', flush=True)   # (before: if a page hangs, the log says which)
        try: gray, st = staves_on(os.path.join(d, pg))
        except Exception as e: print(f'{pg}: {e}'); continue
        n = 0
        for k, (lines, g) in enumerate(st):
            a = F.straighten5(gray, lines).astype(np.uint8)
            x, ln = recognizer.collate([recognizer.ink(a)])
            with torch.no_grad(): read = recognizer.greedy(mdl(x), ln, s['vocab'])[0][0]
            mt = match(index, read, o.worth * 2, prev)
            if not mt: continue
            prev = (mt[1], mt[3], mt[4])
            file = f'{name}-{k + 1}.png'
            Image.fromarray(a).save(os.path.join(o.out, file))
            found.append((file, read, mt)); n += 1
        print(f'{pg}: {len(st)} staves, {n} found in the editions ({len(found)} so far; {time.time() - t0:.0f} s)', flush=True)
    kept = settle(index, found, o.worth, selftrain.keeps_rules, o.out, min_staves=o.min_staves, at_pitch=o.at_pitch)
    print(f'{kept} staves labelled, of {len(found)} found in the editions, on {len(pages)} pages -> {o.out}')


def settle(index, found, worth, rules, out_dir=None, quiet=False, min_staves=3, at_pitch=False):
    """Each edition's transposition and reduction (those most of its staves agree on), then each staff's label; the
    labels written (out_dir) or returned."""
    by_ed = defaultdict(list)
    for f, read, m in found: by_ed[index.voices[m[1]][0]].append((f, read, m))
    labels, kept = [], 0
    for ed, items in sorted(by_ed.items()):
        if len(items) < min_staves:                          # (an edition only a staff or two seemed to be of: chance)
            if not quiet: print(f'{ed}: {len(items)} staves: too few to trust, left out')
            continue
        # the reduction: the one under which most paired notes' lengths fit the signs read
        fits = Counter()
        for f, read, m in items:
            stretch = index.voices[m[1]][2][m[2]:m[3]]
            for op, i, j in m[5]:
                if op == 'm' and m[6][i]['kind'] == 'n' and stretch[j][0] == 'n' and stretch[j][2] is not None:
                    for r in REDUCTIONS:
                        if note_fits(m[6][i], stretch[j][2] * r): fits[r] += 1
        red = Fr(1) if at_pitch else (fits.most_common(1)[0][0] if fits else Fr(1))
        # the transposition: steps from the edition's pitch to the source's (each staff's shift less its clef's base)
        trans = Counter(m[4] - clef_base(events_of(read)[1]) for f, read, m in items)
        t = 0 if at_pitch else trans.most_common(1)[0][0]
        if not quiet:
            print(f'{ed}: {len(items)} staves; the source\'s values {"the edition's" if red == 1 else f"the edition\'s times {red}"}; '
                  f'{"at the edition\'s pitch" if t == 0 else f"{abs(t)} steps {"above" if t > 0 else "below"} the edition"}')
        mine = []                                            # (this edition's labels: kept if enough of its staves keep its time)
        tried = in_time = 0
        last, perfs = {}, {}                                            # (a voice: where in it its last staff labelled ended)
        for f, read, m in items:
            # (a staff that begins just after the last one of its voice ended begins there: a note the reader missed at
            # its start put in)
            prev = last.get(m[1])
            got = label(read, index, m, red, prev if prev is not None and prev <= m[2] <= prev + 6 else None, perfs.get(m[1], ()))
            if not got: continue
            toks, fixed, perf, end, offbeat = got
            tried += 1
            in_time += offbeat <= IN_TIME
            if offbeat > OFFBEAT: continue                     # (its rhythm isn't the edition's: not this music, or misread)
            last[m[1]] = end; perfs[m[1]] = perf
            base = m[4] - t                                    # (the clef that says these pitches)
            want = next((c for c in CLEFS if clef_base(c) == base), None)
            if want is None: continue
            k = next(k for k, x in enumerate(toks) if re.fullmatch(r'[cfg][1-5]', x))
            if toks[k] != want: toks[k] = want; fixed += 1
            if fixed > worth * len(toks) or not rules(toks): continue
            ed_, vn, _, _ = index.voices[m[1]]
            text = re.sub(r' ?~ ?', '~', ' '.join(toks)).replace('[ ', '[').replace(' ]', ']')
            mine.append({'file': f, 'text': text, 'tokens': toks, 'fixed': fixed, 'fit': round(m[0], 3), 'from': f'{ed_} {vn}'})
        # (an edition few of whose staves keep its time (the reader misreads values, so not all of the right music's
        # do; none of the wrong music's): not the music on these pages)
        if in_time < min_staves or in_time < IN_TIME_SHARE * tried:
            if not quiet: print(f'{ed}: only {in_time} of {tried} staves in time with it: left out')
            continue
        labels += mine; kept += len(mine)
    if out_dir:
        # (and a copy named for the folder, to keep beside another's)
        for fn in ('labels.jsonl', os.path.basename(os.path.normpath(out_dir)) + '.labels.jsonl'):
            with open(os.path.join(out_dir, fn), 'w', encoding='utf-8') as fh:
                for r in labels: fh.write(json.dumps(r) + '\n')
        keep = {r['file'] for r in labels}
        for f, _, _ in found:
            if f not in keep:
                try: os.remove(os.path.join(out_dir, f))
                except OSError: pass
        return kept
    return labels


# ---- the self-test: no pages, no reader

def to_musicxml(voices, step_shift, red):
    """Voices ([(name, events)]) as MusicXML, transposed by step_shift steps and the lengths divided by red."""
    div = 48
    parts, heads = [], []
    for k, (name, evs) in enumerate(voices):
        pid = f'P{k + 1}'
        heads.append(f'<score-part id="{pid}"><part-name>{name}</part-name></score-part>')
        notes = []
        for e in evs:
            d = (e[2] if e[0] == 'n' else e[1])
            d = Fr(2) if d is None else d
            dur = d / red * 4 * div
            if dur.denominator != 1: return None
            if e[0] == 'r': notes.append(f'<note><rest/><duration>{dur.numerator}</duration><voice>1</voice></note>')
            else:
                s = e[1] + step_shift
                held = '<notations><fermata/></notations>' if e[2] is None else ''
                notes.append(f'<note><pitch><step>{"CDEFGAB"[s % 7]}</step><octave>{s // 7}</octave></pitch>'
                             f'<duration>{dur.numerator}</duration><voice>1</voice>{held}</note>')
        parts.append(f'<part id="{pid}"><measure number="1"><attributes><divisions>{div}</divisions></attributes>{"".join(notes)}</measure></part>')
    return f'<?xml version="1.0"?><score-partwise><part-list>{"".join(heads)}</part-list>{"".join(parts)}</score-partwise>'


def misread(tokens, rng, rate):
    """A reading as a reader might make it: now and then a note a step off, a value mistaken, a note missed, a sign
    seen that isn't there."""
    out = []
    for t in tokens:
        m = re.fullmatch(VAL + r'(-?\d+)([v^]?\*?)', t)
        r = rng.random()
        if m and r < rate:
            out.append(f'{m.group(1)}{int(m.group(2)) + rng.choice((-1, 1))}{m.group(3)}')
        elif m and r < 2 * rate:
            out.append(f'{rng.choice([v for v in ("B", "Sb", "M") if v != m.group(1)])}{m.group(2)}{m.group(3)}')
        elif m and r < 2.5 * rate and '*' not in t:
            continue
        else: out.append(t)
        if m and rng.random() < 0.3 * rate: out.append(f'M{rng.randint(0, 8)}')
    return out


def selftest(o):
    import jrp, selftrain, mensuralsynth as M
    rng = random.Random(o.seed)
    paths = sorted({p for g in o.editions for p in glob.glob(g)})
    truth, found, n_staves = {}, [], 0
    eds = {}
    tmp = os.path.join(o.tmp, 'edition-selftest'); os.makedirs(tmp, exist_ok=True)
    for p in paths:
        sp, names = jrp.spines(p)
        if sp is None: continue
        name = os.path.splitext(os.path.basename(p))[0]
        for i, ev in sp.items():
            items, bad = jrp.voice_items(ev)
            for k, st in enumerate(jrp.staves(items, rng)):
                text = M.text(st)
                toks = re.findall(r'\]\*|\[|\]|~|[^\s\[\]~]+', text)
                truth[f'{name}-{i}-{k}'] = toks
        vs = kern_voices(p)
        x = to_musicxml(vs, o.shift, Fr(o.reduce))            # (by default down a fourth, the values halved: as a modern edition)
        if x is None: continue
        f = os.path.join(tmp, name + '.musicxml'); open(f, 'w').write(x)
        eds.update(load([f]))
    index = Index(eds)
    prev = None
    for f, toks in truth.items():
        read = misread(toks, rng, o.rate)
        m = match(index, read, o.worth * 2, prev)
        if m: found.append((f, read, m)); prev = (m[1], m[3], m[4])
    labels = settle(index, found, o.worth, selftrain.keeps_rules)
    import recognizer
    sg = lambda ts: [t for t in ts if t not in ('[', ']', ']*', '~')]
    right = sum(sg(r['tokens']) == sg(truth[r['file']]) for r in labels)
    err = sum(recognizer.edits(r['tokens'], truth[r['file']]) for r in labels)
    tot = sum(len(truth[r['file']]) for r in labels)
    rd = sum(recognizer.edits(read, truth[f]) for f, read, m in found if f in {r['file'] for r in labels})
    print(f'{len(truth)} staves; {len(found)} found in the edition; {len(labels)} labelled; {right} of them exactly right; '
          f'signs wrong: {100 * rd / max(1, tot):.1f}% as read, {100 * err / max(1, tot):.1f}% as labelled')
    for r in [r for r in labels if sg(r['tokens']) != sg(truth[r['file']])][:o.show]:
        print('read: ', ' '.join(next(x for f, x, _ in found if f == r['file'])))
        print('label:', ' '.join(r['tokens'])); print('true: ', ' '.join(truth[r['file']])); print()


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('what', choices=['pages', 'show', 'pair', 'selftest'])
    a.add_argument('--at-pitch', action='store_true', help='pair: the editions keep the sources\' pitch and values (as JRP\'s): neither is looked for')
    a.add_argument('--width', type=int, default=1200, help='pages: a page\'s width, in pixels, at most (printstaves.py finds staves at about this)')
    a.add_argument('--again', action='store_true', help='pages: made again, though made before')
    a.add_argument('--per', type=int, default=3, help='show: pages of each folder')
    a.add_argument('--only', help='pair: only the folders of pages whose names match this')
    a.add_argument('--skip', help='pair: not the folders of pages whose names match this')
    a.add_argument('--min-staves', type=int, default=3, help='pair: an edition fewer staves were found of is left out')
    a.add_argument('--downloads', help='pages: the folder the PDFs were downloaded to (only read)')
    a.add_argument('--size', type=int, default=2400, help='pages: a page\'s longer side, in pixels, at most')
    a.add_argument('--editions', nargs='+', help='the editions\' files (globs): .krn, .musicxml, .xml, .mxl')
    a.add_argument('--scans', help='pair: the pages, a folder or several, comma between')
    a.add_argument('--model', help='pair: the mensural reader\'s checkpoint')
    a.add_argument('--print', action='store_true', help='pair: a printed book (its staves found as printstaves.py finds them)')
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'edition'))
    a.add_argument('--worth', type=float, default=0.3, help='a staff kept if the edition changed fewer than this share of its signs')
    a.add_argument('--seed', type=int, default=1)
    a.add_argument('--rate', type=float, default=0.06, help='selftest: how often the made-up reader errs (each kind)')
    a.add_argument('--show', type=int, default=3, help='selftest: labels shown that came out wrong')
    a.add_argument('--shift', type=int, default=-3, help='selftest: the edition written this many steps from the source')
    a.add_argument('--reduce', type=int, default=2, help='selftest: the edition\'s values the source\'s divided by this')
    a.add_argument('--tmp', default=os.environ.get('TMPDIR', '/tmp'))
    o = a.parse_args()
    {'pages': pages, 'show': show, 'pair': pair, 'selftest': selftest}[o.what](o)
