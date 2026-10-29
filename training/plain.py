"""A printed book's labels without the Solesmes rhythmic signs: the ictus (') and the horizontal episema (_), which
the editions of Solesmes add to the chant and no manuscript has (a mora's dot, a shape the page prints, is kept).
The recognizer is for reading the notes of any source: taught these, it would see them everywhere.

    python -I training/plain.py training/data/book-7 [labels.jsonl]     (writes labels-plain.jsonl beside)"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import staffdata


def plain(item):
    # (an ictus with its position digit, an episema with its digits: _, _0, '1 …)
    return re.sub(r"'\d?|_\d*", '', item)


if __name__ == '__main__':
    d = sys.argv[1]
    src = os.path.join(d, sys.argv[2] if len(sys.argv) > 2 else 'labels.jsonl')
    n = 0
    with open(os.path.join(d, 'labels-plain.jsonl'), 'w', encoding='utf-8') as out:
        for l in open(src, encoding='utf-8'):
            r = json.loads(l)
            r['items'] = [plain(it) for it in r['items']]
            r['tokens'] = staffdata.tokens(r['items'])
            out.write(json.dumps(r) + '\n'); n += 1
    print(f'{n} staves, rhythmic signs taken off -> {os.path.join(d, "labels-plain.jsonl")}')
