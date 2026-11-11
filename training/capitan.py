"""Capitan (University of Alicante, GRFIA: Calvo-Zaragoza et al.), a 17th-century manuscript in late white mensural
notation (a mass; Zaragoza, Catedral del Pilar, B-59.850): 576 staves, each a photograph cut round one staff, with the
symbols on it in order and where each stands. Freely available for research. Download it (125 MB) and unzip it:

    curl -L -o Capitan.zip https://grfia.dlsi.ua.es/musicdocs/Capitan.zip

    python -I training/capitan.py --corpus DIR [--out training/data/capitan]

Each staff's five lines found (fivestaves.py, by their ink), the staff straightened as the mensural strips are (64 rows,
8 to a space, the top line at row 14), and its symbols written as CGMensural's text form (js/mensural.js):
  - positions: Capitan counts a note's line from the top line (0) down (4), two figures the space between, negative
    ones above the staff; a C or F clef's line from the top line (1) down (5); a G clef is always marked 5 but drawn
    on the second line from the bottom (checked on the pages: g2). Here: steps up from the bottom line.
  - in this late hand the black minim is the semiminima (our Sm: black, a stem), the black semiminima with its flag
    (or beamed) our fusa, the black fusa our semifusa; a coloured breve or semibreve is a black one (B*, Sb*).
  - CUTTIME is C|, COMMONTIME C, PROPORTIOMINOR the proportion 3; BARLINE |.
Staves with chant notes (GREGORIAN) or a smudge are left out, and those whose lines aren't found.

Writes <out>/NNN-1.png and <out>/labels.jsonl ({file, text, tokens}), as mensuralsynth.py does."""
import argparse, glob, json, os, re, sys
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fivestaves as F

VAL = {'MAXIMA': 'Mx', 'MAXIMA2': 'Mx', 'MAXIMA3': 'Mx', 'MAXIMA4': 'Mx', 'LONGA': 'L', 'BREVIS': 'B', 'SEMIBREVIS': 'Sb', 'MINIMA': 'M'}
BLACK = {'COLOUREDMINIMA': 'Sm', 'COLOUREDSEMIMINIMA': 'F', 'BCOLOUREDSEMIMINIMA': 'F', 'COLOUREDFUSA': 'Sf', 'BCOLOUREDFUSA': 'Sf'}
RESTS = {'MAXIMAREST': 'Mx', 'LONGAREST': 'L', 'BREVISREST': 'B', 'SEMIBREVISREST': 'Sb', 'MINIMAREST': 'M', 'SEMIMINIMAREST': 'Sm', 'FUSAREST': 'F'}


def position(code):
    """Capitan's place (0 the top line, 4 the bottom; '01' the space between; '-10' above the top line; '13' from the
    second line to the fourth, a rest's span) as steps up from the bottom line (its middle, for a span)."""
    m = re.fullmatch(r'(-?\d)(-?\d)?', code)
    if not m: raise ValueError(code)
    a = int(m.group(1)); b = int(m.group(2)) if m.group(2) is not None else a
    return (2 * (4 - a) + 2 * (4 - b)) // 2


def convert(symbols):
    """Capitan's symbols as CGMensural's text form; None if the staff has something it can't say."""
    out = []
    for s in symbols:
        name, _, code = s.strip().partition('.')
        code = code.strip()
        if name in ('GREGORIAN', 'SMUDGE') or not name: return None
        if name == 'BARLINE': out.append('|'); continue
        if name == 'CUTTIME': out.append('C|'); continue
        if name == 'COMMONTIME': out.append('C'); continue
        if name == 'PROPORTIOMINOR': out.append('3'); continue
        if name.endswith('CLEF'):
            # (C and F: their line counted from the top line, 1; seen on the page. Every G clef is marked 5, but each
            # is drawn as the treble clef, its curl round the second line from the bottom: g2)
            out.append('g2' if name == 'GCLEF' else name[0].lower() + str(6 - int(code))); continue
        if name == 'MAXIMAREST' and not code: out.append('rMx4'); continue      # (written without a place: across the staff)
        p = position(code)
        if name in VAL: out.append(f'{VAL[name]}{p}')
        elif name in BLACK: out.append(f'{BLACK[name]}{p}')
        elif name.startswith('COLOURED') and name[8:] in VAL: out.append(f'{VAL[name[8:]]}{p}*')
        elif name in RESTS: out.append(f'r{RESTS[name]}{p}')
        elif name == 'DOT': out.append(f'.{p}')
        elif name == 'CUSTOS': out.append(f'+{p}')
        elif name == 'FLAT': out.append(f'b{p}')
        elif name == 'SHARP': out.append(f'#{p}')
        else: return None
    return ' '.join(out)


def main(o):
    os.makedirs(o.out, exist_ok=True)
    F.N, F.DARK = 5, True
    F.NEAR, F.EVEN = 0.3, 0.4                               # (ruled by hand: its spaces differ by a third)
    kept = skipped = unfound = 0
    with open(os.path.join(o.out, 'labels.jsonl'), 'w', encoding='utf-8') as f:
        for lab in sorted(glob.glob(os.path.join(o.corpus, 'Labels', '*.txt')), key=lambda p: int(os.path.basename(p)[:-4])):
            n = os.path.basename(lab)[:-4]
            text = convert(open(lab, encoding='utf-8').read().split())
            if not text: skipped += 1; continue
            img = os.path.join(o.corpus, 'Corpus', n + '.jpg')
            H = Image.open(img).height
            gray, staves = F.page(img, spacing=(0.06 * H, 0.2 * H))
            if not staves: unfound += 1; continue
            # (the staff: the five lines found nearest the crop's middle)
            lines, g = min(staves, key=lambda t: abs((t[0][0][1] + t[0][4][1]) / 2 - H / 2))
            name = f'{int(n):03d}-1.png'
            Image.fromarray(F.straighten5(gray, lines)).save(os.path.join(o.out, name))
            f.write(json.dumps({'file': name, 'text': text, 'tokens': text.split()}) + '\n')
            kept += 1
    print(f'{kept} staves kept; {skipped} left out for chant or smudges; {unfound} whose lines weren\'t found -> {o.out}')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--corpus', required=True, help='the unzipped Capitan.zip (its Corpus and Labels folders)')
    a.add_argument('--out', default=os.path.join(HERE, 'data', 'capitan'))
    main(a.parse_args())
