# Training data

What the recognizer (step 4) learns from. Nothing here is published: the corpus and the pages made from it go in
`training/data/`, which git ignores.

## 1. The corpus: GregoBase

```
python -I training/gregobase.py build      # from GregoBase's database dump (cloned from GitHub)
python -I training/gregobase.py update     # the chants added on the site since (one request a second)
```

`training/data/gregobase.jsonl` then holds one chant to a line:
- its GABC;
- incipit, office part (GregoBase's codes: `an`, `in`, `gr`, `rb` …), mode;
- the books and pages it is printed on (the Liber Usualis, the Graduales of 1908, 1961 and 1974, the Antiphonale
  Monasticum and some forty more);
- tags, the CANTUS ID where GregoBase gives one, and the copyrighted and duplicate flags.

The dump (in GregoBase's GitHub repository, last updated January 2024) has 18,762 chants. The site has about 2,000
more, fetched one by one by `update`.

`gregobase-sources.json` lists the books by GregoBase's source numbers.

```
python -I training/gregobase.py book --source 1      # the Graduale Romanum of 1908
```

This writes `training/data/gregobase-1.book.json`, a book's index for the app:
- its pages as the book numbers them, in order (the 1908 Graduale has 940, from I to 156*);
- the chants on each page, in order, with how many pages each runs over and its GABC.

GregoBase sends no CORS headers, so the app can't fetch from it directly; the index is made here and opened in the app
with the scan.

Test: `python -I training/test_gregobase.py`.

## 2. Synthetic pages

```
node training/render.js --pages 1000 [--from 0] [--out training/data/synth]
```

This draws pages like a Solesmes book: chants one under another, each with its initial and rubric (*Ant. 7*), its
first staff set in, spread over as many staves as it needs with a clef at each line's start and a custos at each
line's end.

- **Layout:** the app's own layout code (`js/neumes.js`) and Gregorio's font. Syllables are spaced by their neumes or
  their words, whichever is wider, and lines are justified.
- **Variety:** spacing, margins, tilt, bowed staves, red or black lines, ink, three serif faces, paper colour, uneven
  light, blur, specks, JPEG quality.
- **Long chants:** a chant too long for a page fills an empty page and runs off its foot, as in a book.

It uses the chants that aren't marked copyrighted or as duplicates, shuffled the same way every time. It takes about
half a second a page, and about 0.5 MB a page.

Each `synth-NNNNNN.jpg` comes with `synth-NNNNNN.json`, the answers:
- `doc`: a ChantGPT document, the same format the editor saves (see `docs/format.md`):
  - every staff's lines;
  - its syllables, with text, the text as printed (`dipl`, without the initial) and a box;
  - each neume's GABC and box;
  - the chants, with GregoBase's id, and the initial's letter and box.

  Pages corrected by hand in the app are the same kind of answer, so real pages and synthetic ones train together.
- `glyphs`: each glyph drawn, with its name in the font (`PesQuadratumOneNothing`), its pitch (a staff position,
  `a` = 0) and box, and the staff, syllable and neume it belongs to.
- `spacing`: the staves' line spacing in pixels.

`skipped.json` lists chants that couldn't be drawn (no clef at the start; about one in two hundred).

The pages are drawn in a browser, Chromium through Playwright, so that the layout is the app's own. The training
itself (step 4) will be Python.

## Still to come in step 3

- Aligning real scans with GregoBase. The corpus gives the book and page of each chant, so a scan of the Liber Usualis
  or a Graduale can be given its chants page by page, placed by the app, and corrected by hand. That gives real pages
  with answers.
- A second engraver for variety: Gregorio itself, and exsurge.
