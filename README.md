# ChantGPT

**Version 0.2.0** · a working title

ChantGPT will read scans of Gregorian chant, from printed books and manuscripts, and give you the music in GABC (the
format of [Gregorio](https://gregorio-project.github.io/)), with the places it isn't sure of marked for you to check
against the page. Renaissance mensural notation comes after that.

Everything runs in your browser. Your scans are never uploaded.

## What it does now

These are the first steps. You can:

- open a PDF of a chant book, or photographs or scans of its pages (JPEG, PNG, WebP);
- page through it and zoom;
- mark its staves: drag a box around a staff and ChantGPT finds its four lines in the ink, tilt and all. If a line is
  off, drag it into place; hold H to see the page without the lines over it;
- save what you've marked as a document, and open it again with the scan to carry on.

Next, the chant itself: GABC drawn as square notation on the staves, over the page, so you can move each neume and
syllable until it matches the source. After that, finding staves by itself, and then recognition.

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
- `tools/make-test-scan.js`: makes `test/pages/engraved.jpg`, chant engraved by exsurge and roughened to look like a
  scan, with the true position of every line, for testing the line finding.
- `js/chant.js`: the document format (GABC placed on the page), reading and writing GABC, and checks. See
  [docs/format.md](docs/format.md).
- `HANDOFF.md`: the plan.

## Credits

pdf.js by Mozilla, Apache License 2.0 (`vendor/pdfjs/LICENSE`). The test scan is engraved with
[exsurge](https://github.com/frmatthew/exsurge) by Fr. Matthew Spencer, MIT License.
