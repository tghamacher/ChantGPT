# ChantGPT

**Version 0.5.0** · a working title

ChantGPT will read scans of Gregorian chant, from printed books and manuscripts, and give you the music in GABC (the
format of [Gregorio](https://gregorio-project.github.io/)), with the places it isn't sure of marked for you to check
against the page. Renaissance mensural notation comes after that.

Everything runs in your browser. Your scans are never uploaded.

## What it does now

These are the first steps. You can:

- open a PDF of a chant book, or photographs or scans of its pages (JPEG, PNG, WebP);
- page through it and zoom;
- mark its staves: drag a box around a staff and ChantGPT finds its four lines in the ink, tilt and all, and bent
  where the page couldn't be scanned flat. If a line is off, drag it into place; double-click to bend a staff where
  it needs it; hold H to see the page without the lines over it;
- place a chant's GABC (from GregoBase, say) on its staves: it is drawn in square notation over the page, in
  Gregorio's own font, each note at its pitch on the staff, bent with the staff if it bends, so you can see where the
  page and the GABC differ. Hold H to see the page alone; make the notation more or less see-through;
- correct it on the page: drag a neume up or down by steps (its GABC changes with it) or along the staff to line it
  up with the source; Shift-drag moves a single note; or use the arrow keys, and Enter to accept a neume and go on;
- save the chant as GABC again, with the page's line breaks;
- save what you've marked as a document, and open it again with the scan to carry on.

Next, accepting a whole staff at once, and the words: moving and correcting syllables. After that, finding staves by
itself, and then recognition.

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
- `js/chant.js`: the document format (GABC placed on the page), reading and writing GABC, and checks. See
  [docs/format.md](docs/format.md).
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
