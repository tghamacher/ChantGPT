"""The recognizer: reads a straightened staff (staffdata.py) as a sequence of tokens: clefs, notes (their staff
position and shape), bars, custos, the breaks between glyphs and between neumes. A small convolutional network over
the staff's columns, trained with CTC (so it learns from whole staves and their tokens, without being told where each
note is); exported to ONNX for the app, which runs it in the browser.

    python -I training/recognizer.py train [--data training/data/staves] [--epochs 20] [--out training/data/model]
    python -I training/recognizer.py test --model training/data/model/best.pt [--data ...]
    python -I training/recognizer.py export --model training/data/model/best.pt [--onnx models/chant.onnx]

Needs torch, numpy, pillow (and onnx to export). On a GPU it uses it (CUDA, or ROCm for an AMD card).
"""
import argparse, json, math, os, random, sys, time
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
HEIGHT = 64                       # as staffdata.py cuts them
STRIDE = 2                        # columns to a step of the output


class Reader(nn.Module):
    """64 rows in; the rows folded away by convolutions and pooling, the columns halved; then 1-D convolutions along
    the staff, wide enough to see a whole neume; a score for each token (and the blank) at each step."""
    def __init__(self, tokens, width=128):
        super().__init__()
        def block(i, o, pool):
            return [nn.Conv2d(i, o, 3, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True)] + ([nn.MaxPool2d(pool)] if pool else [])
        self.see = nn.Sequential(*block(1, 24, (2, 2)), *block(24, 48, (2, 1)), *block(48, 64, None), *block(64, 64, (2, 1)),
                                 *block(64, 96, None), *block(96, 96, (2, 1)), *block(96, width, (2, 1)))   # 64 -> 2 rows
        self.fold = nn.Sequential(nn.Conv2d(width, width, (2, 1), bias=False), nn.BatchNorm2d(width), nn.ReLU(inplace=True))
        along = []
        for d in (1, 2, 4, 8, 1):
            along += [nn.Conv1d(width, width, 5, padding=2 * d, dilation=d, bias=False), nn.BatchNorm1d(width), nn.ReLU(inplace=True)]
        self.along = nn.Sequential(*along)
        self.out = nn.Conv1d(width, tokens + 1, 1)

    def forward(self, x):                 # x: (batch, 1, 64, W), ink 1, paper 0
        y = self.fold(self.see(x)).squeeze(2)
        return self.out(self.along(y))    # (batch, tokens + 1, W / 2)


def load(data, labels='labels.jsonl'):
    """A folder's staves: labels.jsonl with tokens (staffdata.py), or with GABC items (align.js), tokenized here."""
    sys.path.insert(0, HERE)
    import staffdata
    rows = []
    for l in open(os.path.join(data, labels), encoding='utf-8'):
        r = json.loads(l)
        if 'tokens' not in r: r['tokens'] = staffdata.tokens(r['items'])
        if 'width' not in r:
            with Image.open(os.path.join(data, r['file'])) as im: r['width'] = im.width
        r['dir'] = data
        rows.append(r)
    return rows


def vocab_of(rows):
    return sorted({t for r in rows for t in r['tokens']})


def image(data, file):
    return np.asarray(Image.open(os.path.join(data, file)).convert('L'), dtype=np.uint8)


def ink(a):
    return 1.0 - a.astype(np.float32) / 255.0


def augment(a, rng):
    """A staff as it might otherwise have been: a little higher or lower (the lines found a pixel off), wider or
    narrower, lighter or darker, blurred, black and white."""
    h, w = a.shape
    f = ink(a)
    dy = rng.uniform(-1.5, 1.5)
    sx = rng.uniform(0.9, 1.1)
    nw = max(8, int(round(w * sx)))
    t = torch.from_numpy(f)[None, None]
    t = F.interpolate(t, size=(h, nw), mode='bilinear', align_corners=False)
    if abs(dy) > 0.1:
        theta = torch.tensor([[[1, 0, 0], [0, 1, 2 * dy / h]]], dtype=torch.float32)
        t = F.grid_sample(t, F.affine_grid(theta, t.shape, align_corners=False), align_corners=False, padding_mode='zeros')
    if rng.random() < 0.3:
        t = F.avg_pool2d(F.pad(t, (1, 1, 1, 1), mode='replicate'), 3, 1)
    if rng.random() < 0.25:                      # heavier or lighter ink
        t = F.max_pool2d(t, 3, 1, 1) * 0.5 + t * 0.5 if rng.random() < 0.5 else -F.max_pool2d(-t, 3, 1, 1) * 0.5 + t * 0.5
    t = t * rng.uniform(0.7, 1.15)
    if rng.random() < 0.3: t = (t > rng.uniform(0.3, 0.6)).float()
    t = t + torch.randn_like(t) * rng.uniform(0, 0.08)
    return t[0, 0].clamp(0, 1).numpy()


def batches(rows, size, rng, shuffle=True):
    """Staves of about the same width together (less padding)."""
    order = sorted(range(len(rows)), key=lambda i: rows[i]['width'] + (rng.random() * 40 if shuffle else 0))
    groups = [order[i:i + size] for i in range(0, len(order), size)]
    if shuffle: rng.shuffle(groups)
    return groups


def collate(arrays):
    W = max(a.shape[1] for a in arrays)
    W += (-W) % STRIDE
    x = np.zeros((len(arrays), 1, HEIGHT, W), np.float32)
    for k, a in enumerate(arrays): x[k, 0, :, :a.shape[1]] = a
    return torch.from_numpy(x), torch.tensor([a.shape[1] // STRIDE for a in arrays])


def greedy(logits, lengths, vocab):
    """The tokens read: the best at each step, repeats merged, blanks dropped; with the step each token begins at."""
    best = logits.argmax(1).cpu().numpy()
    out = []
    for k, n in enumerate(lengths.tolist()):
        seq, at, prev = [], [], 0
        for i, c in enumerate(best[k, :n]):
            if c != prev and c != 0: seq.append(vocab[c - 1]); at.append(i)
            prev = c
        out.append((seq, at))
    return out


def edits(a, b):
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return d[len(b)]


def evaluate(model, rows, data, vocab, device, size=16, limit=None):
    model.eval()
    rows = rows[:limit] if limit else rows
    errs = toks = 0
    notes_err = notes = 0
    with torch.no_grad():
        for group in batches(rows, size, random.Random(0), shuffle=False):
            x, lens = collate([ink(image(rows[i]['dir'], rows[i]['file'])) for i in group])
            for (seq, _), i in zip(greedy(model(x.to(device)), lens, vocab), group):
                want = rows[i]['tokens']
                errs += edits(seq, want); toks += len(want)
                sn, wn = [t for t in seq if t not in '|/'], [t for t in want if t not in '|/']
                notes_err += edits(sn, wn); notes += len(wn)
    model.train()
    return errs / max(1, toks), notes_err / max(1, notes)


def split(rows, every):
    """Every so many pages kept out of training, to test on."""
    pages = sorted({r['file'].rsplit('-', 1)[0] for r in rows})
    held = set(pages[::every])
    return [r for r in rows if r['file'].rsplit('-', 1)[0] not in held], [r for r in rows if r['file'].rsplit('-', 1)[0] in held]


def train(o):
    rows, test = split(load(o.data), 33) if o.data else ([], [])
    real, real_test = split(load(o.real, o.real_labels), 10) if o.real else ([], [])
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    old = torch.load(o.resume, map_location=device) if o.resume else None
    vocab = old['vocab'] if old else vocab_of(rows + real)
    index = {t: k + 1 for k, t in enumerate(vocab)}
    known = lambda r: all(t in index for t in r['tokens'])
    unknown = sum(not known(r) for r in rows + real)
    rows, test, real, real_test = ([r for r in x if known(r)] for x in (rows, test, real, real_test))
    rows = rows + real * o.real_weight                       # the real staves count for more: they are few
    rng = random.Random(1)
    model = Reader(len(vocab), o.width).to(device)
    if old: model.load_state_dict(old['model'])
    opt = torch.optim.AdamW(model.parameters(), lr=o.lr, weight_decay=1e-4)
    steps = o.epochs * math.ceil(len(rows) / o.batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=o.lr, total_steps=steps, pct_start=0.1)
    ctc = nn.CTCLoss(blank=0, zero_infinity=True)
    os.makedirs(o.out, exist_ok=True)
    with open(os.path.join(o.out, 'vocab.json'), 'w', encoding='utf-8') as f: json.dump(vocab, f, ensure_ascii=False)
    print(f'{len(rows)} staves to learn from ({len(real)} real, each {o.real_weight} times), {len(test)} synthetic and '
          f'{len(real_test)} real to test on; {unknown} left out for tokens the model hasn\'t; {len(vocab)} tokens; '
          f'{sum(p.numel() for p in model.parameters()):,} weights; on {device}', flush=True)
    cache = {}
    best, step, t0 = 9, 0, time.time()
    for epoch in range(o.epochs):
        total = 0.0
        for n, group in enumerate(batches(rows, o.batch, rng)):
            arrays = []
            for i in group:
                key = (rows[i]['dir'], rows[i]['file'])
                if key not in cache: cache[key] = image(*key)
                arrays.append(augment(cache[key], rng))
            x, lens = collate(arrays)
            targets = [torch.tensor([index[t] for t in rows[i]['tokens']]) for i in group]
            logp = F.log_softmax(model(x.to(device)), 1).permute(2, 0, 1)          # (steps, batch, tokens)
            loss = ctc(logp, torch.cat(targets).to(device), lens.to(device), torch.tensor([len(t) for t in targets]).to(device))
            opt.zero_grad(); loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 5)
            opt.step(); sched.step(); step += 1
            total += loss.item()
            if n % 100 == 0:
                print(f'epoch {epoch + 1} batch {n}: loss {total / (n + 1):.3f} ({time.time() - t0:.0f} s)', flush=True)
        ter, ner = evaluate(model, test, None, vocab, device, limit=o.test_limit) if test else (None, None)
        rter, rner = evaluate(model, real_test, None, vocab, device, limit=o.test_limit) if real_test else (None, None)
        pct = lambda v: '-' if v is None else f'{v:.2%}'
        print(f'epoch {epoch + 1}: loss {total / (n + 1):.3f}; synthetic test staves: token errors {pct(ter)}, note errors {pct(ner)}; '
              f'real: token errors {pct(rter)}, note errors {pct(rner)} ({time.time() - t0:.0f} s)', flush=True)
        state = {'model': model.state_dict(), 'vocab': vocab, 'width': o.width, 'epoch': epoch + 1, 'ter': ter, 'ner': ner, 'real_ter': rter, 'real_ner': rner}
        score = rter if rter is not None else ter
        torch.save(state, os.path.join(o.out, 'last.pt'))
        if score < best:
            best = score
            torch.save(state, os.path.join(o.out, 'best.pt'))


def restore(path):
    s = torch.load(path, map_location='cpu')
    m = Reader(len(s['vocab']), s.get('width', 128))
    m.load_state_dict(s['model']); m.eval()
    return m, s


def test(o):
    m, s = restore(o.model)
    rows = load(o.data, o.real_labels)
    if o.held: rows = split(rows, o.held)[1]
    index = set(s['vocab'])
    rows = [r for r in rows if all(t in index for t in r['tokens'])]
    ter, ner = evaluate(m, rows, None, s['vocab'], 'cpu', limit=o.test_limit)
    print(f'{min(len(rows), o.test_limit or len(rows))} staves: token errors {ter:.2%}, note errors {ner:.2%}')


def clean(o):
    """The real staves whose answers the model can believe: those it reads with fewer than half their notes wrong.
    An answer it reads far off is mostly not this staff's (the alignment broke the chant in the wrong place, or GregoBase
    has another version). Writes labels-clean.jsonl beside labels.jsonl."""
    m, s = restore(o.model)
    rows = load(o.data)
    kept = dropped = 0
    with open(os.path.join(o.data, 'labels-clean.jsonl'), 'w', encoding='utf-8') as out:
        for r in rows:
            x, l = collate([ink(image(r['dir'], r['file']))])
            with torch.no_grad(): seq, _ = greedy(m(x), l, s['vocab'])[0]
            a, b = [t for t in seq if t not in '|/'], [t for t in r['tokens'] if t not in '|/']
            if edits(a, b) < 0.5 * max(1, len(b)):
                out.write(json.dumps({k: v for k, v in r.items() if k != 'dir'}, ensure_ascii=False) + '\n'); kept += 1
            else: dropped += 1
    print(f'{kept} staves kept, {dropped} dropped -> {os.path.join(o.data, "labels-clean.jsonl")}')


def export(o):
    m, s = restore(o.model)
    x = torch.zeros(1, 1, HEIGHT, 400)
    os.makedirs(os.path.dirname(os.path.abspath(o.onnx)), exist_ok=True)
    torch.onnx.export(m, x, o.onnx, input_names=['staff'], output_names=['scores'], opset_version=17,
                      dynamic_axes={'staff': {0: 'batch', 3: 'width'}, 'scores': {0: 'batch', 2: 'steps'}}, dynamo=False)
    meta = {'vocab': s['vocab'], 'height': HEIGHT, 'stride': STRIDE, 'space': 8, 'top': 20, 'left': 0.6, 'right': 0.4,
            'epoch': s.get('epoch'), 'token_errors': s.get('ter'), 'note_errors': s.get('ner'),
            'real_token_errors': s.get('real_ter'), 'real_note_errors': s.get('real_ner')}
    with open(os.path.splitext(o.onnx)[0] + '.json', 'w', encoding='utf-8') as f: json.dump(meta, f, ensure_ascii=False)
    print(f'-> {o.onnx} ({os.path.getsize(o.onnx) / 1e6:.1f} MB)')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('what', choices=['train', 'test', 'export', 'clean'])
    a.add_argument('--data', default=os.path.join(HERE, 'data', 'staves'))
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'model'))
    a.add_argument('--model')
    a.add_argument('--real', help='real staves too (align.js), every tenth page kept out to test on')
    a.add_argument('--real-weight', type=int, default=3)
    a.add_argument('--real-labels', default='labels.jsonl', help='the real staves\' labels (clean: those the model agrees with)')
    a.add_argument('--held', type=int, help='test: only the pages kept out (every so many)')
    a.add_argument('--resume')
    a.add_argument('--onnx', default=os.path.join(HERE, '..', 'models', 'chant.onnx'))
    a.add_argument('--epochs', type=int, default=20)
    a.add_argument('--batch', type=int, default=16)
    a.add_argument('--lr', type=float, default=2e-3)
    a.add_argument('--width', type=int, default=128)
    a.add_argument('--test-limit', type=int, default=400)
    o = a.parse_args()
    {'train': train, 'test': test, 'export': export, 'clean': clean}[o.what](o)
