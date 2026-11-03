"""Lines of medieval Latin manuscripts in Gothic book hands, transcribed, for the text reader: CATMuS Medieval
(Clérice et al., huggingface.co/datasets/CATMuS/medieval, CC BY 4.0), its Latin manuscripts in Textualis,
Semitextualis, Praegothica and Hybrida. Each file is fetched, its lines cut into strips as the app cuts the words under a
staff, and dropped again (the whole set is 26 GB).

The strip: CATMuS gives each line as a tight image; the app's text strip (CGRecognizer.textBand) is 64 rows from 3.3 to
6.3 staff spaces under the top line, 12 columns to a space across, so its letters stand about 20 rows high (the body of
a, n, o), on a line about row 31, and are drawn narrower than they are (12 columns to 21.3 rows a space). Each line here
is scaled so: its body (the rows its ink fills most) 20 rows high, its foot on row 31, its width × 0.5625; a little
moved and sized at random.

The words: CATMuS transcribes as written, its abbreviations kept (p̃, ꝑ, ꝰ, &, q;, a stroke over a vowel); the reader is
taught to write them out (as gothic.py's made-up lines teach it, and as Cantus's texts read). The signs that stand for
fixed letters are written out (ꝑ per, ꝓ pro, ꝰ us, ꝯ con, ꝝ rum, & et, q; que, b; bus, ſ s, ꝛ r …); a word with a
stroke or a sign for letters that vary is matched against the words of every chant text here (Cantus's fulltext_ms and
fulltext_standardized) and the Nidaros Breviary, where the letters it shows stand in order and the stroke stands for
some left out: the commonest such word if it is much the commonest, else the line is left out. Letters and spaces
only are kept (the app reads only those).

    python -I training/catmus.py --text breviarium.txt [--out training/data/text-catmus] [--scripts Tex,Sem,Pra,Hyb]
                                 [--only N] [--keep-going]

Writes <out>/NNNNNN.jpg and <out>/text.jsonl ({file, text, shelfmark, script, century, split}); resumable (files done
listed in <out>/done.txt)."""
import argparse, collections, csv, glob, io, json, os, re, sys, tempfile, unicodedata, urllib.request
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = 'https://huggingface.co/datasets/CATMuS/medieval'
HEIGHT, BODY, FOOT, SQUASH = 64, 20, 31, 12 / (64 / 3)

FIXED = {'ꝑ': 'per', 'ꝓ': 'pro', 'ꝰ': 'us', 'ꝯ': 'con', 'ꝝ': 'rum', 'ꝭ': 'is', '⁊': 'et', '&': 'et', 'ſ': 's', 'ꝛ': 'r',
         'ı': 'i', 'ȷ': 'j', 'ꝺ': 'd', 'ꝼ': 'f', 'ꝩ': 'v', 'æ': 'ae', 'œ': 'oe', 'Æ': 'Ae', 'Œ': 'Oe', 'ƀ': 'b', 'ꝟ': 'v',
         'ꞇ': 't', 'ꝣ': 'z', 'ʒ': 'z', 'ꝥ': 'th', 'ꝫ': 'et', 'ꝸ': 'um', 'ꝗ': 'q~', 'ꝙ': 'q~', 'ꝕ': 'p~', 'ꝍ': 'o'}
USUAL = {'qd': 'quod', 'qm': 'quam', 'qn': 'quando', 'qa': 'quia', 'qi': 'qui', 'scs': 'sanctus', 'sci': 'sancti',
         'sco': 'sancto', 'scm': 'sanctum', 'sca': 'sancta', 'sce': 'sancte', 'scis': 'sanctis', 'scorum': 'sanctorum',
         'oms': 'omnes', 'oma': 'omnia', 'oia': 'omnia', 'omib': 'omnibus', 'nr': 'noster', 'nri': 'nostri', 'nro': 'nostro',
         'nrm': 'nostrum', 'nra': 'nostra', 'nre': 'nostre', 'nrs': 'nostros', 'vr': 'vester', 'ur': 'uester', 'dns': 'dominus',
         'dni': 'domini', 'dno': 'domino', 'dnm': 'dominum', 'dne': 'domine', 'ds': 'deus', 'di': 'dei', 'do': 'deo',
         'dm': 'deum', 'eps': 'episcopus', 'epi': 'episcopi', 'xps': 'christus', 'xpi': 'christi', 'xpo': 'christo',
         'xpm': 'christum', 'ihs': 'iesus', 'ihu': 'iesu', 'aia': 'anima', 'aie': 'anime', 'gra': 'gratia', 'gla': 'gloria',
         'mia': 'misericordia', 'tra': 'terra', 'tre': 'terre', 'sps': 'spiritus', 'spm': 'spiritum', 'spu': 'spiritu',
         'tc': 'tunc', 'tn': 'tamen', 'ee': 'esse', 'e': 'est', 'n': 'non', 'p': 'per', 'pt': 'post', 'sr': 'super',
         'ad': 'ad', 'eccla': 'ecclesia', 'ecce': 'ecclesie', 'eccle': 'ecclesie', 'ap': 'apud', 'hr': 'habet',
         'om': 'omnem', 'ois': 'omnis', 'oi': 'omni', 'pr': 'pater', 'pris': 'patris', 'mr': 'mater', 'fr': 'frater',
         'sclm': 'seculum', 'scla': 'secula', 'sclorum': 'seculorum', 'alla': 'alleluia', 'all': 'alleluia',
         'evovae': 'euouae', 'euouae': 'euouae', 'ps': 'psalmus', 'ant': 'antiphona', 'cap': 'capitulum', 'iher': 'iherusalem',
         'ierlm': 'ierusalem', 'israhl': 'israhel', 'dd': 'david', 'mls': 'multis', 'qs': 'quis', 'q': 'que'}
MARKS = {'̃', '̄', '̅', '͠', '͡', '͞', '̆', '̑', '᷑', '̂', '̇',
         '̾', 'ͥ', 'ͤ', 'ͬ', 'ͣ', 'ͦ', 'ͧ', 'ͪ', 'ᷤ', 'ᷚ', '͐',
         '͒'}


def lexicon(text_path):
    """Every word of the chant texts here and the Breviary, with how often it comes."""
    n = collections.Counter()
    for path in glob.glob(os.path.join(HERE, 'data', 'cantus', '*.csv')):
        with open(path, encoding='utf-8') as f:
            for r in csv.DictReader(f):
                for k in ('fulltext_ms', 'fulltext_standardized'):
                    for w in re.findall(r'[A-Za-z]+', r.get(k) or ''): n[w.lower()] += 1
    if text_path and os.path.exists(text_path):
        for w in re.findall(r'[A-Za-z]+', open(text_path, encoding='utf-8').read()): n[w.lower()] += 1
    return n


class Expander:
    def __init__(self, lex):
        self.lex = lex
        self.by_first = collections.defaultdict(list)
        for w, c in lex.items():
            if len(w) > 1: self.by_first[w[0]].append((w, c))
        self.cache = {}

    def word(self, w):
        """A word as written, written out; None if that can't be told."""
        if w in self.cache: return self.cache[w]
        out = self._word(w)
        self.cache[w] = out
        return out

    def _word(self, w):
        w = unicodedata.normalize('NFD', w)
        s = ''
        for i, ch in enumerate(w):
            if ch in FIXED: s += FIXED[ch]
            elif ch in (';', '\uf1ac') and s and s[-1] in 'qQ': s += 'ue'
            elif ch in (';', '\uf1ac') and s and s[-1] in 'bB': s += 'us'
            elif ch == '\uf1ac': s += 'us'
            elif '\ue000' <= ch <= '\uf8ff': s += '~'                # (MUFI's other signs: some letters, to be found)
            elif ch in MARKS or unicodedata.category(ch) == 'Mn': s += '~'
            elif ch.isalpha() and ch.isascii(): s += ch
            elif ch in '.,:;·!?/-=\'"()[]⁘⸫¶': continue
            else: return None                                     # (a sign not known here)
        if '~' not in s: return s if s else None
        # (the commonest, whose letters fit several words: as the books mean them)
        k = s.lower().replace('~', '')
        if k in USUAL: return USUAL[k][0].upper() + USUAL[k][1:] if s[0].isupper() else USUAL[k]
        # a stroke: some letters left out, near it or elsewhere in the word (scõ sancto, qd̃ quod), the rest as written
        # and in order: a word that has them all in order, as many more as were left out (one to six)
        low = s.lower()
        letters = low.replace('~', '')
        if not letters or low[0] == '~': return None
        gap = '[a-z]{0,4}'
        pat = re.compile('^' + gap.join(re.escape(c) for c in letters) + (gap if low.endswith('~') else '') + '$')
        cands = [(c, x) for x, c in self.by_first.get(letters[0], []) if len(letters) < len(x) <= len(letters) + 6 and pat.match(x)]
        if not cands: return None
        cands.sort(reverse=True)
        if len(cands) > 1 and cands[0][0] < 3 * cands[1][0]: return None
        x = cands[0][1]
        return x[0].upper() + x[1:] if s[0].isupper() else x

    def line(self, text):
        out = []
        for w in text.split():
            e = self.word(w)
            if e is None: return None
            if e: out.append(e)
        t = ' '.join(out)
        return t if t and re.fullmatch(r'[A-Za-z ]+', t) else None


def strip(png, rng):
    """A line's image cut and scaled as the app's text strip, or None if its letters can't be found."""
    im = Image.open(io.BytesIO(png)).convert('L')
    a = np.asarray(im, np.float32).copy()
    if a.shape[0] < 8 or a.shape[1] < 30: return None
    # (CATMuS cuts each line to its outline and blacks out the rest: that is paper here)
    outside = a <= 2
    if outside.mean() > 0.9: return None
    paper = np.percentile(a[~outside], 90)
    a[outside] = paper
    ink = np.clip((paper - a) / max(1.0, paper - np.percentile(a, 2)), 0, 1)
    prof = ink.mean(1)
    if prof.max() <= 0: return None
    on = np.where(prof > 0.5 * prof.max())[0]
    body = on[-1] - on[0] + 1
    if body < 3: return None
    k = BODY * rng.uniform(0.88, 1.12) / body                      # (the body's height, a little varied)
    foot = FOOT + rng.uniform(-2.5, 2.5)
    W = max(8, int(round(a.shape[1] * k * SQUASH)))
    H = max(1, int(round(a.shape[0] * k)))
    small = np.asarray(Image.fromarray(a).resize((W, H), Image.LANCZOS), np.float32)
    out = np.full((HEIGHT, W), float(np.percentile(a, 90)), np.float32)
    top = int(round(foot - (on[-1] + 1) * k))                       # (the line's foot to the strip's)
    y0, y1 = max(0, top), min(HEIGHT, top + H)
    if y1 - y0 < BODY // 2: return None
    out[y0:y1] = small[y0 - top:y1 - top]
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def files(scripts):
    with urllib.request.urlopen(f'https://huggingface.co/api/datasets/CATMuS/medieval/tree/main?recursive=true', timeout=120) as r:
        tree = json.load(r)
    want = []
    for x in tree:
        name = x['path'].split('/')[-1]
        if x['type'] != 'file' or not name.endswith('.parquet') or not name.startswith('L-Lat.'): continue
        m = re.search(r'\.S-([^.]+)\.', name)
        if m and m.group(1) in scripts: want.append((x['path'], x['size']))
    return sorted(want)


def main(o):
    import pyarrow.parquet as pq, random
    rng = random.Random(o.seed)
    os.makedirs(o.out, exist_ok=True)
    done_path, labels_path = os.path.join(o.out, 'done.txt'), os.path.join(o.out, 'text.jsonl')
    done = set(open(done_path).read().split()) if os.path.exists(done_path) else set()
    n = sum(1 for _ in open(labels_path)) if os.path.exists(labels_path) else 0
    ex = Expander(lexicon(o.text))
    todo = [f for f in files(set(o.scripts.split(','))) if f[0] not in done][:o.only or None]
    print(f'{len(todo)} files to do; {n} lines so far', flush=True)
    for path, size in todo:
        tmp = os.path.join(tempfile.gettempdir(), 'catmus-part.parquet')
        urllib.request.urlretrieve(f'{REPO}/resolve/main/{path}', tmp)
        t = pq.read_table(tmp)
        kept = left = 0
        with open(labels_path, 'a', encoding='utf-8') as lab:
            for r in t.to_pylist():
                if r.get('language') != 'Latin': left += 1; continue
                text = ex.line(r['text'] or '')
                if not text: left += 1; continue
                im = strip(r['im']['bytes'], rng)
                if im is None: left += 1; continue
                name = f'{n:06d}.jpg'
                im.save(os.path.join(o.out, name), quality=88)
                lab.write(json.dumps({'file': name, 'text': text, 'shelfmark': r.get('shelfmark'), 'script': r.get('script_type'),
                                      'century': r.get('century'), 'split': r.get('gen_split')}, ensure_ascii=False) + '\n')
                n += 1; kept += 1
        os.remove(tmp)
        with open(done_path, 'a') as d: d.write(path + '\n')
        print(f'{path.split("/")[-1][:70]}: {kept} kept, {left} left out ({n} in all)', flush=True)


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--text', help='the Nidaros Breviary text (gothic.py), for the words')
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'text-catmus'))
    a.add_argument('--scripts', default='Tex,Sem,Pra,Hyb')
    a.add_argument('--only', type=int, default=0)
    a.add_argument('--seed', type=int, default=1)
    main(a.parse_args())
