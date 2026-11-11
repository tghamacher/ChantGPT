"""The recognizer: reads a straightened staff (staffdata.py) as a sequence of tokens: clefs, notes (their staff
position and shape), bars, custos, the breaks between glyphs and between neumes. A small convolutional network over
the staff's columns, trained with CTC (so it learns from whole staves and their tokens, without being told where each
note is); exported to ONNX for the app, which runs it in the browser.

    python -I training/recognizer.py train [--data training/data/staves] [--epochs 20] [--out training/data/model]
    python -I training/recognizer.py test --model training/data/model/best.pt [--data ...]
    python -I training/recognizer.py export --model training/data/model/best.pt [--onnx models/chant.onnx]
    python -I training/recognizer.py train --data training/data/mens --out training/data/mens-model     (mensural notation:
        mensuralsynth.py's staves; the same reader, its tokens CGMensural's text form)
    python -I training/recognizer.py export --model training/data/mens-model/best.pt --mensural --onnx models/mensural.onnx

Needs torch, numpy, pillow (and onnx to export). On a GPU it uses it: CUDA, ROCm (an AMD card, on Linux) or, with
torch-directml installed, DirectML (any card, on Windows). --device chooses.
"""
import argparse, json, math, os, random, re, sys, time
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


def device_of(name):
    """auto: CUDA (or ROCm) if there is one, else DirectML if torch-directml is installed, else the CPU."""
    if name in ('auto', 'dml'):
        if name == 'auto' and torch.cuda.is_available(): return torch.device('cuda')
        try:
            import torch_directml
            return torch_directml.device()
        except (ImportError, OSError) as e:            # (not installed, or no DirectX 12 here)
            if name == 'dml': raise SystemExit(f'DirectML wanted, but it can\'t be had: {e} (pip install torch-directml)')
        return torch.device('cpu')
    return torch.device(name)


def load(data, labels='labels.jsonl'):
    """A folder's staves: labels.jsonl with tokens (staffdata.py), or with GABC items (align.js), tokenized here; or the
    words under them (align.js's text.jsonl, {file, text}): the text reader is this same reader, its tokens letters."""
    sys.path.insert(0, HERE)
    import staffdata
    rows = []
    for l in open(os.path.join(data, labels), encoding='utf-8'):
        r = json.loads(l)
        if 'tokens' not in r: r['tokens'] = list(r['text']) if 'text' in r else staffdata.tokens(r['items'])   # (words: their letters)
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
                skip = ('|', '/', '[', ']', ']*', '~')         # (chant's breaks; a mensural ligature's brackets and joins)
                sn, wn = [t for t in seq if t not in skip], [t for t in want if t not in skip]
                notes_err += edits(sn, wn); notes += len(wn)
    model.train()
    return errs / max(1, toks), notes_err / max(1, notes)


def split(rows, every):
    """Every so many pages kept out of training, to test on."""
    pages = sorted({r['file'].rsplit('-', 1)[0] for r in rows})
    held = set(pages[::every])
    return [r for r in rows if r['file'].rsplit('-', 1)[0] not in held], [r for r in rows if r['file'].rsplit('-', 1)[0] in held]


def train(o):
    rows, test = [], []
    for d in (o.data.split(',') if o.data else []):            # (synthetic staves from more than one folder: printed, manuscript)
        a, b = split(load(d), 33); rows += a; test += b
    real, real_test = [], []
    if o.real:                                                  # (more than one folder: commas, each with its labels)
        dirs, names = o.real.split(','), o.real_labels.split(',')
        for k, d in enumerate(dirs):
            a, b = split(load(d, names[min(k, len(names) - 1)]), 10); real += a; real_test += b
    device = device_of(o.device)
    dml = device.type == 'privateuseone'                     # DirectML
    old = torch.load(o.resume, map_location='cpu', weights_only=True) if o.resume else None
    vocab = old['vocab'] if old else vocab_of(rows + real)
    # (resuming, tokens the old model hasn't — a clef it never saw, as f1 and f2 in a German book — are added to the
    # end of its vocabulary, their scores new; with --grow-vocab, else such staves are left out as before)
    grown = [t for t in vocab_of(rows + real) if t not in set(vocab)] if old and o.grow_vocab else []
    vocab = vocab + grown
    index = {t: k + 1 for k, t in enumerate(vocab)}
    known = lambda r: all(t in index for t in r['tokens'])
    unknown = sum(not known(r) for r in rows + real)
    rows, test, real, real_test = ([r for r in x if known(r)] for x in (rows, test, real, real_test))
    rows = rows + real * o.real_weight                       # the real staves count for more: they are few
    rng = random.Random(1)
    model = Reader(len(vocab), o.width).to(device)
    if old:
        sd = dict(old['model'])
        if grown:                                                # (the old tokens' scores kept, the new ones' fresh)
            for k in ('out.weight', 'out.bias'):
                new = model.state_dict()[k].clone()
                new[:sd[k].shape[0]] = sd[k]
                sd[k] = new
        model.load_state_dict(sd)
    opt = torch.optim.AdamW(model.parameters(), lr=o.lr, weight_decay=1e-4, foreach=False if dml else None)
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
            at = 'cpu' if dml else device                     # (DirectML hasn't CTC: the loss on the CPU, its gradient back)
            loss = ctc(logp.to(at), torch.cat(targets).to(at), lens.to(at), torch.tensor([len(t) for t in targets]).to(at))
            opt.zero_grad(); loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 5, foreach=False if dml else None)
            opt.step(); sched.step(); step += 1
            total += loss.item()
            if n % 100 == 0:
                print(f'epoch {epoch + 1} batch {n}: loss {total / (n + 1):.3f} ({time.time() - t0:.0f} s)', flush=True)
        ter, ner = evaluate(model, test, None, vocab, device, limit=o.test_limit) if test else (None, None)
        rter, rner = evaluate(model, real_test, None, vocab, device, limit=o.test_limit) if real_test else (None, None)
        pct = lambda v: '-' if v is None else f'{v:.2%}'
        print(f'epoch {epoch + 1}: loss {total / (n + 1):.3f}; synthetic test staves: token errors {pct(ter)}, note errors {pct(ner)}; '
              f'real: token errors {pct(rter)}, note errors {pct(rner)} ({time.time() - t0:.0f} s)', flush=True)
        state = {'model': {k: v.cpu() for k, v in model.state_dict().items()}, 'vocab': vocab, 'width': o.width, 'epoch': epoch + 1, 'ter': ter, 'ner': ner, 'real_ter': rter, 'real_ner': rner}
        score = rter if rter is not None else ter
        torch.save(state, os.path.join(o.out, 'last.pt'))
        if score < best:
            best = score
            torch.save(state, os.path.join(o.out, 'best.pt'))


def restore(path):
    s = torch.load(path, map_location='cpu', weights_only=True)
    m = Reader(len(s['vocab']), s.get('width', 128))
    m.load_state_dict(s['model']); m.eval()
    return m, s


# ---------------------------------------------------------------- a fuller report (test --report)
CLEF = re.compile(r'^[cf]b?[1-5]$')
def kind_of(t):
    """What a chant token is: clef, custos, accidental, note, bar, mark (episema, ictus, mora) or break (| /)."""
    if CLEF.match(t): return 'clef'
    if t in ('|', '/', '!', '//'): return 'break'
    if t in (',', ';', ':', '::', '`') or re.fullmatch(r'[,;][0-9]', t): return 'bar'
    if t in ("'", '.', '_'): return 'mark'
    if re.fullmatch(r'[a-npA-NP]\+', t): return 'custos'
    if re.fullmatch(r'[a-np][xy#]', t): return 'accidental'
    if re.match(r'[a-npA-NP]', t): return 'note'
    return 'other'


def align(a, b):
    """Edit operations turning a (read) into b (wanted): [(op, i, j)], op 'ok', 'sub', 'ins' (a has an extra), 'del'
    (a lacks b[j])."""
    n, m = len(a), len(b)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1): d[i][0] = i
    for j in range(m + 1): d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] != b[j - 1]))
    ops, i, j = [], n, m
    while i or j:
        if i and j and d[i][j] == d[i - 1][j - 1] + (a[i - 1] != b[j - 1]):
            ops.append(('ok' if a[i - 1] == b[j - 1] else 'sub', i - 1, j - 1)); i -= 1; j -= 1
        elif i and d[i][j] == d[i - 1][j] + 1: ops.append(('ins', i - 1, None)); i -= 1
        else: ops.append(('del', None, j - 1)); j -= 1
    return ops[::-1]


def report(read, want, seed=0):
    """Measures over staves (read, want: token lists): printed, and returned as a dict."""
    notes = lambda ts: [t for t in ts if kind_of(t) == 'note']
    pitch = lambda t: t[0].lower()
    shape = lambda t: ('incl ' if t[0].isupper() else '') + t[1:]
    per = []                                                  # (pitch errors, notes wanted, note-token errors) a staff
    tot = {'sub': 0, 'ins': 0, 'del': 0}
    shape_ok = shape_n = 0
    cats = {}
    exact = exact_notes = clef_ok = clef_n = 0
    for r, w in zip(read, want):
        rn, wn = notes(r), notes(w)
        ops = align([pitch(t) for t in rn], [pitch(t) for t in wn])
        pe = sum(op != 'ok' for op, _, _ in ops)
        for op, i, j in ops:
            if op != 'ok': tot[op] += 1
            else:
                shape_n += 1; shape_ok += shape(rn[i]) == shape(wn[j])
        per.append((pe, len(wn), edits(rn, wn)))
        for c in ('clef', 'custos', 'accidental', 'bar', 'mark'):
            a, b = [t for t in r if kind_of(t) == c], [t for t in w if kind_of(t) == c]
            e = cats.setdefault(c, [0, 0, 0]); e[0] += edits(a, b); e[1] += len(b); e[2] += len(a)
        cr, cw = [t for t in r if kind_of(t) == 'clef'], [t for t in w if kind_of(t) == 'clef']
        if cw: clef_n += 1; clef_ok += cr == cw
        exact += [t for t in r if kind_of(t) != 'break'] == [t for t in w if kind_of(t) != 'break']
        exact_notes += rn == wn
    N = sum(n for _, n, _ in per) or 1
    rate = lambda k, idx: sum(p[idx] for p in [per[i] for i in k]) / max(1, sum(per[i][1] for i in k))
    rng = random.Random(seed)
    boots = sorted(rate([rng.randrange(len(per)) for _ in per], 0) for _ in range(1000)) if per else [0, 0]
    out = {'staves': len(per), 'notes': N,
           'pitch_error': sum(p[0] for p in per) / N, 'pitch_ci95': (boots[25], boots[974]) if len(boots) > 974 else None,
           'wrong_pitch': tot['sub'] / N, 'missed': tot['del'] / N, 'extra': tot['ins'] / N,
           'neume_error': sum(p[2] for p in per) / N, 'shape_error': 1 - shape_ok / max(1, shape_n),
           'staves_exact': exact / max(1, len(per)), 'staves_notes_exact': exact_notes / max(1, len(per)),
           'clef_right': clef_ok / max(1, clef_n),
           **{f'{c}_error': e[0] / max(1, e[1]) for c, e in cats.items()}, **{f'{c}_count': e[1] for c, e in cats.items()}}
    ci = out['pitch_ci95']
    print(f"REPORT {out['staves']} staves, {N} notes")
    print(f"  pitch (melody) error {out['pitch_error']:.2%}" + (f" (95% interval {ci[0]:.2%}-{ci[1]:.2%})" if ci else '') +
          f": wrong pitch {out['wrong_pitch']:.2%}, missed {out['missed']:.2%}, extra {out['extra']:.2%}")
    print(f"  neume error (pitch and shape: liquescent, quilisma, oriscus, virga, inclinatum, stropha) {out['neume_error']:.2%}; "
          f"of notes at the right pitch, shape wrong {out['shape_error']:.2%}")
    print(f"  staves read exactly {out['staves_exact']:.1%} (notes only {out['staves_notes_exact']:.1%}); clefs right {out['clef_right']:.1%}")
    print('  ' + '; '.join(f"{c} {cats[c][0] / max(1, cats[c][1]):.1%} wrong of {cats[c][1]} (read {cats[c][2]})" for c in ('accidental', 'custos', 'bar', 'mark') if c in cats and cats[c][1]))
    return out


def read_all(model, rows, vocab, size=16):
    out = []
    with torch.no_grad():
        for k in range(0, len(rows), size):
            group = rows[k:k + size]
            x, lens = collate([ink(image(r['dir'], r['file'])) for r in group])
            out += [seq for seq, _ in greedy(model(x), lens, vocab)]
    return out


def test(o):
    m, s = restore(o.model)
    rows = load(o.data, o.real_labels)
    if o.held:
        if o.held_from:                                       # (the pages a model was trained without: those its own labels held out)
            held = set.intersection(*({r['file'].rsplit('-', 1)[0] for r in split(load(o.data, f), o.held)[1]} for f in o.held_from.split(',')))
            rows = [r for r in rows if r['file'].rsplit('-', 1)[0] in held]
        else: rows = split(rows, o.held)[1]
    index = set(s['vocab'])
    rows = [r for r in rows if all(t in index for t in r['tokens'])]
    ter, ner = evaluate(m, rows, None, s['vocab'], 'cpu', limit=o.test_limit)
    print(f'{min(len(rows), o.test_limit or len(rows))} staves: token errors {ter:.2%}, note errors {ner:.2%}')
    if o.report:
        rows = rows[:o.test_limit] if o.test_limit else rows
        report(read_all(m, rows, s['vocab']), [r['tokens'] for r in rows])


def clean(o):
    """The real staves whose answers the model can believe: those it reads with fewer than half their notes wrong.
    An answer it reads far off is mostly not this staff's (the alignment broke the chant in the wrong place, or GregoBase
    has another version). Writes labels-clean.jsonl beside labels.jsonl (from --real-labels X.jsonl, X-clean.jsonl)."""
    m, s = restore(o.model)
    rows = load(o.data, o.real_labels)
    kept = dropped = 0
    name = os.path.splitext(o.real_labels)[0] + '-clean.jsonl'
    with open(os.path.join(o.data, name), 'w', encoding='utf-8') as out:
        for r in rows:
            x, l = collate([ink(image(r['dir'], r['file']))])
            with torch.no_grad(): seq, _ = greedy(m(x), l, s['vocab'])[0]
            a, b = [t for t in seq if t not in '|/'], [t for t in r['tokens'] if t not in '|/']
            if edits(a, b) < 0.5 * max(1, len(b)):
                out.write(json.dumps({k: v for k, v in r.items() if k != 'dir'}, ensure_ascii=False) + '\n'); kept += 1
            else: dropped += 1
    print(f'{kept} staves kept, {dropped} dropped -> {os.path.join(o.data, name)}')


def rebreak(o):
    """The real staves' line breaks, put where the model sees them. align.js breaks each chant's GABC into lines from
    what the page shows, and can put a neume or two on the wrong staff: the label then lacks them on one staff and has
    them extra on the next. Here a chant's neumes are lined up with what the model reads along all its staves at once
    (notes matched by an edit distance), and each goes to the staff it was read on; the chant's GABC is not changed,
    only where it breaks (each staff keeps its clef; a custos, the next staff's first note). Writes
    labels-rebroken.jsonl beside the labels."""
    sys.path.insert(0, HERE)
    import staffdata
    m, s = restore(o.model)
    rows, seen = [], set()
    for r in load(o.data, o.real_labels):
        if r['file'] not in seen: seen.add(r['file']); rows.append(r)
    chants = {}
    for r in rows: chants.setdefault(r['chant'], []).append(r)
    num = lambda r: (r['page'], int(r['staff'].rsplit('s', 1)[1]))
    notes = lambda ts: [t for t in ts if t not in '|/']
    moved = staves = 0
    for ch in chants.values():
        ch.sort(key=num)
        heads, tails, items, reads = [], [], [], []           # each staff's clef and custos; the items between, the notes read
        for k, r in enumerate(ch):
            it = list(r['items'])
            head = [it.pop(0)] if it and staffdata.kind(it[0]) == 'clef' else []
            tail = [it.pop()] if it and staffdata.kind(it[-1]) == 'custos' else []
            heads.append(head); tails.append(tail); items += [(g, k) for g in it]
            x, l = collate([ink(image(r['dir'], r['file']))])
            with torch.no_grad(): seq, _ = greedy(m(x), l, s['vocab'])[0]
            if seq and staffdata.kind(seq[0]) == 'clef': seq = seq[1:]
            if seq and staffdata.kind(seq[-1]) == 'custos': seq = seq[:-1]
            reads += [(t, k) for t in notes(seq)]
        if len(ch) < 2: continue
        truth = [(t, n) for n, (g, _) in enumerate(items) for t in notes(staffdata.tokens([g]))]
        a, b = [t for t, _ in truth], [t for t, _ in reads]
        d = np.zeros((len(a) + 1, len(b) + 1), np.int32)
        d[:, 0] = np.arange(len(a) + 1); d[0, :] = np.arange(len(b) + 1)
        for i in range(1, len(a) + 1):
            for j in range(1, len(b) + 1):
                d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (a[i - 1] != b[j - 1]))
        votes = {}                                              # each item: the staves its notes were read on
        i, j = len(a), len(b)
        while i and j:
            if d[i, j] == d[i - 1, j - 1] + (a[i - 1] != b[j - 1]):
                votes.setdefault(truth[i - 1][1], []).append(reads[j - 1][1]); i, j = i - 1, j - 1
            elif d[i, j] == d[i - 1, j] + 1: i -= 1
            else: j -= 1
        where, at = [], 0
        for n, (g, k) in enumerate(items):                      # (an item not matched, a bar: where the one before is)
            v = votes.get(n)
            at = max(at, sorted(v)[len(v) // 2] if v else at)
            where.append(at)
        per = [[g for (g, _), w in zip(items, where) if w == k] for k in range(len(ch))]
        for k, r in enumerate(ch):
            tail = tails[k]
            if tail and k + 1 < len(ch):                        # the custos: the next staff's first note
                first = next((t for g in per[k + 1] for t in notes(staffdata.tokens([g])) if t[0].lower() in staffdata.LETTERS), None)
                if first: tail = [first[0].lower() + '+']
            new = heads[k] + per[k] + tail
            if new != r['items']: moved += 1
            r['items'] = new; r['tokens'] = staffdata.tokens(new)
        staves += len(ch)
    out = os.path.join(o.data, 'labels-rebroken.jsonl')
    with open(out, 'w', encoding='utf-8') as f:
        for r in rows: f.write(json.dumps({k: v for k, v in r.items() if k not in ('dir', 'tokens', 'width')}, ensure_ascii=False) + '\n')
    print(f'{moved} of {staves} staves of chants on more than one staff broken elsewhere -> {out}')


def export(o):
    m, s = restore(o.model)
    x = torch.zeros(1, 1, HEIGHT, 400)
    os.makedirs(os.path.dirname(os.path.abspath(o.onnx)), exist_ok=True)
    torch.onnx.export(m, x, o.onnx, input_names=['staff'], output_names=['scores'], opset_version=17,
                      dynamic_axes={'staff': {0: 'batch', 3: 'width'}, 'scores': {0: 'batch', 2: 'steps'}}, dynamo=False)
    meta = {'vocab': s['vocab'], 'height': HEIGHT, 'stride': STRIDE, 'space': 8, 'top': 20, 'left': 0.6, 'right': 0.4,
            **({'notation': 'mensural', 'lines': 5, 'top5': 14} if o.mensural else {}),
            'epoch': s.get('epoch'), 'token_errors': s.get('ter'), 'note_errors': s.get('ner'),
            'real_token_errors': s.get('real_ter'), 'real_note_errors': s.get('real_ner')}
    with open(os.path.splitext(o.onnx)[0] + '.json', 'w', encoding='utf-8') as f: json.dump(meta, f, ensure_ascii=False)
    print(f'-> {o.onnx} ({os.path.getsize(o.onnx) / 1e6:.1f} MB)')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('what', choices=['train', 'test', 'export', 'clean', 'rebreak'])
    a.add_argument('--data', default=os.path.join(HERE, 'data', 'staves'), help='the staves (train: synthetic ones, folders separated by commas)')
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'model'))
    a.add_argument('--model')
    a.add_argument('--real', help='real staves too (align.js, cantus.py labels), every tenth page kept out to test on; folders separated by commas')
    a.add_argument('--real-weight', type=int, default=3)
    a.add_argument('--real-labels', default='labels.jsonl', help='the real staves\' labels (clean: those the model agrees with); one for each --real folder, by commas, or one for all')
    a.add_argument('--report', action='store_true', help='test: pitch, neume shape, clef, accidental, custos and bar errors, with a 95% interval')
    a.add_argument('--held-from', help='test --held: only the pages held out of each of these labels (those the model and its forebears were trained on, if not the ones tested on), commas between')
    a.add_argument('--held', type=int, help='test: only the pages kept out (every so many)')
    a.add_argument('--resume')
    a.add_argument('--grow-vocab', action='store_true', help='train --resume: add tokens the old model hasn\'t (else staves with them are left out)')
    a.add_argument('--onnx', default=os.path.join(HERE, '..', 'models', 'chant.onnx'))
    a.add_argument('--epochs', type=int, default=20)
    a.add_argument('--batch', type=int, default=16)
    a.add_argument('--lr', type=float, default=2e-3)
    a.add_argument('--width', type=int, default=128)
    a.add_argument('--test-limit', type=int, default=400)
    a.add_argument('--device', default='auto', help='auto, cpu, cuda or dml (DirectML)')
    a.add_argument('--mensural', action='store_true', help='export: a reader of mensural notation (CGMensural\'s text form, five-line staves cut with the top line at row 14, as fivestaves.py and mensuralsynth.py cut them)')
    o = a.parse_args()
    {'train': train, 'test': test, 'export': export, 'clean': clean, 'rebreak': rebreak}[o.what](o)
