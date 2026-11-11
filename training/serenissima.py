"""js/serenissima.js from Elam Rotem's EMS_Serenissima font (fonts/Serenissima.otf, used with his permission): the shapes
of the mensural signs, for drawing over a page.

The font is for typesetting: each character is a note (or rest, clef …) at one height on its own piece of five-line
staff, the next character the same note a step higher. Over a page, those staff lines would be drawn on top of the
page's own; so here each sign wanted is taken from one character (at a known height, with its stem up or down), drawn
large, its staff lines taken out (inside the band of each line, and of the ledger lines above and below, an ink run
no thicker than a line, and not running on past it, is the line), and its outline traced and kept: in spaces (a staff
space is 1), its origin at its left, on the staff position it stands for (the note's head; a clef's line; a rest's
middle, foot or top as below), y down.

    python -I training/serenissima.py            # -> js/serenissima.js

Needs fonttools, pillow, numpy and opencv (pip install fonttools opencv-python-headless)."""
import json, os, sys
import numpy as np, cv2
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, '..', 'fonts', 'Serenissima.otf')
OUT = os.path.join(HERE, '..', 'js', 'serenissima.js')
TOP, H = 1000, 2000                   # the canvas: the baseline at row TOP, one font unit a pixel
LINE0, SPACE = 92.0, (550 - 92) / 4   # the bottom staff line's height above the baseline, and a space (font units)

# name: (character, the staff position it stands for in that character). The position is where its anchor is: a
# note's head, a clef's line, a breve or longa rest's middle, a semibreve rest's top line (it hangs from it), a minim
# or smaller rest's foot (it stands on it), a dot's middle, an accidental's (or custos's) head.
SIGNS = {
    'clefC': (0x10A10, 4), 'clefF': (0x10A13, 4), 'clefG': (0x10A14, 2),
    'Mx.up': (0x10A1F, 0), 'Mx.down': (0x10A27, 8), 'L.up': (0x10A31, 0), 'L.down': (0x10A39, 8),
    'B': (0x10A48, 1), 'Sb': (0x10A57, 2),
    'M.up': (0x10A63, 0), 'M.down': (0x10A6B, 8), 'Sm.up': (0x10A71, 0), 'Sm.down': (0x10A78, 8),
    'F.up': (0x10A7F, 0), 'F.down': (0x10A87, 8), 'Sf.up': (0x10A8D, 0), 'Sf.down': (0x10A95, 8),
    'kL.up': (0x10B9F, 0), 'kL.down': (0x10BA7, 8), 'kB': (0x10BAF, 1), 'kSb': (0x10BBF, 2),
    'rL': (0x10B6C, 2), 'rLp': (0x10B66, 3), 'rB': (0x10AAC, 3), 'rSb': (0x10AB9, 4), 'rM': (0x10AC7, 4),
    'rSm': (0x10AD3, 2), 'rF': (0x10AE0, 2),
    'dot': (0x10AEC, 3), 'sharp': (0x10B07, 2), 'flat': (0x10B1C, 0), 'custos': (0x10B33, 0),
    'signC': (0x10AF6, 4), 'signCstroke': (0x10AF7, 4), 'signO': (0x10AF8, 4), 'signOstroke': (0x10AF9, 4),
}


def raster(font, cp):
    im = Image.new('L', (1400, H), 0)
    ImageDraw.Draw(im).text((20, TOP), chr(cp), font=font, fill=255, anchor='ls')
    return np.asarray(im) > 127


def unstaffed(a, thick=24, reach=21):
    """The staff and ledger lines taken out (as the module says), and the specks left by their bulges."""
    a = a.copy()
    bands = [(TOP - (LINE0 + k * SPACE) - reach, TOP - (LINE0 + k * SPACE) + reach) for k in range(-5, 10)]
    for x in range(a.shape[1]):
        col, y = a[:, x], 0
        while y < len(col):
            if not col[y]: y += 1; continue
            y1 = y
            while y1 < len(col) and col[y1]: y1 += 1
            if y1 - y <= thick and any(b0 <= y and y1 <= b1 for b0, b1 in bands): a[y:y1, x] = False
            y = y1
    s = a.astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(s, 8)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < 250: s[lab == i] = 0
    return s


def path(s, p):
    """The outline as SVG path data in spaces: x from the character's origin, y down from staff position p."""
    cs, _ = cv2.findContours(s, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    yp = TOP - (LINE0 + p * SPACE / 2)
    out, xs = [], []
    for c in cs:
        c = cv2.approxPolyDP(c, 1.6, True)[:, 0, :]
        if len(c) < 3: continue
        pts = [((x - 20) / SPACE, (y - yp) / SPACE) for x, y in c]
        xs += [q[0] for q in pts]
        out.append('M' + 'L'.join(f'{x:.3f} {y:.3f}'.rstrip('0').replace('.0 ', ' ') for x, y in pts) + 'Z')
    return ''.join(out), (min(xs), max(xs)) if xs else (0, 0)


def main():
    font = ImageFont.truetype(FONT, 1000)
    have = TTFont(FONT).getBestCmap()
    table = {}
    for name, (cp, p) in SIGNS.items():
        if cp not in have: sys.exit(f'{name}: U+{cp:X} is not in the font')
        d, (x0, x1) = path(unstaffed(raster(font, cp)), p)
        table[name] = {'d': d, 'x0': round(x0, 3), 'x1': round(x1, 3)}
        print(f'{name}: {len(d)} characters of path, {x1 - x0:.2f} spaces wide')
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('// The mensural signs of Elam Rotem\'s EMS_Serenissima (Early Music Sources; used with his permission), their\n'
                '// staff lines taken out: made by training/serenissima.py from fonts/Serenissima.otf. Each is SVG path data in\n'
                '// staff spaces, its origin at its left on the staff position it stands for, y down; x0, x1 its ink\'s extent.\n'
                '(function (global) {\n  global.CGSerenissima = ' + json.dumps(table, separators=(',', ':')) + ';\n'
                '})(typeof window !== \'undefined\' ? window : globalThis);\n')
    print(f'{len(table)} signs -> {OUT} ({os.path.getsize(OUT) // 1024} KB)')


if __name__ == '__main__':
    main()
