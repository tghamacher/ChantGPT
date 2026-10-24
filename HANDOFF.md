# Handoff: ChantGPT (chant OMR in the browser, then mensural partbooks)

Background for a new Claude Code session. First written in the Serenissima Press session (2026-10-23); updated the same
day when the plan changed to start with Gregorian chant, and on 2026-10-24 with the design of the editing layer.

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
    121, the Calvo pixel classifier for page layers, Rodan.
  - **Neon** (DDMAL): a neume editor in the browser, over the manuscript image, in MEI. The nearest thing to our editing
    layer: try it before designing the details, for what works and what doesn't (selecting, grouping, setting pitch).
- **Text:**
  - **Kraken** (and eScriptorium, built on it): text recognition for historical documents.
  - **CATMuS Medieval**: a large shared training set for medieval handwriting, transcribed as written, abbreviations
    kept. Kraken models trained on it exist.
  - **MUFI** (Medieval Unicode Font Initiative): the characters for abbreviation marks, as editions of medieval texts use
    them.
  - Gregorio's Latin hyphenation patterns: for dividing words into syllables.
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
- **Checking and correcting happen in an editing layer over the scan** (designed with the user, 2026-10-24; see "The
  editing layer" below). The proposed transcription, notation and text, is drawn on top of the source where the model
  found it, and the user moves and changes it until it matches. Entering a chant by hand is the same tool with nothing
  proposed.
- **Text is read too, as written and expanded.** Each syllable keeps the reading as written (abbreviation marks and
  all, in MUFI characters) and the expanded one, which goes into the GABC. Expansions come mostly from matching the
  chant to its known text, not from guessing (see below).
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

## The editing layer

The user's idea: a see-through layer over the source showing the proposed transcription, which the user rearranges and
tweaks until it matches the page behind it. The step-0 overlay draws plain boxes; those stay underneath (for selecting
and dragging, and as the record of where the model looked), but what the user sees is the notation and the text.

**What the user sees**

- The proposed neumes drawn in square notation on the scan, sized from the staff lines beneath, in a see-through colour
  so the source shows through. A note one step off visibly misses the note under it.
- The syllables drawn under the staff where they were found, in the same colour.
- Colour by confidence: doubtful items stand out.
- An opacity slider, and a key held down to hide the layer, to flick between transcription and source (easier for
  catching small misplacements than reading through a half-transparent layer).
- Optionally, a clean re-engraved strip under each staff (exsurge), to read the result as music.

**Editing the notation**

- **A neume's height on the staff is its pitch.** Dragging a neume up or down snaps it to a line or space and rewrites
  its GABC letters to match (`fgh` → `ghi`). Dragging sideways moves it along the staff; past a neighbour, it changes
  their order.
- Clicking one note inside a neume moves just that note (the top of a torculus, say).
- The keyboard, for speed: Tab and Shift+Tab to the next and previous doubtful item; ↑↓ a step; ←→ along the staff;
  Enter accepts; Delete; keys to split and merge neumes; a small palette (or keys) to change shapes: virga, quilisma,
  oriscus, liquescent, episema, mora.
- Undo and redo throughout.
- Staves first: the user can drag the four lines to fit, tilt included. Every pitch hangs on them, so once they fit
  most neumes fall into place.

**Editing the text**

- Each syllable has two readings: **as written** (*dñs*, keeping abbreviation marks in MUFI characters) and **expanded**
  (*Dominus*), which goes into the GABC. The layer shows either, the other on hover, with a switch for the whole page.
- Click a syllable to type in it; drag it sideways to set it under a different neume; split or merge syllables.
  Dividing words follows Gregorio's Latin hyphenation.
- A misread or misplaced syllable shows against the source like a wrong note.

**Why abbreviations are hard, and the way round it**

- Abbreviations are one of the hardest parts of reading medieval text by machine. The marks are ambiguous: a stroke
  over a vowel for *m* or *n*; barred and looped *p* for *per*, *pro*, *prae*; the 9-shaped sign for *con-* at the
  start of a word and *-us* at the end. Reading the mark is the easy part; choosing the expansion takes the word and its
  context. Contractions (*dns*, *xps*, *scs*, *gla*) must be known as words. And a word spread out under a melisma
  upsets ordinary text recognition.
- The printed Vatican books have almost none: *Ps.*, ℣ and ℟, and *E u o u a e* (*saeculorum. Amen*). So abbreviations
  mostly arrive with the manuscripts.
- **The way round it: chant texts are already known.** CANTUS and GregoBase hold them. The app reads what it can, finds
  the known chant (*Dns dixit ad me* → *Dominus dixit ad me*, the Introit of the Midnight Mass of Christmas), aligns the
  two, and takes the expansions from the match. Finding the chant also identifies it, which the melody alerts need
  anyway. Only a text that can't be found falls back to guessing, and those guesses are flagged.
- Reading the text itself: Kraken with a model trained on CATMuS Medieval (transcribed as written, which suits the two
  readings). For print, an ordinary OCR model may do.

**Changes to the format (docs/format.md)**

- Each note of a neume gets its own position (an x for each note), so single notes can be dragged and the glyphs drawn
  where the model saw them.
- Each syllable gets the reading as written beside `text` (the expanded reading), for example `"dipl": "dñs"`.
- A `checked` flag on items and syllables: what a person confirmed, as against what is only proposed.
- A record of corrections: each one is a labelled training example (this region shows this neume, or these letters,
  not those). The editing layer is also how training data is gathered for step 4.

**Decisions still open (the user's)**

- The chant font for drawing neumes: Gregorio's fonts (check their licences before adding one to the repo) or exsurge's
  glyph shapes.
- What a drag moves by default: a whole neume (suggested) or single notes.
- What "accept" means: every item checked one by one, or accepting a staff confirms all on it.

## Plan

0. **Set-up** (done, see below):
   - repo skeleton and GitHub Pages;
   - pdf.js page viewer (PDFs and page images);
   - the internal format, its GABC export and import, and tests.
1. **The editing layer, no AI yet** (see "The editing layer"):
   - fitting staff lines by hand, and drawing a chant from GABC onto them over the scan: the base everything else
     needs, so first;
   - then dragging and editing neumes, then the text layer (both readings), undo and redo;
   - the format's additions (note positions, the as-written reading, `checked`, corrections);
   - pitch from the clef, the custos check, the other rule-based alerts;
   - GABC export (done in step 0), exsurge preview, MEI-Neumes and Volpiano export;
   - saving and opening a project.
   - Test on one chant: place its GABC from GregoBase over a scan of the 1908 *Graduale Romanum* and correct it to the
     page.
2. **Layout:** find staves and text lines automatically (classical image processing first, a pixel classifier if
   needed); split a book into chants by their initials and titles, with the user confirming.
3. **Training data:** the GregoBase download and synthetic rendering pipeline (in `training/`, Python), and aligning
   scans of the Vatican books with GregoBase.
4. **The recognizer:** train it, run it in the browser, and feed its confidence scores into the alerts. Corrections made
   in the editing layer feed later training.
5. **Text:** recognition (OCR for print; Kraken with a CATMuS Medieval model for manuscripts), finding the chant's known
   text in CANTUS or GregoBase, aligning the two, and taking expansions from it; guesses flagged.
6. **Mensural:** a five-line symbol set, the mensural rules, sorting partbooks into voices and pieces, scoring up and
   MusicXML export (Elam Rotem's request). Proof of concept: one printer's partbooks, such as a complete Gardano set.
7. **Later:** manuscripts (the notation; their text comes in step 5), other printers, shared corrections.

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
- The editing layer's open decisions (above): the chant font, what a drag moves, what "accept" means.
- Step 0 is on the branch `step-0-setup`, not yet merged into `main`.
- GitHub Pages must be switched on by the user once it is on `main`: Settings → Pages → Deploy from a branch → `main`,
  folder `/ (root)`.

## Working with the user

- The user is Ted Hamacher, a musicologist fluent in mensural notation, chant and Renaissance sources. They work on
  Windows (PowerShell and Git Bash).
- **Commits:** no git identity is configured, so commit with
  `git -c user.name="Ted Hamacher" -c user.email="60490684+tghamacher@users.noreply.github.com" commit ...`.
- **"Stage, commit, and sync"** means commit, then `git pull --rebase`, then push.
  - In Serenissima Press, each such commit also gets a version bump, release notes and a tag, unless the user calls it a
    silent update. Not yet decided for this repo.
- The user prefers user-facing text that is plain, instructive and sounds human, not stilted.
