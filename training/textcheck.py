"""The note labels checked by the words: a staff aligned with GregoBase (align.js) is kept for the note model only
where the text reader reads, under it, the words GregoBase gives that staff. align.js's own check (each custos against
the next line's first note) misses a chant put on the wrong staves when their melodies happen to agree; the words
don't agree then.

    python -I training/textcheck.py --notes training/data/book-48 --text training/data/text-48 --model training/data/j0029/best.pt

Reads <notes>/labels-plain.jsonl and <text>/text.jsonl (the same page, staff and chant); writes
<notes>/labels-plain-text.jsonl: the note labels whose words are read with at most --worst of their letters wrong.
What the reader makes of each strip is kept in <text>/.read.jsonl, so a stop loses little and a second run is quick.
Staves without words under them (a strip with no text) aren't kept: nothing says they're right."""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import recognizer as R
import torch


def main(o):
    m, s = R.restore(o.model)
    texts = {}
    for l in open(os.path.join(o.text, 'text.jsonl'), encoding='utf-8'):
        r = json.loads(l)
        if r['text'].strip() and os.path.exists(os.path.join(o.text, r['file'])):
            texts[(int(r['page']), r['staff'], str(r['chant']))] = r
    cache_path = os.path.join(o.text, '.read.jsonl')
    read = {}
    if os.path.exists(cache_path):
        for l in open(cache_path, encoding='utf-8'):
            try: r = json.loads(l); read[r['file']] = r['read']
            except ValueError: pass                         # (a line cut short by a stop)
    with open(cache_path, 'a', encoding='utf-8') as cache:
        for k, r in enumerate(texts.values()):
            if r['file'] in read: continue
            x, n = R.collate([R.ink(R.image(o.text, r['file']))])
            with torch.no_grad(): seq, _ = R.greedy(m(x), n, s['vocab'])[0]
            read[r['file']] = ''.join(seq)
            cache.write(json.dumps({'file': r['file'], 'read': read[r['file']]}, ensure_ascii=False) + '\n'); cache.flush()
            if k % 500 == 0: print(f'{k} of {len(texts)} read', flush=True)
    kept = wrong = none = 0
    out = os.path.join(o.notes, 'labels-plain-text.jsonl')
    with open(out, 'w', encoding='utf-8') as f:
        for l in open(os.path.join(o.notes, o.labels), encoding='utf-8'):
            r = json.loads(l)
            t = texts.get((int(r['page']), r['staff'], str(r['chant'])))
            if not t: none += 1; continue
            want = t['text']
            if R.edits(list(read[t['file']]), list(want)) <= o.worst * len(want): f.write(l); kept += 1
            else: wrong += 1
    print(f'{kept} staves kept, {wrong} whose words aren\'t these, {none} without words to check -> {out}')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--notes', required=True, help='the book\'s staves (align.js), with labels-plain.jsonl')
    a.add_argument('--text', required=True, help='the words under them (align.js text.jsonl): the same folder, or a text-only run\'s')
    a.add_argument('--model', required=True, help='the text reader')
    a.add_argument('--labels', default='labels-plain.jsonl')
    a.add_argument('--worst', type=float, default=0.25, help='the most of a staff\'s letters that may be read wrong')
    main(a.parse_args())
