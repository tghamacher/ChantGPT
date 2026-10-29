"""The shapes of a manuscript's notes, in its labels: virgae, from the page, and the inclinata of a climacus. The Cantus Database's melodies (Volpiano) have pitches only: a single
note is a punctum in the GABC made from them (cantus.py labels), whether the scribe drew it with a stem or not, and a
model trained on them learns to read every virga as a punctum (the manuscript model read 5 virgae in 15,000 notes).
Here each single-note neume in the labels is lined up with what a model that never learnt from those labels reads
(one trained on printed and synthetic staves, where virgae are marked: --model), and made a virga where it reads one
there, at that pitch, or where a stem runs down from the note's head (a scribe's hairline the model can miss).
And a neume that falls from its first note through two or more (a climacus: hgf, gfed) has the falling notes
written as inclinata (hGF, gFED): the diamonds square notation draws them as, which Volpiano doesn't record either.

    python -I training/shapes.py --model M --data DIR --real-labels labels-fit.jsonl          (writes <stem>-shapes.jsonl)
    python -I training/shapes.py --model M --data training/data/real --real-labels L --check   (against marked virgae)

--check: on staves whose labels mark virgae (the Graduale's), the virgae taken off and found again, and counted."""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np, torch
import recognizer

NOTE = re.compile(r'[a-mA-M][vVoOwsr]?[~<>]?')


def notes_of(items):
    """The notes of a label's GABC items, in order: (item, neume, index in the neume's text, pitch, single), single
    for a neume of one plain note (no liquescence, no other shape)."""
    out = []
    for i, it in enumerate(items):
        if i == 0 or it.endswith('+'): continue        # (the clef; the custos)
        for k, neume in enumerate(it.split('/')):
            found = [(m.start(), m.group()) for m in re.finditer(r'[a-m](?![xy])[vVoOwsr~<>]*', neume)]
            for at, t in found:
                out.append((i, k, at, t[0], len(found) == 1 and t == t[0]))
    return out


TOP, SPACE = 20, 8                                    # (the straightened staff's top line, and its space, in pixels)


def stem(ink, x, p):
    """How far a stem runs down from the head of a note at column x (in the straightened staff's pixels), position p
    (a = 0): the longest run of ink (however pale: a scribe's stem is a hairline) straight down from the head, in a
    column the head reaches, thin (paper within two pixels of it on one side or the other), crossing the staff's lines
    but not running along one; in spaces. 0 for a note on or below the bottom line: below it are the words, whose
    letters' strokes would pass for stems."""
    if p <= 3: return 0
    H, W = ink.shape
    head = int(round(TOP + (9 - p) * SPACE / 2))
    y0 = int(round(head + SPACE * 0.55))
    best = 0
    for c in range(max(3, x - 6), min(W - 3, x + 8)):
        if ink[max(0, head - 2):head + 3, c].max() < 0.45: continue          # (the head reaches this column)
        run = 0
        for y in range(y0, min(H, y0 + 3 * SPACE)):
            line = min(abs(y - (TOP + k * SPACE)) for k in range(4)) <= 1
            thin = ink[y, c - 2] < 0.3 or ink[y, c + 2] < 0.3
            if ink[y, c] > 0.3 and (line or thin): run += 1
            else: break
        best = max(best, run)
    return best / SPACE


def found(model, s, data, r, cut=0.9):
    """The single-note neumes of a staff's label read as virgae: their (item, neume, at) places; and those of all its
    single-note neumes that were lined up with a note read."""
    a = recognizer.ink(recognizer.image(data, r['file']))
    x, n = recognizer.collate([a])
    with torch.no_grad(): seq, at = recognizer.greedy(model(x), n, s['vocab'])[0]
    # (each note read: its pitch, and whether it is a virga: read as one, or with a stem down from its head)
    read = [(t[0].lower(), t[1:2] == 'v' or stem(a, k * recognizer.STRIDE + recognizer.STRIDE // 2, 'abcdefghijklm'.index(t[0].lower())) >= cut)
            for t, k in zip(seq, at) if NOTE.fullmatch(t)]
    want = notes_of(r['items'])
    # the label's notes lined up with those read, by pitch (an edit distance's path)
    A, B = [w[3] for w in want], [p for p, _ in read]
    D = np.zeros((len(A) + 1, len(B) + 1), int); D[:, 0] = range(len(A) + 1); D[0, :] = range(len(B) + 1)
    for i in range(1, len(A) + 1):
        for j in range(1, len(B) + 1):
            D[i, j] = min(D[i - 1, j] + 1, D[i, j - 1] + 1, D[i - 1, j - 1] + (A[i - 1] != B[j - 1]))
    i, j, pairs = len(A), len(B), {}
    while i and j:
        if D[i, j] == D[i - 1, j - 1] + (A[i - 1] != B[j - 1]):
            if A[i - 1] == B[j - 1]: pairs[i - 1] = read[j - 1][1]
            i, j = i - 1, j - 1
        elif D[i, j] == D[i - 1, j] + 1: i -= 1
        else: j -= 1
    out = set()
    for k, w in enumerate(want):
        if w[4] and k in pairs and pairs[k]: out.add(w[:3])
    return out, [w[:3] for k, w in enumerate(want) if w[4] and k in pairs]


def with_virgae(items, places):
    items = list(items)
    for i, k, at in sorted(places, key=lambda v: -v[2]):
        neumes = items[i].split('/')
        neumes[k] = neumes[k][:at + 1] + 'v' + neumes[k][at + 1:]
        items[i] = '/'.join(neumes)
    return items


def climacus(neume):
    """A neume of plain notes (its first maybe a virga) falling from the first through two or more: the falling ones
    as inclinata (gfed -> gFED, hvgf -> hvGF); any other neume as it is."""
    m = re.fullmatch(r'([a-m])(v?)([a-m]{2,})', neume)
    if not m: return neume
    steps = [m.group(1)] + list(m.group(3))
    if all(a > b for a, b in zip(steps, steps[1:])): return m.group(1) + m.group(2) + m.group(3).upper()
    return neume


def inclinata(items):
    return [it if i == 0 or it.endswith('+') else '/'.join(climacus(n) for n in it.split('/')) for i, it in enumerate(items)]


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--model', required=True)
    a.add_argument('--data', required=True)
    a.add_argument('--real-labels', default='labels.jsonl')
    a.add_argument('--check', action='store_true')
    a.add_argument('--limit', type=int, default=0)
    o = a.parse_args()
    m, s = recognizer.restore(o.model)
    rows = [json.loads(l) for l in open(os.path.join(o.data, o.real_labels), encoding='utf-8')]
    if o.limit: rows = rows[:o.limit]
    if o.check:
        tp = fp = fn = 0
        for r in rows:
            # the marked virgae, taken off: their places, and the items as Cantus would give them
            marked, plain = set(), []
            for i, it in enumerate(r['items']):
                if i == 0 or it.endswith('+'): plain.append(it); continue
                ns = []
                for k, neume in enumerate(it.split('/')):
                    if re.fullmatch(r'[a-m]v', neume): marked.add((i, k, 0)); neume = neume[0]
                    ns.append(neume)
                plain.append('/'.join(ns))
            got, seen = found(m, s, o.data, dict(r, items=plain))
            seen = set(seen)
            tp += len(got & marked); fp += len(got - marked); fn += len((marked & seen) - got)
        print(f'virgae marked and found {tp}, found but not marked {fp}, marked but missed {fn}: '
              f'precision {tp / max(1, tp + fp):.0%}, recall {tp / max(1, tp + fn):.0%}')
        return
    sys.path.insert(0, HERE)
    import staffdata
    out_path = os.path.join(o.data, re.sub(r'\.jsonl$', '', o.real_labels) + '-shapes.jsonl')
    n_single = n_virga = n_incl = 0
    # (a run stopped part way is carried on: the staves written are kept)
    done = {json.loads(l)['file'] for l in open(out_path, encoding='utf-8')} if os.path.exists(out_path) else set()
    with open(out_path, 'a', encoding='utf-8') as f:
        for r in rows:
            if r['file'] in done: continue
            got, seen = found(m, s, o.data, r)
            n_single += len(seen); n_virga += len(got)
            r = dict(r, items=inclinata(with_virgae(r['items'], got)))
            n_incl += sum(c.isupper() for it in r['items'][1:] if not it.endswith('+') for c in it)
            r['tokens'] = staffdata.tokens(r['items'])
            f.write(json.dumps(r) + '\n'); f.flush()
    print(f'{n_virga} of {n_single} single notes read as virgae, made so; {n_incl} notes of climaci made inclinata -> {out_path}')


if __name__ == '__main__':
    main()
