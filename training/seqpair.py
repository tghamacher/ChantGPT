"""A book's staves paired with Cantus's lines in one sequence through the whole book, for a source whose Cantus
transcription marks its line breaks (7) but not its page turns (77): every line of a chant is then filed under the
folio it begins on, and pairing page by page (cantus.py labels) can't work. Here the staves, in the book's order
(folio, then staff), and the lines, in the same order, are paired as cantus.py pair() pairs a page's — in order, as well
as they fit, a staff or a line free to go unpaired — the fit from what a model reads on each staff (fit_clef), looked
for only near where the two sequences would meet if they ran evenly (--band, a share of the book).

    python -I training/seqpair.py --source 1000019 --staves training/data/ms-1000019 --model training/data/jNNNN/best.pt --lines 5

Writes <staves>/labels.jsonl ({file, items, page, chant, staff, line, fit}), as cantus.py labels writes it."""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cantus as C


def main(o):
    import recognizer, torch
    m, s = recognizer.restore(o.model)
    pages = C.lines(o.source)
    folios = sorted(pages, key=C.folio_key)
    lines = []                                             # (folio, j, line, custos)
    flat = [(f, j, l) for f in folios for j, l in enumerate(pages[f]['lines'])]
    for i, (f, j, l) in enumerate(flat):
        custos = C.first_step(flat[i + 1][2]) if i + 1 < len(flat) else None
        lines.append((f, j, l, custos))
    staves = [json.loads(l) for l in open(os.path.join(o.staves, 'staves.jsonl'))]
    staves = [r for r in staves if r.get('file')]
    staves.sort(key=lambda r: (C.folio_key(r['page']), r['k']))
    reads = []
    for r in staves:
        x, n = recognizer.collate([recognizer.ink(recognizer.image(o.staves, r['file']))])
        with torch.no_grad(): reads.append(recognizer.greedy(m(x), n, s['vocab'])[0][0])
    S, L = len(staves), len(lines)
    clefs = C.CLEFS5 if o.lines == 5 else C.CLEFS
    fits = {}
    cost = [[1.0] * L for _ in range(S)]
    for k in range(S):
        for j in range(L):
            if abs(k / S - j / L) > o.band: continue
            clef, items, d = C.fit_clef(reads[k], lines[j][2], lines[j][3], clefs, o.lines)
            if items: cost[k][j] = d; fits[(k, j)] = (clef, items, d)
    pairs = C.pair(cost, o.worth)
    run, last, n = 0, None, 0
    with open(os.path.join(o.staves, 'labels.jsonl'), 'w') as out:
        for k, j in pairs:
            clef, items, d = fits[(k, j)]
            if last is None or (k, j) != (last[0] + 1, last[1] + 1): run += 1
            last = (k, j)
            f, jj = lines[j][0], lines[j][1]
            out.write(json.dumps({'file': staves[k]['file'], 'items': items, 'page': folios.index(f), 'chant': f'seq-{run}',
                                  'staff': f'f{staves[k]["page"]}s{staves[k]["k"]}', 'line': f'{f}:{jj + 1}', 'fit': round(d, 3)}) + '\n'); n += 1
    print(f'{n} staves paired of {S}, with {L} lines -> {os.path.join(o.staves, "labels.jsonl")}')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--source', required=True)
    a.add_argument('--staves', required=True)
    a.add_argument('--model', required=True)
    a.add_argument('--lines', type=int, default=4)
    a.add_argument('--worth', type=float, default=0.6)
    a.add_argument('--band', type=float, default=0.15)
    main(a.parse_args())
