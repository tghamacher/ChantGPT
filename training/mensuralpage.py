"""Whole pages of made-up mensural notation, for testing the app's mensural tools on mensural staves (not chant's): the
staves drawn as mensuralsynth.py draws them (EMS Serenissima's signs, ligatures by the rules, words under them), set
on a page as the books set them, with what the page's staves are written down beside it.

  --style print      a printed partbook's page (Gardano, Scotto): black lines, a voice's name above, the staves one
                     under another, two ruled staves left empty at the foot
  --style choirbook  a manuscript choirbook's page (the Alamire workshop): ruled in red, larger, two voices one above
                     the other (Cantus, Tenor; three staves each), each named, an empty staff at the foot

    python -I training/mensuralpage.py --style print --out test/pages/mensural-print.png
    python -I training/mensuralpage.py --style choirbook --out test/pages/mensural-choirbook.png

Writes the page (PNG) and, beside it, <name>.json: {style, size, spacing, staves: [{voice, top, bottom, left, right,
empty, text}]} (the staves' outer lines' rows and ends, in the page's pixels; text: the staff in CGMensural's text
form)."""
import argparse, json, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mensuralsynth as M

WORDS = 'Kyrie eleison Christe Gloria in excelsis Deo et in terra pax hominibus bonae voluntatis Laudamus te benedicimus adoramus glorificamus Sanctus Dominus Deus Sabaoth pleni sunt caeli Agnus Dei qui tollis peccata mundi miserere nobis'.split()


def page(style, seed=1, width=1100, height=1500, space=10):
    if style == 'choirbook': space = 14                     # (a choirbook's staves large on its page: a choir sang from it)
    rng = random.Random(seed)
    sg = M.signs()
    paper = (238, 232, 214) if style == 'print' else (226, 210, 178)
    im = Image.new('RGB', (width, height), paper)
    d = ImageDraw.Draw(im)
    scale = space / (M.SPACE * M.S)                           # (drawn at S times SPACE to a space; here space)
    margin, top = int(0.08 * width), int(0.07 * height)
    staff_w = width - 2 * margin
    font = ImageFont.truetype(M.ROMAN[0], int(2.4 * space)) if M.ROMAN else None
    plan = ([('Tenor', 8, False)] + [('', 2, True)]) if style == 'print' else [('Cantus', 3, False), ('Tenor', 3, False), ('', 1, True)]
    style_draw = 'print' if style == 'print' else 'choirbook'
    y, out = top, []
    for voice, n, empty in plan:
        if voice and font:
            d.text((margin, y), voice, fill=(40, 30, 25) if style == 'print' else (150, 40, 30), font=font)
            y += int(3.2 * space)
        for k in range(n):
            items = M.compose(rng, rng.randint(24, 34))
            drawn_w = int(staff_w / scale)
            strip = M.draw_staff(items, rng, sg, [] if empty else WORDS, style_draw, color=True, paper=paper, empty=empty, width=drawn_w)
            strip = strip.resize((staff_w, int(strip.height * scale)), Image.LANCZOS)
            im.paste(strip, (margin, y))
            # (the staff's top and bottom lines, as drawn: rows TOP5 and TOP5 + 4 SPACE of the strip, scaled)
            t, b = y + M.TOP5 * M.S * scale, y + (M.TOP5 + 4 * M.SPACE) * M.S * scale
            out.append({'voice': voice, 'top': round(t, 1), 'bottom': round(b, 1), 'left': margin, 'right': margin + staff_w, 'empty': empty, 'text': None if empty else M.text(items)})
            y += strip.height + int(0.6 * space)
        y += int(1.5 * space)
    if y > height: raise SystemExit(f'the page is too short for its staves ({y} > {height})')
    return im, {'style': style, 'size': [width, height], 'spacing': space, 'staves': out}


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument('--style', choices=['print', 'choirbook'], required=True)
    a.add_argument('--out', required=True)
    a.add_argument('--seed', type=int, default=1)
    o = a.parse_args()
    im, info = page(o.style, o.seed)
    im.save(o.out)
    json.dump(info, open(os.path.splitext(o.out)[0] + '.json', 'w'), indent=1)
    print(len(info['staves']), 'staves ->', o.out)
