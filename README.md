# ChantGPT

**Version 0.21.1** · early test version

ChantGPT reads scans of Gregorian chant, from printed books and manuscripts, and gives you the music in GABC (the
format of [Gregorio](https://gregorio-project.github.io/)), with the places it isn't sure of marked for you to check
against the page. Everything runs in your browser: your scans are never uploaded.

**Try it: [tghamacher.github.io/ChantGPT](https://tghamacher.github.io/ChantGPT/)** (a recent Chrome, Edge, Firefox
or Safari on a computer; it isn't made for phones).

## Testing it

1. **Open** a PDF or page images of a chant book (📂 Open, or drop the files on the page), or a manuscript a library
   puts online (🌐 Online: paste its IIIF manifest's address, from Gallica, e-codices, the Bayerische
   Staatsbibliothek and others).
2. **Find staves** (☰). Drag any line that's off into place, delete anything that isn't a staff, or drag a box around
   a staff it missed.
3. **Read page**: the recognizer reads the notes. Neumes it's unsure of are orange.
4. **Read text** puts the words under the notes.
5. Check against the page (hold **H** to see the scan alone, **Space** to hear it), correct what's wrong (drag a neume
   up or down; click a syllable to retype it), and **save** the GABC.

Press **?** in the app for the mouse and the keys.

**What it reads best so far**

- Printed Solesmes books in square notation (the 1908 *Graduale Romanum*, the *Liber usualis*, the antiphonals).
- Manuscripts in square notation on red four-line staves (e.g. Paris, BnF lat. 15181; Einsiedeln 611; the
  Salzinnes Antiphonal), German Gothic (Hufnagel) notation on staves ruled with a red F line (e.g. Köln,
  Dombibliothek, Cod. 1161), and French point notation on a page ruled evenly in pale ink (e.g. Paris, BnF
  lat. 12044: turn on *Ruled evenly, words on every fifth line* in a page's right-click menu first), and the great
  choirbooks of the 16th to 18th centuries on five-line red staves (e.g. a Mexican choirbook, Stanford Codex 0734:
  turn on *Five-line staves* in a page's right-click menu first; the GABC is saved with `staff-lines: 5`).
- Words in Gothic and other book hands, and Gothic print.

**Not yet:** staffless or heighted neumes (St Gall, Laon, Aquitanian), mensural notation, printed books of the
17th and 18th centuries (Medicaean and neo-Gallican shapes: no real pages to train on yet), and pages very unlike the
ones above. Expect to correct things: it is a first version, and the point of testing is to find where it goes wrong.

**Feedback:** [open an issue on GitHub](https://github.com/tghamacher/ChantGPT/issues/new) (a free account is
needed), or tell Ted directly. Most useful: which book or manuscript and which page (a link to the library's page is
ideal), what you did, and what went wrong. A screenshot helps.

## Everything it does

You can:

- open a PDF of a chant book, or photographs or scans of its pages (JPEG, PNG, WebP), or a manuscript a library
  puts online with IIIF (Gallica, the Bayerische Staatsbibliothek, e-codices …): give its manifest's address, and the
  pages come from the library as you turn to them; save a range of them, at full size, as one zip;
- page through it and zoom;
- find its staves: on a page, or on every page of a book, ChantGPT finds each staff's four lines in the ink, tilt and
  all, and bent where the page couldn't be scanned flat. Or drag a box around a staff to mark it yourself. If a line
  is off, drag it into place; double-click to bend a staff where it needs it; hold H to see the page without the lines
  over it;
- mark where chants begin: in a Solesmes book, ChantGPT finds them at the staves set in for a chant's initial; you
  confirm or correct each (B);
- work the way you like: the page fills the window, with a toolbar of the main actions on the left and an inspector
  on the right for what's selected; right-click a neume, a syllable, a staff or the page for what you can do with it
  (a neume's shape among them: punctum, virga, inclinatum, quilisma, oriscus; and on a staff, where a chant begins
  part way along it, as manuscripts so often have it); the keys are listed under ?;
- place a chant's GABC (from GregoBase, say) on its staves: GABC without line breaks is spread over all the chant's
  staves, down to where the next chant begins, even over a page turn, with a clef at each line's start and a custos
  at its end, as printed. Its lines are broken where the page seems to break them, read from how much ink each staff
  carries (its notes, and its words underneath) and from the custos at its end; if a line still breaks elsewhere on
  the page, move a syllable to the next line or the one before.
  It is drawn in square notation over the page, in
  Gregorio's own font, each note at its pitch on the staff, bent with the staff if it bends, so you can see where the
  page and the GABC differ. Hold H to see the page alone; make the notation more or less see-through;
- place a whole book's chants page by page, for a book GregoBase has indexed, such as the 1908 *Graduale Romanum*:
  open the book's index (made with `training/gregobase.py book`; see [training/README.md](training/README.md)) with
  the scan, say once which page of the book a scan page is, and on each page "Place this page's chants" finds the
  staves and where chants begin, and places the chants GregoBase lists for that page, a chant running over the page
  turn included;
- read the notes from the scan: one model for printed books, and one for manuscripts (a page whose staves are ruled in
  red, or a book marked as ruled evenly, is read by the manuscript one; choose either beside the Read buttons). On a
  staff without chant, what it reads is put on the staff; on a staff with chant placed from GregoBase, each neume is
  moved to where it was seen and those that differ from what was read are marked in orange, with what was read, so
  you look only at those. Placing a book page's chants does this by itself;
- read the words under the staves (printed books, Gothic print, and manuscripts in Gothic and other book hands) and
  put each syllable under its neume;
- correct it on the page: drag a neume up or down by steps (its GABC changes with it) or along the staff to line it
  up with the source; Shift-drag moves a single note; or use the arrow keys, and Enter to accept a neume and go on;
- correct the words: click a syllable to change its text, give its reading as written (for abbreviations: *dñs* for
  *Dominus*), drag it into place, split a syllable at a neume or join it to the one before;
- accept a staff once it's right (Shift+Enter). Places the recognizer will be unsure of must be accepted one by
  one first; what you've checked turns green;
- see the checks that need no AI: a custos that doesn't point to the next note, a staff without its clef, leaps of a
  seventh or more, flats off B, and (when the GABC gives the mode) a final or notes outside the mode's range. They're
  listed, and marked on the page; click one to go to it;
- save the chant as GABC again, with the page's line breaks; copy it as Volpiano (for CANTUS); save a page as MEI
  with neumes, each element tied to its place on the page, as DDMAL's Neon reads it;
- save what you've marked as a document, and open it again with the scan to carry on.

How the recognizers are trained, and how well they read: [training/README.md](training/README.md) and the
"Done" list in [HANDOFF.md](HANDOFF.md).

## Running it on your computer

The app is plain HTML and JavaScript, with no build step. Browsers won't run it straight from the folder (`file://`),
so serve the folder, for example with Python:

```
python -m http.server 8000
```

and open http://localhost:8000.

## Tests

- In a browser: serve the folder as above and open http://localhost:8000/test/ (add `?only=gabc` to run some).
- With Node, the tests that don't need a browser: `node test/node.js`.
- The training corpus reader: `python -I training/test_gregobase.py`.

## The pieces

- `index.html`, `css/site.css`, `js/app.js`: the page and its controls.
- `js/viewer.js`: opens PDFs (with [pdf.js](https://mozilla.github.io/pdf.js/), kept in `vendor/pdfjs`) and images,
  and draws one page at a time.
- `js/editor.js`: the editing layer over the page (for now, staves), with undo.
- `js/staves.js`: staff geometry, and finding a staff's four lines in the ink.
- `js/neumes.js`: square notation from GABC: notes gathered into glyphs and named as Gregorio does, and laid out
  along a staff. `js/greciliae.js` is the table of the font's glyphs (made by `tools/build-greciliae.sh`).
- `fonts/greciliae.ttf`: Gregorio's chant font; see `fonts/README.md`.
- `tools/make-test-scan.js`: makes `test/pages/engraved.jpg`, chant engraved by exsurge and roughened to look like a
  scan, and `warped.jpg`, the same page curling up towards the binding, each with the true position of every line,
  for testing the line finding.
- `js/checks.js`: the checks that need no AI. `js/export.js`: Volpiano and MEI.
- `js/chant.js`: the document format (GABC placed on the page), reading and writing GABC, and checks. See
  [docs/format.md](docs/format.md).
- `training/`: the training data: GregoBase's chants as a corpus (`gregobase.py`), and synthetic pages drawn from it
  with their answers (`render.js`). See [training/README.md](training/README.md).
- `HANDOFF.md`: the plan.

## Licence

Copyright (C) 2026 Ted Hamacher.

ChantGPT is free software: you can use it, share it and change it under the terms of the GNU General Public License,
version 3 or (at your option) any later version; see [LICENSE](LICENSE). It comes with no warranty. In short: anyone may
use and change it, and anyone who shares a changed version must share its source under the same licence.

It is under the GPL because the way it gathers notes into glyphs follows Gregorio's own code, which is under the GPL.
The parts made by others keep their own licences: pdf.js (Apache License 2.0) and the Greciliae font (SIL Open Font
License 1.1), both of which may be shared with GPL software.

## Credits

pdf.js by Mozilla, Apache License 2.0 (`vendor/pdfjs/LICENSE`). ONNX Runtime Web by Microsoft, MIT License
(`vendor/onnxruntime`). Greciliae, the chant font of
[Gregorio](https://gregorio-project.github.io/), by Matthew Spencer and the Gregorio Project, SIL Open Font License 1.1
(`fonts/OFL-greciliae.txt`); how glyphs are gathered and named follows Gregorio's own code (GPLv3). Mensural rhythm is
reckoned by [JS_ScUp](https://github.com/martha-thomae/JS_ScUp), the scoring-up tool of the Measuring Polyphony editor,
by Martha Thomae (MIT), with [fraction.js](https://github.com/rawify/Fraction.js) by Robert Eisele (MIT)
(`vendor/scoring-up`). The mensural signs are
from EMS_Serenissima by Elam Rotem ([Early Music Sources](https://www.earlymusicsources.com/)), used with his
permission (`fonts/Serenissima.otf`; `js/serenissima.js` holds their outlines, made by `training/serenissima.py`). The test scan is engraved with
[exsurge](https://github.com/frmatthew/exsurge) by Fr. Matthew Spencer, MIT License.

The recognizers were trained on chant texts and melodies from [Cantus Database](https://cantusdatabase.org/) and
[GregoBase](https://gregobase.selapa.net/), on scans made public by the libraries that hold the books and manuscripts,
and on lines from [CATMuS Medieval](https://huggingface.co/datasets/CATMuS/medieval) (Thibault Clérice et al.,
CC BY 4.0). The reader of mensural notation learnt, besides staves made up with Serenissima, from
[Capitan](https://grfia.dlsi.ua.es/) (a 17th-century manuscript from Zaragoza, by the GRFIA group of the University of
Alicante, freely available for research) and [SEILS](https://github.com/SEILSdataset/SEILSdataset) (*Il Lauro Secco*,
1582, by Emilia Parada-Cabaleiro et al., CC BY-NC-SA 4.0).
