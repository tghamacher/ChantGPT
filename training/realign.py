"""The Nidaros lines' text put where the reader sees it. lines.py spreads each leaf's text over its lines by width, so a
line's label can start or end a word or two off, and a running head taken as a line gets text that isn't on it. Here
a reader trained on those rough labels reads every line of a leaf; the leaf's text (the edition's) is lined up with all
its reads at once, letter by letter, and each letter goes to the line it was read on (a word the print breaks across
two lines, split there). A line whose read is still far from its new text is left out.

    python -I training/realign.py --model training/data/j0032/best.pt --text breviarium.txt [--data training/data/nidaros]

Writes <data>/text-realigned.jsonl ({file, text, leaf}). What the reader makes of each strip is kept in
<data>/.read-<model>.jsonl, so a stop loses little and a second run is quick."""
import argparse, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import recognizer as R
import lines as L
import torch


def align(a, b):
    """For each letter of a, the index of the letter of b it is matched to (or -1): an edit distance, a row at a time
    (an insertion along the row, as a running minimum)."""
    n, m = len(a), len(b)
    A, B = np.array([ord(c) for c in a]), np.array([ord(c) for c in b])
    d = np.zeros((n + 1, m + 1), np.int32)
    d[0] = np.arange(m + 1)
    js = np.arange(m + 1)
    for i in range(1, n + 1):
        t = np.empty(m + 1, np.int32)
        t[0] = i
        t[1:] = np.minimum(d[i - 1, 1:] + 1, d[i - 1, :-1] + (B != A[i - 1]))
        d[i] = np.minimum.accumulate(t - js) + js
    out = [-1] * n
    i, j = n, m
    while i and j:
        if d[i, j] == d[i - 1, j - 1] + (a[i - 1] != b[j - 1]):
            if a[i - 1] == b[j - 1]: out[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif d[i, j] == d[i - 1, j] + 1: i -= 1
        else: j -= 1
    return out


def reads(o, rows):
    m, s = R.restore(o.model)
    tag = os.path.basename(os.path.dirname(os.path.abspath(o.model)))
    path = os.path.join(o.data, f'.read-{tag}.jsonl')
    got = {}
    if os.path.exists(path):
        for l in open(path, encoding='utf-8'):
            try: r = json.loads(l); got[r['file']] = r['read']
            except ValueError: pass                         # (a line cut short by a stop)
    todo = [r for r in rows if r['file'] not in got]
    todo.sort(key=lambda r: r['width'])
    torch.set_num_threads(os.cpu_count() or 4)
    with open(path, 'a', encoding='utf-8') as f:
        for k in range(0, len(todo), 32):
            group = todo[k:k + 32]
            x, n = R.collate([R.ink(R.image(o.data, r['file'])) for r in group])
            with torch.no_grad(): res = R.greedy(m(x), n, s['vocab'])
            for r, (seq, _) in zip(group, res):
                got[r['file']] = ''.join(seq)
                f.write(json.dumps({'file': r['file'], 'read': got[r['file']]}, ensure_ascii=False) + '\n')
            f.flush()
            if k % 3200 == 0: print(f'{k} of {len(todo)} read', flush=True)
    return got


def main(o):
    rows = R.load(o.data, 'text.jsonl')
    got = reads(o, rows)
    text = L.leaves(o.text)
    by = {}
    for r in rows: by.setdefault(r['leaf'], []).append(r)
    kept = dropped = lines = 0
    with open(os.path.join(o.data, 'text-realigned.jsonl'), 'w', encoding='utf-8') as f:
        for leaf in sorted(by):
            ls = sorted(by[leaf], key=lambda r: r['file'])
            want = text.get(leaf, '')
            if not want: continue
            seen, owner = '', []                            # the reads run together; each letter's line
            for k, r in enumerate(ls):
                t = got[r['file']].strip()
                if seen: seen += ' '; owner.append(-1)
                seen += t; owner += [k] * len(t)
            at = align(want, seen)
            line = [owner[j] if j >= 0 else -1 for j in at]
            # (a letter not matched: the line of the letter before it in its word, or else after; then never backwards)
            for i in range(len(want)):
                if line[i] < 0 and i and want[i] != ' ' and want[i - 1] != ' ': line[i] = line[i - 1]
            for i in range(len(want) - 2, -1, -1):
                if line[i] < 0 and want[i] != ' ' and want[i + 1] != ' ': line[i] = line[i + 1]
            last = 0
            for i in range(len(want)):
                if line[i] < 0: line[i] = last
                last = line[i] = max(last, line[i])
            per = [''] * len(ls)
            for c, k in zip(want, line): per[k] += c
            for k, r in enumerate(ls):
                lines += 1
                new = ' '.join(per[k].split())
                read = got[r['file']].strip()
                if not new or R.edits(list(read), list(new)) > o.worst * len(new): dropped += 1; continue
                f.write(json.dumps({'file': r['file'], 'text': new, 'leaf': leaf}, ensure_ascii=False) + '\n'); kept += 1
    print(f'{kept} of {lines} lines kept, {dropped} left out (read too far from their text, or none) -> text-realigned.jsonl')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--model', required=True, help='the text reader trained on the rough labels')
    a.add_argument('--text', required=True, help='the edition, as pdftotext -layout gives it')
    a.add_argument('--data', default=os.path.join(HERE, 'data', 'nidaros'))
    a.add_argument('--worst', type=float, default=0.3, help='the most of a line\'s letters its read may get wrong')
    main(a.parse_args())
