"""Text strips of close-set prose (catmus.py) spread out as the words under chant are: the gaps between words widened at
random, as a staff's notes space them out, so that the reader doesn't learn that a narrow gap is the end of a word.
Close-set words touch, so the gaps taken are the columns where the line's ink is thinnest, as many as the label has
spaces, each widened by 4 to 30 columns of the strip's paper. Some fall inside a word, as a syllable held out under a
long neume does.

    python -I training/spread.py --data training/data/text-catmus --labels text-ok.jsonl [--out training/data/text-catmus-sp]

Writes <out>/<file> and <out>/text.jsonl ({file, text})."""
import argparse, json, os, random
import numpy as np
from PIL import Image


def valleys(a, k, apart=6):
    """The k columns where the line's ink is thinnest (word gaps, near enough, in close-set writing), at least `apart`
    columns from each other and inside the ink: sorted."""
    paper = np.percentile(a, 90)
    ink = np.clip((paper - a) / 80.0, 0, 1)[10:54].sum(0)
    ink = np.convolve(ink, np.ones(3) / 3, 'same')
    cols = np.where(ink > 1.0)[0]
    if len(cols) < 2: return None
    lo, hi = cols[0] + 3, cols[-1] - 3
    order = [x for x in np.argsort(ink, kind='stable') if lo <= x <= hi]
    out = []
    for x in order:
        if all(abs(x - y) >= apart for y in out): out.append(int(x))
        if len(out) == k: break
    return sorted(out) if len(out) == k else None


def main(o):
    rng = random.Random(o.seed)
    out = o.out or o.data.rstrip('/') + '-sp'
    os.makedirs(out, exist_ok=True)
    n = 0
    with open(os.path.join(out, 'text.jsonl'), 'w', encoding='utf-8') as f:
        for l in open(os.path.join(o.data, o.labels), encoding='utf-8'):
            r = json.loads(l)
            a = np.asarray(Image.open(os.path.join(o.data, r['file'])).convert('L'), np.float32)
            k = r['text'].count(' ')
            words = valleys(a, k) if k else []
            if words is None: continue
            add = {x: rng.randint(4, 30) for x in words}
            paper = float(np.percentile(a, 90))
            parts, at = [], 0
            for x in sorted(add):
                parts.append(a[:, at:x]); parts.append(np.full((a.shape[0], add[x]), paper, np.float32)); at = x
            parts.append(a[:, at:])
            b = np.concatenate(parts, 1)
            Image.fromarray(b.clip(0, 255).astype(np.uint8)).save(os.path.join(out, r['file']), quality=88)
            f.write(json.dumps({'file': r['file'], 'text': r['text']}, ensure_ascii=False) + '\n'); n += 1
    print(n, 'strips spread ->', out)


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--data', required=True)
    a.add_argument('--labels', default='text-ok.jsonl')
    a.add_argument('--out')
    a.add_argument('--seed', type=int, default=1)
    main(a.parse_args())
