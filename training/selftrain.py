"""Self-training: a book's own pages read by the mensural reader, and the staves it reads surely kept as labels to learn
its hand from (a book with no transcription to pair with, or none that may be shared: the reader learns the look of the
hand from its own sure readings, the labels nobody's edition). The IDEM database's choirbooks first (the Occo Codex's
pages, saved on this computer: the Royal Library of Belgium's images, digitised by Alamire Digital Lab).

    python -I training/selftrain.py read --scans training/data/scans/occo --model training/data/m0086/best.pt \\
        [--out training/data/occoself] [--sure 0.9] [--exclude-held training/data/occo]

A staff is kept when every sign is read with at least --sure of the reader's belief, it has eight signs or more, begins
with a clef, and keeps the rules (a ligature as the rules write it, a rest on its line or space): the rest are left
(and so is any page --exclude-held's labels hold out for testing, so that the test there stays a fair one). Writes
<out>/<page>-<k>.png (straightened as fivestaves.py cuts five-line staves) and <out>/labels.jsonl ({file, text,
tokens, sure})."""
import argparse, glob, json, os, re, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

VAL = '(Mx|Sb|Sm|Sf|L|B|M|F)'


def keeps_rules(tokens):
    """Does the staff read keep the rules a scribe kept: begun with a clef, each ligature written as the rules write it
    (js/mensural.js ligRules), each rest on the line or space its value has it (restPlace)?"""
    if not tokens or not re.fullmatch(r'[cfg][1-5]', tokens[0]): return False
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t == '[':
            notes, obl = [], []
            j = i + 1
            while j < len(tokens) and tokens[j] not in (']', ']*'):
                if tokens[j] == '~': obl[-1] = True
                else:
                    m = re.fullmatch(VAL + r'(-?\d+)\*?', tokens[j])
                    if not m: return False
                    notes.append((m.group(1), int(m.group(2)))); obl.append(False)
                j += 1
            if j >= len(tokens) or len(notes) < 2: return False
            vals = [v for v, _ in notes]
            if any(v not in ('Mx', 'L', 'B', 'Sb') for v in vals): return False
            if 'Sb' in vals and not (vals[0] == vals[1] == 'Sb' and 'Sb' not in vals[2:]): return False
            if not (len(notes) == 2 and vals[0] == 'Sb'):
                desc = notes[-1][1] < notes[-2][1]
                if vals[-1] == 'B' and desc != obl[-2]: return False       # (a last breve oblique descending, square ascending)
                if vals[-1] == 'L' and desc and obl[-2]: return False      # (a last longa square descending)
            i = j + 1
            continue
        m = re.fullmatch(r'r' + VAL + r'(p?)(-?\d+)', t)
        if m:
            space = m.group(1) == 'B' or (m.group(1) == 'L' and m.group(2))
            if (int(m.group(3)) % 2 == 1) != bool(space): return False
        i += 1
    return True


def held_pages(folder):
    """The pages recognizer.py holds out of a folder of labelled staves (every tenth, by name), to test on."""
    p = os.path.join(folder, 'labels.jsonl')
    if not os.path.exists(p): return set()
    pages = sorted({json.loads(l)['file'].rsplit('-', 1)[0] for l in open(p, encoding='utf-8')})
    return set(pages[::10])


def read(o):
    import torch, recognizer
    from PIL import Image
    import fivestaves as F
    F.N, F.DARK, F.NEAR, F.EVEN = 5, True, 0.3, 0.4           # (ruled in ink, by hand: as cmme.py pair finds Occo's)
    m, s = recognizer.restore(o.model)
    vocab = s['vocab']
    held = held_pages(o.exclude_held) if o.exclude_held else set()
    # (how right the sure readings are: against another's labels of the same staves, if given; only measured, not kept)
    other = {}
    if o.check and os.path.exists(os.path.join(o.check, 'labels.jsonl')):
        for l in open(os.path.join(o.check, 'labels.jsonl'), encoding='utf-8'):
            r = json.loads(l); other[r['file']] = r['tokens']
    score = {'kept': [0, 0], 'left': [0, 0]}
    os.makedirs(o.out, exist_ok=True)
    pages = sorted(f for f in os.listdir(o.scans) if re.search(r'\.(jpe?g|png)$', f, re.I))
    seen = kept = 0
    why = {'unsure': 0, 'short': 0, 'rules': 0}
    with open(os.path.join(o.out, 'labels.jsonl'), 'w', encoding='utf-8') as fh:
        for pg in pages:
            name = re.sub(r'\W', '', os.path.splitext(pg)[0])
            if name in held: continue
            try: gray, st = F.page(os.path.join(o.scans, pg))
            except Exception as e: print(f'{pg}: {e}'); continue
            for k, (lines, g) in enumerate(st):
                a = F.straighten5(gray, lines).astype(np.uint8)
                x, n = recognizer.collate([recognizer.ink(a)])
                with torch.no_grad():
                    logits = m(x)
                prob = torch.softmax(logits, 1)[0].cpu().numpy()   # (tokens + blank, steps)
                seq, at = recognizer.greedy(logits, n, vocab)[0]
                seen += 1
                sure = min((float(prob[vocab.index(t) + 1, i]) for t, i in zip(seq, at)), default=0.0)
                file = f'{name}-{k + 1}.png'
                ok = sure >= o.sure and len(seq) >= 8 and keeps_rules(seq)
                if file in other:
                    sc = score['kept' if ok else 'left']; sc[0] += recognizer.edits(seq, other[file]); sc[1] += len(other[file])
                if sure < o.sure: why['unsure'] += 1; continue
                if len(seq) < 8: why['short'] += 1; continue
                if not keeps_rules(seq): why['rules'] += 1; continue
                Image.fromarray(a).save(os.path.join(o.out, file))
                text = re.sub(r' ?~ ?', '~', ' '.join(seq)).replace('[ ', '[').replace(' ]', ']')
                fh.write(json.dumps({'file': file, 'text': text, 'tokens': seq, 'sure': round(sure, 3)}) + '\n')
                kept += 1
            print(f'{pg}: {len(st)} staves ({kept} kept of {seen} so far)', flush=True)
    print(f'{kept} staves kept of {seen} read on {len(pages) - len(held)} pages ({len(held)} held out for testing); '
          f'left: {why["unsure"]} read unsurely, {why["short"]} short, {why["rules"]} breaking a rule -> {o.out}')
    if other:
        pct = lambda v: f'{100 * v[0] / v[1]:.1f}% of signs wrong over {v[1]}' if v[1] else 'none to compare'
        print(f'against {o.check}\'s labels (the same staves): those kept {pct(score["kept"])}; those left {pct(score["left"])}')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('what', choices=['read'])
    a.add_argument('--scans', required=True, help='the book\'s pages (cantus.py collect)')
    a.add_argument('--model', required=True, help='the mensural reader\'s checkpoint')
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'occoself'))
    a.add_argument('--sure', type=float, default=0.9, help='every sign read with at least this belief')
    a.add_argument('--check', help='a folder of labels of the same staves, to measure how right the sure readings are (not kept)')
    a.add_argument('--exclude-held', help='a folder of labelled staves of the same pages: the pages it holds out for testing left out here')
    read(a.parse_args())
