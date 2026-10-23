# Handoff: ChantGPT (chant OMR in the browser, then mensural partbooks)

Background for a new Claude Code session. First written in the Serenissima Press session (2026-10-23); updated the same
day when the plan changed to start with Gregorian chant.

## The idea

**ChantGPT** (a working title) reads scans of music and turns them into editable, encoded music, with the places it
is unsure of flagged for the user to check. It starts with **Gregorian chant in square notation on four lines** and
grows into **Renaissance mensural notation on five lines**.

The mensural goal came from Elam Rotem (Early Music Sources, maker of the EMS Serenissima font), who saw Serenissima
Press (github.com/tghamacher/serenissima-press, which typesets MusicXML as mensural partbooks and choirbooks) and asked
for the reverse:

> The dream would be to put a complete PDF, and the app would understand which part belongs to what, and would put
> everything in modern scores. It would probably need to have a system of alerting the user for possible mistakes that
> they could then review manually.

### Why chant first

- **A smaller problem.** Four lines, movable C and F clefs, one flat, the custos, divisio bars and a few dozen neume
  shapes. Chant is a single line of music, so there are no mensural rules, no scoring up and no sorting pages into
  voices.
- **Free training data with answers.** GregoBase holds thousands of chants in GABC (the format of Gregorio). They can be
  rendered as synthetic staves, and the public-domain Vatican books (the 1908 *Graduale Romanum*, early editions of the
  *Liber Usualis*) can be aligned with GregoBase's transcriptions of the same chants to give real scans with known
  answers.
- **It proves the shared parts:** the in-browser viewer, staff finding, the editor over the page image, the recognizer
  and ONNX in the browser, the alerts. Mensural then mostly changes the symbol set and adds its own rules.
- **The cost:** scoring up and sorting partbooks, which are what Elam asked for, come later. Tell him the order if
  keeping him posted.

## What already exists

- **Chant:**
  - **GregoBase** (gregobase.selapa.net): a large GABC corpus, mostly of the Solesmes books.
  - **Gregorio** (LaTeX) and **exsurge** (JavaScript) render GABC. exsurge could also show recognized chant re-engraved
    in the app.
  - **CANTUS database / Cantus Index**: chant texts and melodies (Volpiano), for matching a recognized chant to known
    versions.
  - **DDMAL / SIMSSA** (McGill): Cantus Ultimus, ground truth in MEI-Neumes for the Salzinnes Antiphonal and Einsiedeln
    121, the Calvo pixel classifier for page layers, Rodan, Neon (a neume editor in the browser).
  - Serenissima Press's `js/gabc.js` already parses GABC (for setting chant beside polyphony): reuse its tests' cases.
- **Mensural:**
  - **Mensural OMR** by David Cheong: omr-webapp-1046295414238.us-central1.run.app. One JPG page, a login, staves and
    clef, key and time set by hand; gives one modern part; no sorting, scoring up or checks. Worth contacting about its
    model or data.
  - **Aruspix** (Laurent Pugin): recognition of early printed music.
  - **MuRET** (University of Alicante: Calvo-Zaragoza, Rizo): mensural recognition with a correction interface.
  - **Martha Thomae's scoring-up tool** (SIMSSA, McGill): mensural parts into a score.

## Decisions so far

- **Everything runs in the browser, hosted on GitHub Pages.** No server, no uploads, no accounts, as in Serenissima
  Press.
  - pdf.js opens the PDF. It is vendored in `vendor/pdfjs/` (not a CDN), so the app works offline and loads nothing
    from third parties.
  - The recognizer runs with ONNX Runtime Web (WebGPU or WASM).
  - Plain JavaScript, no build step, modules as IIFEs on `window` (as in Serenissima Press).
- **The recognizer is a small specialist model, not an LLM or general vision model.**
  - A staff-level network reads a cut-out staff left to right and outputs a symbol sequence (CRNN + CTC, as in text
    recognition). For chant the symbols are GABC's: pitches as staff positions, neume shapes, clefs, bars, custos,
    flats.
  - The finished model is a 10–50 MB `.onnx` file on GitHub Releases or Hugging Face Hub, not in git.
  - Users' files never go through Claude or the user's account.
- **The internal format is GABC with positions on the page** (see `docs/format.md`): staves with their four lines,
  syllables with their text and GABC note groups, each with a box and a confidence. It exports to GABC directly and
  later to MEI-Neumes and Volpiano. MusicXML handles chant poorly and is for the mensural stage.
- **Most of the app is ordinary code, not AI.** For chant:
  - pitch from the clef, clef changes and the flat;
  - the custos check (it should match the first note of the next staff);
  - neume grouping and syllables;
  - alerts: the model's confidence, a custos that doesn't match, a melody outside its mode's usual range, and
    differences from known versions of the same chant (GregoBase, CANTUS) found by its text;
  - export.
  For mensural, later: perfection, imperfection, alteration, coloration, ligatures, scoring up, and alerts from the
  parts disagreeing (Serenissima Press's `checkBars` in `js/convert.js` already checks voices out of step).
- **Training happens locally on the user's AMD RX 6700 XT (12 GB).**
  - Try `torch-directml` on Windows first.
  - Linux with ROCm and `HSA_OVERRIDE_GFX_VERSION=10.3.0` is faster.
  - Google Colab is the fallback.
- **Training data for chant, in order of use:**
  1. Synthetic staves rendered from GregoBase's GABC (Gregorio or exsurge), in several fonts and spacings, with
     degradation (paper texture, ink spread, blur, tilt, bleed-through).
  2. Public-domain Vatican books aligned with GregoBase's transcriptions of the same chants, then checked by hand.
  3. Manuscripts later: SIMSSA's Salzinnes and Einsiedeln ground truth (check licenses).
  4. Corrections made in the app's own editor, and later corrections users share (needs a small backend, such as a
     Cloudflare Worker; not part of the core app).
- **Training data for mensural (later):** synthetic staves from Serenissima Press (a new export mode there), SEILS,
  Capitan, MuRET data (check contents and licenses), facsimiles (BSB, ÖNB, Gallica, IMSLP; DIAMM has stricter terms)
  aligned with modern editions.
- **First source: printed books before manuscripts.** Suggested proof of concept: a few pages of the 1908 *Graduale
  Romanum* (to be confirmed by the user).

## Plan

0. **Set-up** (done, see below):
   - repo skeleton and GitHub Pages;
   - pdf.js page viewer (PDFs and page images);
   - the internal format, its GABC export and import, and tests.
1. **No AI yet:**
   - the editor over the page image: mark staves and their lines, place clefs, neumes, bars, custos and syllables;
   - pitch from the clef, the custos check, the other rule-based alerts;
   - GABC export (done in step 0), exsurge preview, MEI-Neumes and Volpiano export;
   - saving and opening a project.
   - Test on one chant entered by hand.
2. **Layout:** find staves and text lines automatically (classical image processing first, a pixel classifier if
   needed); split a book into chants by their initials and titles, with the user confirming.
3. **Training data:** the GregoBase download and synthetic rendering pipeline (in `training/`, Python), and aligning
   scans of the Vatican books with GregoBase.
4. **The recognizer:** train it, run it in the browser, and feed its confidence scores into the alerts.
5. **Mensural:** a five-line symbol set, the mensural rules, sorting partbooks into voices and pieces, scoring up and
   MusicXML export (Elam Rotem's request). Proof of concept: one printer's partbooks, such as a complete Gardano set.
6. **Later:** manuscripts, text recognition (perhaps Kraken), shared corrections.

## Done

- **Step 0** (version 0.1.0):
  - `index.html`, `css/site.css`, `js/app.js`: open a PDF or page images, page through them, zoom, with an empty
    overlay (`<svg>`) drawn from the document in page coordinates, ready for the editor.
  - `js/viewer.js`: renders PDF pages (pdf.js) and images to a canvas, one page at a time.
  - `js/chant.js`: the internal format (see `docs/format.md`): a new document for a source, GABC import and export,
    pitch from the clef, the kind of each GABC group, and checks of a document.
  - `test/`: unit tests, in the browser (`test/index.html`) or with Node (`node test/node.js`).

## Still open

- Which print, and which pages, for the first test (suggested: the 1908 *Graduale Romanum*).
- Versioning: does "stage, commit, and sync" here also bump the version and add release notes and a tag, as in
  Serenissima Press?
- GitHub Pages must be switched on by the user: Settings → Pages → Deploy from a branch → `main`, folder `/ (root)`.

## Working with the user

- The user is Ted Hamacher, a musicologist fluent in mensural notation, chant and Renaissance sources. They work on
  Windows (PowerShell and Git Bash).
- **Commits:** no git identity is configured, so commit with
  `git -c user.name="Ted Hamacher" -c user.email="60490684+tghamacher@users.noreply.github.com" commit ...`.
- **"Stage, commit, and sync"** means commit, then `git pull --rebase`, then push.
  - In Serenissima Press, each such commit also gets a version bump, release notes and a tag, unless the user calls it a
    silent update. Not yet decided for this repo.
- The user prefers user-facing text that is plain, instructive and sounds human, not stilted.
