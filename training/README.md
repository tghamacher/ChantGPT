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

In the app, open the scan and the index together, go to a page of the book, and say which page of the book it is
(Chant panel, "From the book's index"). Then, page by page, "Place this page's chants". Correct each page and save the
document: the corrected pages are real pages with answers, for training.

The 1908 Graduale: archive.org has the CMAA's scan (item `graduale-romanum-1908`, 948 pages, 1-bit at 300 dpi).
Scan page 25 is the book's page 1, and the rest follow without a break (checked at pages 100, 500 and 100*).

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

Some pages have heavier notes (the glyphs outlined, as the Vatican edition's notes nearly fill a space), and some are
black and white only, as the CMAA's scan of the Graduale is.

## 3. Real staves: a book aligned with GregoBase

```
node training/align.js --pdf training/data/scans/gr1908.pdf --book training/data/gregobase-1.book.json \
  --at 25 --label 1 [--from 25] [--to 948] [--out training/data/real]
```

This drives the app over a scanned book GregoBase has indexed, page by page: it finds the staves, marks where chants
begin, places the chants GregoBase lists for the page, and reads their line breaks from the page. It keeps the staves of
chants whose every custos, read on the page, agrees with the next line's first note, a sign the breaks are right. Each
is saved straightened, with its GABC (`labels.jsonl`: `file`, `items`, `page`, `chant`, `staff`).

These answers are not checked by hand. What GregoBase has and what the page prints can differ, and breaks can still be
wrong where no custos says otherwise. On the first pages of the 1908 Graduale about 57% of staves are kept.

The scan: `curl -L -o training/data/scans/gr1908.pdf https://archive.org/download/graduale-romanum-1908/graduale-romanum-1908.pdf`.

## 4. The recognizer

```
python -I training/staffdata.py synth                   # the synthetic pages' staves -> training/data/staves
python -I training/recognizer.py train [--epochs 20]    # -> training/data/model/best.pt
python -I training/recognizer.py export --model training/data/model/best.pt    # -> models/chant.onnx, chant.json
```

`staffdata.py` cuts each staff out and straightens it along its lines. Every staff comes out 64 pixels high, with 8
pixels to a space: the top line at row 20 and the bottom line at row 44, the same scale along the staff. It writes the
staff's tokens:
- a note: its letter (upper case for an inclinatum), then its shape (`v`, `V`, `o`, `O`, `w`, `s`, `r`) and its
  liquescence (`~`, `<`, `>`);
- an accidental (`ix`), a mora (`.`), an episema (`_`), an ictus (`'`);
- a clef (`c4`), a bar (`,` `;` `:` `::` `` ` ``), a custos (`g+`);
- `/` between glyphs and `|` between neumes.

`js/recognizer.js` straightens a staff the same way in the browser; checked to agree within one grey level.

`recognizer.py` is a small convolutional network: about 800,000 weights. It folds the staff's 64 rows away, then reads
along it, one output step to two columns, with 1-D convolutions wide enough to see a whole neume. It is trained with
CTC, which needs only each staff's tokens, not where each note is. Training adds variety: shifts, stretching, blur,
heavier or lighter ink, black and white, noise. It uses a GPU if there is one (CUDA, or ROCm for an AMD card).
Exported to ONNX, it runs in the app with ONNX Runtime Web (`vendor/onnxruntime`), on the CPU, in WebAssembly.

Python packages: `pip install torch numpy pillow onnx` (for an AMD card, torch from the ROCm index).

The real staves' labels are not checked by hand, and two things go wrong in them; both are mended with a model:

```
python -I training/recognizer.py rebreak --model training/data/model2/best.pt --data training/data/real
python -I training/recognizer.py clean --model training/data/model2/best.pt --data training/data/real --real-labels labels-rebroken.jsonl
```

- `rebreak`: align.js can break a chant's lines a neume or two off, so that a staff's label lacks what it ends with
  and the next one's has it extra. Each chant's neumes are lined up with what the model reads along all its staves,
  and go to the staff they're read on (the GABC itself unchanged); a custos becomes the next staff's first note.
  Writes `labels-rebroken.jsonl`. On the Graduale it moved neumes on 989 of 2,150 staves.
- `clean`: of those, the staves the model reads with fewer than half their notes wrong (the rest are mostly another
  version of the chant than the page's): `labels-rebroken-clean.jsonl`, 1,868 of 2,211.

By these labels the model in `models/` reads 2.4% of the notes wrong on Graduale staves it never learnt from (190 of
them; flattering, as the same model mended the labels, though it only moved whole neumes from staff to staff). By the
old breaks it was 7.1%: most of that was the labels'. What it still gets wrong: mostly whether glyphs are joined or
spaced (`/`), a quilisma read as a plain note, a bar's kind. On synthetic staves, about 5%.

## 5. Training on your own GPU (Windows, an AMD card)

AMD's PyTorch for Windows doesn't take an RX 6000 card (only RX 7000 and 9000), so on Windows the GPU is used through
DirectML: Microsoft's torch-directml, which runs on any DirectX 12 card. It needs Python 3.8 to 3.12 (it brings
torch 2.4.1 with it). `recognizer.py` finds it by itself (`--device auto`; `--device dml` to insist).

The staves already made (synthetic and the Graduale's) and the latest checkpoint are on the branch `training-data`,
as zips, so they needn't be made again. In PowerShell, with Python 3.12 (python.org, "Add to PATH") and Git installed:

```
git clone https://github.com/tghamacher/ChantGPT
cd ChantGPT
git clone --depth 1 --single-branch -b training-data https://github.com/tghamacher/ChantGPT ..\chantgpt-data
Get-ChildItem ..\chantgpt-data\*.zip | ForEach-Object { tar -xf $_.FullName }    # into training\data\
py -3.12 -m venv venv
Set-ExecutionPolicy -Scope Process Bypass                                          # (lets the next line run)
.\venv\Scripts\Activate.ps1
pip install torch-directml "numpy<2" pillow onnx
python -c "import torch_directml as d; print(d.device_name(0))"                    # the card's name
```

Then train, starting from the checkpoint (a pass over the 18,920 staves took 13 minutes on the CPUs here):

```
python -I training\recognizer.py train --resume training\data\model2\best.pt --real training\data\real --real-labels labels-clean.jsonl --epochs 5 --lr 5e-4 --out training\data\model3
```

The first lines say `on privateuseone:0` (DirectML) and how long each 100 batches takes. Each pass ends with the
error rates on the synthetic and real staves kept out, and saves `best.pt` and `last.pt` in `--out`. A larger
`--batch` (32, 64) may use the card better. Then:

```
python -I training\recognizer.py test --model training\data\model3\best.pt --data training\data\real --real-labels labels-clean.jsonl --held 10
python -I training\recognizer.py export --model training\data\model3\best.pt
git add models
git commit -m "Recognizer: trained on the GPU"
git push
```

(`export` writes `models\chant.onnx` and `chant.json`; the app picks them up.) The CTC loss is worked out on the
CPU (DirectML hasn't it), the rest on the card.

## Still to come

- A second engraver for variety: Gregorio itself, and exsurge.
- Training on the real staves, and on pages corrected by hand.
