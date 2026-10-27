# ChantGPT

**Version 0.13.1** · a working title

ChantGPT will read scans of Gregorian chant, from printed books and manuscripts, and give you the music in GABC (the
format of [Gregorio](https://gregorio-project.github.io/)), with the places it isn't sure of marked for you to check
against the page. Renaissance mensural notation comes after that.

Everything runs in your browser. Your scans are never uploaded.

## What it does now

These are the first steps. You can:

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
- read the notes from the scan (an early recognizer, trained so far on synthetic pages and on the 1908 Graduale): on
  a staff without chant, what it reads is put on the staff; on a staff with chant placed from GregoBase, each neume is
  moved to where it was seen and those that differ from what was read are marked in orange, with what was read, so
  you look only at those. Placing a book page's chants does this by itself when the recognizer is there;
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

The recognizer is at an early stage: see [training/README.md](training/README.md) for how it is trained and how
well it reads.

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

pdf.js by Mozilla, Apache License 2.0 (`vendor/pdfjs/LICENSE`). Greciliae, the chant font of
[Gregorio](https://gregorio-project.github.io/), by Matthew Spencer and the Gregorio Project, SIL Open Font License 1.1
(`fonts/OFL-greciliae.txt`); how glyphs are gathered and named follows Gregorio's own code (GPLv3). The test scan is engraved with
[exsurge](https://github.com/frmatthew/exsurge) by Fr. Matthew Spencer, MIT License.
