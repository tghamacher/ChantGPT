"""SEILS (Parada-Cabaleiro et al.): Il Lauro Secco (Ferrara, 1582), 30 madrigals for five voices, each voice's page
scanned from the print (150 pages) and its symbols written out in order with where each stands (the diplomatic OMR
ground truth: SEILS_diplomatic_OMRgroundTruth, .agnostic). CC BY-NC-SA 4.0: free for non-commercial (academic) use,
crediting the authors, sharing alike. https://github.com/SEILSdataset/SEILSdataset

    pdfimages -j <particellas_original>/NAME.pdf <scans>/NAME                (each page's image, as scanned)
    python -I training/seils.py --scans DIR --labels DIR [--out training/data/seils]

Each page's staves found (printstaves.py: lines set from short pieces of type, at the page's own spacing; the empty
staves at a page's foot left out: on 127 of the 145 pages as many as the symbols have, against 22 with fivestaves.py); its symbols cut into staves (each staff ends with a custos, the next begins with its clef); and where
the page has as many staves found as its symbols have, each staff straightened as the mensural strips are (64 rows, 8 to
a space, the top line at row 14) and labelled in CGMensural's text form (js/mensural.js). A page whose counts differ
is left out (its staves would be paired wrongly).
  - positions: L1 the bottom line, S1 the space above it, L0 and S0 below the staff: steps up from the bottom line.
  - a note's \\ or / is its stem, down or up; a ligature's notes between ligature.start and .end; metersign.C/ is C|,
    digit.3 the proportion 3; a natural, n.

Writes <out>/NAME-k.png and <out>/labels.jsonl ({file, text, tokens})."""
import argparse, glob, json, os, re, sys
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fivestaves as F, printstaves as P
import numpy as np

VAL = {'maxima': 'Mx', 'longa': 'L', 'brevis': 'B', 'semibrevis': 'Sb', 'minima': 'M', 'semiminima': 'Sm', 'fusa': 'F', 'semifusa': 'Sf'}


def position(code):
    """L3 (a line, from the bottom) or S2 (a space) as steps up from the bottom line."""
    m = re.fullmatch(r'([LS])(-?\d+)', code)
    if not m: return None                                   # (a symbol without a place: the staff can't be said)
    k = int(m.group(2))
    return 2 * (k - 1) if m.group(1) == 'L' else 2 * k - 1


def staves_of(tokens):
    """The symbols cut into staves: each ends with its custos (the last, perhaps, without one); one ending a section
    with a bar, and no custos, ends where the next begins with its clef."""
    out, cur = [], []
    for t in tokens:
        if t.startswith('clef.') and cur and cur[-1].startswith('barline'): out.append(cur); cur = []
        cur.append(t)
        if t.startswith('custos'): out.append(cur); cur = []
    if cur: out.append(cur)
    return out


def convert(symbols):
    """One staff's symbols as CGMensural's text form; None if something can't be said."""
    out, lig = [], None
    for s in symbols:
        name, _, code = s.rpartition('-') if re.search(r'-[LS]-?\d+$', s) else (s, '', '')
        if name == 'ligature.start' or name == 'ligature~.start': lig = []; continue
        if name in ('ligature.end', 'ligature~.end'):
            if not lig or len(lig) < 2: return None
            out.append('[' + ' '.join(lig) + ']'); lig = None; continue
        if name == 'barline': out.append('|'); continue
        if name.startswith('metersign.'): out.append({'C': 'C', 'C/': 'C|', 'O': 'O', 'O/': 'O|'}.get(name[10:], None) or ''); continue
        if name.startswith('digit.'): out.append(name[6:]); continue
        p = position(code)
        if p is None: return None
        m = re.fullmatch(r'note\.([a-z]+)([\\/]?)~?', name)
        if m and m.group(1) in VAL:
            v = VAL[m.group(1)]
            if lig is not None: lig.append(f'{v}{p}'); continue
            out.append(f'{v}{p}' + {'\\': 'v', '/': '^', '': ''}[m.group(2)]); continue
        m = re.fullmatch(r'rest\.([a-z]+)', name)
        if m and m.group(1) in VAL: out.append(f'r{VAL[m.group(1)]}{p}'); continue
        if name.startswith('clef.') and code.startswith('L'): out.append(name[5].lower() + code[1:]); continue
        if name == 'dot': out.append(f'.{p}'); continue
        if name == 'custos': out.append(f'+{p}'); continue
        if name.startswith('accidental.'):
            a = {'flat': 'b', 'sharp': '#', 'natural': 'n'}.get(name[11:])
            if not a: return None
            out.append(f'{a}{p}'); continue
        return None
    if lig is not None or '' in out: return None
    return ' '.join(out)


def main(o):
    os.makedirs(o.out, exist_ok=True)
    pages = kept = 0
    with open(os.path.join(o.out, 'labels.jsonl'), 'w', encoding='utf-8') as f:
        for lab in sorted(glob.glob(os.path.join(o.labels, '*.agnostic'))):
            name = os.path.basename(lab)[:-9]
            scans = glob.glob(os.path.join(o.scans, name + '-*.jpg'))
            if not scans: continue
            tokens = [t.strip() for t in open(lab, encoding='utf-8').read().split('\t') if t.strip()]
            parts = staves_of(tokens)
            gray = np.asarray(Image.open(scans[0]).convert('L')).astype(np.float32)
            if np.median(gray) < 100: gray = 255 - gray              # (a negative)
            found = P.find(gray)
            pages += 1
            if len(found) != len(parts): continue
            for k, ((lines, g), part) in enumerate(zip(found, parts)):
                text = convert(part)
                if not text: continue
                file = f'{name}-{k + 1}.png'
                Image.fromarray(F.straighten5(gray, lines)).save(os.path.join(o.out, file))
                f.write(json.dumps({'file': file, 'text': text, 'tokens': re.findall(r'\]\*|\[|\]|~|[^\s\[\]~]+', text)}) + '\n')
                kept += 1
    print(f'{kept} staves kept, from the pages whose staves were all found; {pages} pages -> {o.out}')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--scans', required=True, help='the pages\' images (pdfimages -j of particellas_original)')
    a.add_argument('--labels', required=True, help='particellas_OMRgroundTruth (the .agnostic files)')
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'seils'))
    main(a.parse_args())
