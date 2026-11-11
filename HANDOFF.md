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

**Decisions** (all settled now): the font is greciliae; a drag moves a whole neume, Shift-drag one note; accepting
is the middle way: per staff for speed, but doubtful neumes must be checked one by one first, editing a neume counts
as checking it, and the app records how each was confirmed (alone, edited, or with its staff).

## Plan

0. **Set-up** (done, see below):
   - repo skeleton and GitHub Pages;
   - pdf.js page viewer (PDFs and page images);
   - the internal format, its GABC export and import, and tests.
1. **The editing layer, no AI yet** (done, see Done; see "The editing layer"):
   - fitting staff lines by hand (done), and drawing a chant from GABC onto them over the scan: the base everything
     else needs, so first;
   - then dragging and editing neumes, then the text layer (both readings), undo and redo;
   - the format's additions (note positions, the as-written reading, `checked`, corrections);
   - pitch from the clef, the custos check, the other rule-based alerts;
   - GABC export (done in step 0), exsurge preview, MEI-Neumes and Volpiano export;
   - saving and opening a project.
   - Test on one chant: place its GABC from GregoBase over a scan of the 1908 *Graduale Romanum* and correct it to the
     page.
2. **Layout** (done): find staves automatically; split a book into chants at their set-in first staves, with the
   user confirming; spread GregoBase GABC over a chant's staves.
3. **Training data** (begun): the GregoBase corpus and synthetic pages (`training/`), and aligning scans of the
   Vatican and Solesmes books with GregoBase.
4. **The recognizer:** train it, run it in the browser, and feed its confidence scores into the alerts. Corrections made
   in the editing layer feed later training.
5. **Text:** recognition (OCR for print; Kraken with a CATMuS Medieval model for manuscripts), finding the chant's known
   text in CANTUS or GregoBase, aligning the two, and taking expansions from it; guesses flagged.
6. **Mensural:** a five-line symbol set, the mensural rules, sorting partbooks into voices and pieces, scoring up and
   MusicXML export (Elam Rotem's request). Proof of concept: one printer's partbooks, such as a complete Gardano set.
7. **Later:** manuscripts (the notation; their text comes in step 5), other printers, shared corrections.

## Done

- **0.27.1, Utrecht, Ms. 406 in the manuscript model**: `models/chant-ms.*` is job 0071 (Utrecht round 2, from 0069 via 0070). Utrecht 406 (Cantus 123641, 495 folios from the library's IIIF; staves of four ink lines, words between, found by `rulestaves.py --dark`: rows of words by their period, four evenly spaced lines fitted over each), paired by each round's reading: 750, 1356, 2107 staves. Round 1 (0070): Utrecht 47.5 → 43.2% of notes wrong; round 2 (0071): 40.2 → 34.8, the Mexican choirbook 8.3 → 6.9, Paris 19.2 → 18.7, the others within 0.2. Round 3 (0073, labels-boot3) made Utrecht 37.0 → 35.3 but the choirbook 6.9 → 9.3 and the 1908 Graduale 7.3 → 7.6: not installed. (0072 failed at once: a blanket replace renamed Paris's labels; change labels per directory.)
- **0.27.0, mensural notation read (the reader's plumbing)**: Read the notes on a mensural staff runs `models/mensural.onnx` (`CGRecognizer.readMensural`: the staff straightened as fivestaves.py cuts it, top line at row 14; tokens CGMensural's text form, a ligature's `[` `]` `]*` `~` apart, gathered back into items by `mensuralItems`, each placed where it was read, with how sure). Its items replace the staff's; doubtful ones (under 0.8) drawn orange; any change (keys, menu, drag) takes an item as right. `recognizer.py train` learns it from `mensuralsynth.py`'s labels (`tokens`); `export --mensural` marks its meta (five lines, top5 14, notation mensural). The model itself: job 0074 (synthetic staves), not yet installed.
- **0.26.0, voices played together**: a mensural staff's `voice` (staff menu: Cantus, Altus, Tenor, Bassus, Other…, None; named above the staff). With voices named, ▶ plays every voice together (`CGMensural.voices` groups the document's staves by voice in order; `together` times each note, `at` in minims), from the selected note's moment in its voice, each voice's sounding note marked; the status says each voice's length in semibreves and which run short. A voice alone from the menus. `CGPlay.play` schedules events with `at` at their times (quieter, so voices sum). MEI: a part for each voice. Next: synthetic mensural staves, then the recognizer.
- **0.25.0, mensural playback**: ▶ on a mensural staff (or from a selected item, or the page when all its staves are mensural) plays the page's mensural staves in order, one voice, a beat to the minim, each item marked as it sounds. `CGMensural.perform` reads the rhythm: the sign's tempus (O, C) and prolation (dot), a stroke halving, proportions (3, 3/2); in a perfect mensuration a breve (or with the dot a semibreve) followed by one note of the next value is imperfect, of two the second is altered, a dot just after it is of perfection; elsewhere a dot adds half; black notes lose a third; modus imperfect; a flat or sharp just after a clef is a signature, else for the next note at its place. A first reading, not every rule (no modus perfectus, no imperfection a parte ante, no rests counted in perfections). Next: voices played together (parts), then the recognizer.
- **0.24.0, mensural notation edited on the page**: Serenissima's signs now drawn (EMS_Serenissima is a typesetting font, each character a sign on its own bit of staff: `training/serenissima.py` takes one of each, removes the staff lines, traces it into `js/serenissima.js`, outlines anchored on their staff positions; `fonts/Serenissima.otf`). Mensural items selected by a click, dragged along and up and down (a ligature's note under the pointer, Shift all of it), changed by keys (arrows, Tab, 1-8 values, K black, S stem, R rest, . dot, J ligature, O oblique, Del) and from a right-click menu (values in a row; sign, clef, accidental and bar kinds; cut a ligature); right-clicking a mensural staff adds an item where clicked. The side panel names what is selected, with its pitch. Text form: clefs in lower case (c4 f3 g2) so F is the fusa; M5v / L2^ turn a stem. Still to come: playback, the recognizer.
- **0.23.0, mensural notation's model and drawing**: `js/mensural.js` (CGMensural). A mensural staff holds `mensural`, a list of items (clef, sign, proportion, note, rest, ligature, dot, accidental, custos, bar; values Mx–Sf, positions in steps from the bottom line, coloration), with a text form (`c4 O B5 [B5 L2] [B5~B3]* rB4 .5 |`), pitches from the clef, checks (the white-notation ligature rules: propriety, perfection, c.o.p., which last notes must be oblique or square), drawing, and MEI (mensural.white, a zone for each staff). Single signs are Serenissima's (SMuFL codepoints; `fonts/Serenissima.otf` or `.ttf`, with Elam Rotem's permission; not in the repo yet), ligatures, mensuration signs, dots and bars are drawn as shapes, stems by the rules. The Mensural card: type a staff in, Put on staff; MEI of the document's mensural staves. Still to come: editing items on the page, playback, the recognizer.
- **0.22.0, chant or mensural**: a Notation picker in the toolbar (Chant, Mensural) sets the document's `notation`; a staff of the other kind is marked from its right-click menu (`notation` on the staff). Mensural staves are found with five lines, drawn dashed in purple, and the chant tools (GABC, the recognizer) leave them alone until mensural reading and MEI export come. `docs/format.md` documents the field; `CGChant.check` checks it.
- **0.21.1, the choirbook's third round**: `models/chant-ms.*` is job 0069 (from 0067, 384 of the Mexican choirbook's staves paired by 0067's reading): choirbook held-out 13.8 → 11.4% of notes wrong; Paris 20.4 → 20.2, Köln 14.0 → 13.7, 123606 12.6 → 12.4; Fribourg, Salzinnes, lat. 15181 within 0.1. The choirbook rounds stop here: pairing covers about 470 of its 946 staves (the rest have no melody in Cantus or are mis-cut). (Job 0068, the same round, failed at once: its label list renamed Paris's file too.)
- **0.21.0, five-line staves (16th-18th-century choirbooks)** (the user: "train on 17th/18th century sources too … cover all our bases"): the app now takes staves of five lines. A page's menu has **Five-line staves**, a choice for the book (`doc.fiveLines`): staves are found by `CGStaves.byFiveLines` on `redness()` (red less green and blue: red ruling, not a leather binding); a staff drawn by hand gets five lines; everything that took the fourth line for the bottom takes the last (spacing, tilt, even spacing, pitch heights: five lines d to l, pitches a to n and p, as GABC has them without o; the editor's drag, MEI zones); the recognizer cuts a five-line staff with its top line at row 14 and its words a space lower; GABC is saved with `staff-lines: 5;`. `models/chant-ms.*` is job 0067, which reads five-line staves: trained from 0053 on 15,000 made-up five-line staves (`training/latechant.py --five 1`: choirbooks and Medicaean prints) and then the Mexican choirbook (Stanford, Codex 0734; Cantus 1000019, 96 melodies, line breaks but no page turns marked): its pages filed by folio from the numbers written on them (Stanford labels them Page_1 …), its staves cut by `training/fivestaves.py`, paired with Cantus through the whole book by `training/seqpair.py`, two rounds (332, then 373 staves). Choirbook held-out: 20.8% of notes wrong (0065, synthetic only) → 19.7 (0066) → 13.8 (0067). The others against 0053: Paris 23.1 → 20.4, Köln 14.06 → 14.03, Fribourg 7.61 → 7.51, Salzinnes 3.73 → 3.91, 123606 12.32 → 12.55, lat. 15181 13.05 → 13.31.
- **0.20.3, a printed-book recognizer trained on the books** (the user: "I want this as accurate as possible"): `models/chant.*` (printed books) was still the first model of 10-26 (`model2`: synthetic staves and the 1908 Graduale); it is now job 0058: from 0053 (the manuscript model, which had seen the books), on the synthetic printed staves, the 1908 Graduale ×2 and the Graduale 1961, Liber usualis 1949, Antiphonale monasticum, Liber antiphonarius and Antiphonale Romanum, their staves checked by their words (`labels-plain-text.jsonl`). Notes wrong on held-out pages (model2 → 0058): Graduale 1961 12.8 → 5.0%, Liber usualis 14.2 → 6.1, Liber antiphonarius 15.8 → 6.9, Antiphonale monasticum 15.7 → 12.0, Antiphonale Romanum 3.0 → 3.0; the 1908 Graduale 2.36 → 2.69. Also tried, not installed: job 0060 (0058 + 20,000 made-up 17th/18th-century staves, `training/latechant.py`: Medicaean prints, choirbooks) cost the books 0.5–0.8 points with nothing yet to measure the gain on; job 0059 (the text reader with lat. 15181's lines weighted more) made lat. 15181 worse (3.16 → 3.37 on lines either reads within 15%) though the other manuscripts better.
- **0.20.2, Gothic manuscript hands from CATMuS** (the user: "keep training on gothic text … use other transcribed sources besides those in CantusDB"; chose 0057 on 11-05): `models/text.*` is job 0057: from 0047, with 4,589 Latin lines in Gothic book hands (Textualis, Semitextualis, Praegothica, Hybrida) from 46 manuscripts of [CATMuS Medieval](https://huggingface.co/datasets/CATMuS/medieval) (Thibault Clérice et al., CC BY 4.0). `training/catmus.py` fetches each file, cuts its lines as the app's text strips (letters' body 20 rows, on row 31, 0.56 as wide) and writes their abbreviations out (fixed signs; a stroke over a vowel as m or n; a table of the usual; else the commonest word of the chant texts and the Nidaros Breviary that has the letters in order; a line left out if a word can't be told: 7,117 of 17,864 kept, 4,589 well scaled); `training/spread.py` widens the gaps between words as under chant (close-set lines, job 0055, taught the reader to drop chant's wide spaces). On lines either reads within 15% (0047 → 0057): Köln 7.65 → 7.13, 123606 4.13 → 3.86, 123672 5.42 → 5.22, 123723 2.95 → 2.77, the Graduale 3.39 → 3.09, Liber antiphonarius 3.81 → 3.69, Antiphonale monasticum 7.13 → 7.02, Nidaros 2.50 → 2.46; lat. 15181 3.06 → 3.22 (about 11 characters in 7,000: a short round on lat. 15181's own lines might win it back). Also: `worker.py` takes a job's `remove` list (folders straight under training/data, deleted, their zips forgotten), to keep the training computer's disk to what is needed.
- **0.20.1, ready for testers** (the user: "good enough to start sending to people"): a GitHub link in the toolbar, and
  in help a "report it on GitHub" link (issues); help no longer says text reading is for printed books only. README
  opens with what a tester needs: the site's address, five steps to try it, what it reads best and what not yet, and
  how to report a problem; the feature list follows, brought up to date; credits add ONNX Runtime, Cantus Database,
  GregoBase and CATMuS Medieval.
- **0.20.0, Paris lat. 12044 (points on an evenly ruled page)** (the user: "do it all"): `models/chant-ms.*` is job 0053, which reads the French point notation of Paris, BnF lat. 12044 (Cantus 123628) as well as the other manuscripts: Paris held out ~23% of notes wrong (0045 couldn't read it); the others level with or a little better than 0045 (123672 7.61, 123723 3.73, 123606 12.32, 123631 13.05, Köln 14.06; real 2.87, Graduale 7.19, book-48 14.61). Such a book is ruled evenly all down the page in pale red-brown, words and notes alike, each row of words on every fifth line: no staff lines to find in its ink. A page's menu now has **Ruled evenly, words on every fifth line**, a choice for the book (`doc.ruledEvenly`): its staves are then found by `CGStaves.byRuling` (on `tint()`, red less blue), the four ruled lines between each row of words and the one above at fifths, each moved onto the ruling (the ruling is spaced by hand, 31–39 px a space on one staff: an even grid drifted half a space). It is not guessed: no measure of a page told such a book from one ruled a staff at a time reliably, and turned on for other books it finds false staves. How it was trained: `training/hufnagel.py --style points` (20,000 + 20,000 made-up staves: small faint points and ticks), then `training/rulestaves.py` cut Paris's 6,622 staves, paired with Cantus in order on complete pages where staves = lines and by `cantus.py labels`, kept where the two agree (97%) or fit well (labels-boot.jsonl, 4,213 staves; zips ms-123628s-*), rounds 0051–0053. A further round (job 0054, 5,001 Paris staves paired by 0053) gained only 1.25 points on Paris (24.2 → 22.95 on its held-out) and cost 0.3–0.5 elsewhere (Köln, 123723, Graduale): not installed, and Paris rounds stopped there.
- **0.19.1, manuscript hands, second round**: `models/text.*` is job 0047: from 0046, on the words under all paired staves of the five manuscripts (15,596 lines, the 13,985 that 0046 reads within 30% kept: wrong pairings and strips cut short dropped). Held out (0046 → 0047, on the kept lines): lat. 15181 4.4 → 4.2%, 123606 6.9 → 6.2, 123672 7.5 → 6.9, 123723 4.6 → 4.6, Köln 12.1 → 8.9; Nidaros 2.6 → 2.5. The books' usual test (text-ok-clean) reads 0.5–1 point worse, but that test favours the 0029 line of models; on the lines any of 0037/0046/0047 reads within 15% (sym.py) 0047 is level: Graduale 3.45 → 3.66, Liber antiphonarius 4.23 → 3.85, Antiphonale monasticum 8.05 → 7.04.
- **0.19.0, German Gothic notes** (the user: "do it all"): `models/chant-ms.*` is job 0045, which reads Hufnagel notation (Köln Cod. 1161) as well as the square-note manuscripts: well-cut Köln staves ~15% of notes wrong held out (0026 couldn't read them); the other manuscripts within ~0.6 point of 0026 (slightly worse: 123672 7.70 vs 7.44, 123723 3.71 vs 3.58, 123606 12.43 vs 12.03, 123631 13.26 vs 12.70; the printed Liber/books level). With 0.18.4's `byRedLine` a Köln-type page can now be found and read in the app (staves to check by hand). Its tokens add the f1 and f2 clefs (`recognizer.py train --grow-vocab`; the app already took any c/f clef on lines 1–5).
- **0.18.5, manuscript hands** (the user: "confidently recognize gothic script like in Latin 15181"): `models/text.*` is job 0046, trained on the words under five manuscripts' staves as well as the books and Nidaros. `training/mstext.py`: for each staff paired with its line of a chant (the note labels), the text band cut as the app cuts it, labelled with Cantus's manuscript text (`fulltext_ms`) split at the melody's line breaks (the melody's words and syllables matched to the text's; a word broken by a line split by Latin syllables; a hymn's first verse; pages where the lines count otherwise than cantus.lines left out): 13,457 lines (lat. 15181 2,855; 123606 3,633; 123672 2,609; 123723 3,456; Köln 904). Held out, characters wrong (0037 → 0046): lat. 15181 67 → 9.6%, 123606 56 → 7.7%, 123672 41 → 7.4%, 123723 28 → 4.7%, Köln 55 → 17.3%; the books 6.7/6.7/9.4/12.1 → 6.5/6.6/9.5/11.7; Nidaros 2.1 → 2.6. Cantus normalises spelling (verus for the scribe's uerus): the reader writes it so. `readText` keeps letters and spaces only (the reader also knows a hyphen, a dagger, abbreviation signs).
- **0.18.4, staves ruled by their F line** (asked for by the user: Köln, Dombibliothek, Cod. 1161, a Cistercian antiphoner in German Gothic notes, Cantus 601861): such books ink only the F line, in red, and one other; the other two are scored and barely show, so neither the grey finder nor the red-ink one found their staves (0–4 on a page of 13). `CGStaves.byRedLine` (tried when a page has red ink and finds more than the others): long thin runs of red traced across the page, the spacing from the inked line nearest each, the staff's lowest line the last at whole spaces from the red one above the words written under it; staves with next to no ink between their lines dropped. Köln: 13–14 a page (Cantus has 13); a first guess (a staff or two a page off or missed, one at a dark page edge), to be corrected by hand. Pages of the five other manuscripts: the same staves as before. Training (not in the app yet): `training/redstaves.py` (the same in Python, the clef f<n> from the red line's place, and `--labels`: staves paired with Cantus's lines in order where a page's counts agree), `training/hufnagel.py` (30,000 made-up staves of German Gothic notes), `recognizer.py train --grow-vocab` (the model had no f1/f2 clef tokens: such staves were silently left out), and rounds of pairing Köln's staves with Cantus by what the last model reads (jobs 0039–0045; 1,717 staves): j0045 reads well-cut Köln staves at ~15% of notes wrong, the in-order test at 49% (mis-cut staves), the other manuscripts within ~0.6 point of 0026; not installed as models/chant-ms (the user chose this step first).
- **0.18.3, Gothic type** (the user offered Sperber's edition of the Nidaros Breviary, Paris 1519): `models/text.*` is now job 0037, which reads Gothic print and its abbreviations as well as the books. How: `training/lines.py` cuts the Breviary's lines (National Library of Norway scans) as text strips and spreads each leaf's edition text over them by width; trained on that alone (job 0032) the reader learnt nothing, the edition spelling out the print's abbreviations so the text drifts lines away. `training/gothic.py` makes up Gothic lines (the edition's text in five open blackletter fonts, with macrons, dñs, &, q;, long s, r rotunda, hyphens, neighbouring lines, paper and ink varied): job 0033 learnt the type from them; `training/realign.py` lines up each leaf's text with what that reader reads on all its lines, letter by letter, and gives each line its own (a line still read far off left out): 32,592 lines kept, then 46,374 with the next reader (jobs 0034, 0035). Jobs 0036–0037 eased back to the printed books (all five sets, as 0029 had them: 0032–0036 left text-3a and text-7 out). Held out, Nidaros: 2.1% of characters wrong (0029 can't read it). The books: on the held-out lines any of 0029, 0036, 0037 reads within 15% (the labels right), 0037 3.4 / 3.6 / 7.6% (Graduale, Liber antiphonarius, Antiphonale monasticum) against 0029's 3.8 / 5.0 / 8.7. The usual book test (text-ok-clean: lines 0029's predecessor read well) favours 0029 (5.2 against 0037's 6.7 on the Graduale): its selection is biased toward that line of models, so don't trust it alone to compare a new reader.
- **0.18.2, custodes left alone** (agreed with the user: GABC and Volpiano leave them out, Gregorio sets its own): still read (else taken for notes) and still checked against the next line's first note (checks.js), but drawn faintly, never doubtful, not counted in a staff's progress, passed over by Tab; MEI keeps them (facsimile, Neon).
- **0.18.0, Read text** (the user asked to start text recognition): `models/text.*`, job 0027: the note reader's network trained on the words under the staves (align.js cuts them: `CGRecognizer.textBand`, 64 rows 3.3-6.3 staff spaces below the top line, 12 px a space across; GregoBase's text, the initial left out), 4,514 lines of the Graduale 1961 and the Liber usualis, cleaned (lines it reads >50% off: the chant on the wrong staff) and trained again: 4.1% / 5.2% of characters wrong on held-out pages. The app: Read text (rail, staff and page menus) reads a staff's band (`readText`: letters with x), breaks the words into syllables as the Solesmes books do (`CGChant.syllables`: 97.7% as GregoBase has them in the Graduale and the Liber usualis, 91% in the monastic books, which break sanc-tus, om-nes), puts each syllable on the neume nearest its vowel (the reader places letters about a staff space left of their notes; DP, two syllables on one neume dear), and neumes left without words into the syllable before (melismas). Only staves with notes and no words yet. Job 0029 (installed): 16,000 lines from four books (the Graduale 1961, the Liber usualis, the Liber antiphonarius, the Antiphonale monasticum so far), from 0027, cleaned and trained again; held out: 5.2% / 6.1% / 5.0% / 8.2% / 11.7% (Graduale, Liber usualis, its first pages, Liber antiphonarius, Antiphonale monasticum) against 0027's 5.4 / 5.9 / 5.9 / 8.9 / 12.4. Cleaning dropped a third of the Liber antiphonarius's lines and nearly half the Antiphonale monasticum's: looked at: the reader reads those lines right and the labels are another chant's (align.js puts the wrong chant on a third of the Liber antiphonarius's staves; the custos check doesn't catch it). So the text reader can check the note labels: keep a staff for the note model only where the words read under it match GregoBase's (a filter much stronger than the custos one) — next note job. Not yet: the initial (outside the band), manuscripts (Nidaros Breviary next: see the hourly round), words running past the staff's end are cut (widen TEXT.right).
- **0.17.0, playback** (asked for by the user, to check by ear, accidentals above all): ▶/❚❚, ■ and a tempo slider in the toolbar, Space, and Play from here / this staff / the page in the menus; the neume sounding marked orange. `CGChant.perform` (a flat, natural or sharp holds for its place to the word's end or the next bar; a clef's flat flattens its staff's Bs; mora ×2, episema ×1.4, liquescent ×0.7; bars rest) and `js/playback.js` (Web Audio, a soft organ-like voice; nothing loaded). The clef's line is read as middle C, as `pitch` does.
- **0.16.2, text under neumes** (asked for by the user): right-click a neume, Text under this neume (T): its syllable's text field ready (a new syllable from that neume if it isn't its syllable's first); Part of the syllable before puts a textless neume's syllable into the one before (a melisma). Notes read with no chant are a syllable each, so this is how words go under them.
- **0.16.1, anything retyped** (asked for by the user: an F3 read as C3 couldn't be changed): a selected neume or clef's GABC typed in the panel (G; `CGEditor.setItem`, several groups becoming several items, anything that isn't GABC refused); right-click a clef for C1–C4, F1–F4 and its flat. A clef changed leaves the notes where they are on the staff (GABC's letters are places).
- **0.16.0, GABC out** (asked for by the user): a file per chant (several in a zip): the chants placed, and from notes read with no chant placed, a chant from each beginning marked (B, or part way along a staff, its clef carried over) to the next, across pages (`CGEditor.gabcFiles`). One continuous line each: the page's line breaks aren't written (the user: they "should not matter"; the renderer breaks lines at its own margins), and a clef only where it changes. A "with words" box leaves the text out. `toGabc`'s `lines` option is still there for code.
- **0.15.1, notes and neumes** (asked for by the user): right-click a note in a neume to set its shape (the note found by where it's drawn, then by pitch within a ligature; Shift-drag the same), or split the neume before it (`CGChant.splitAt`, an accidental going with its note); J or the menu joins a neume to the next in its syllable.
- **0.15.0, the layout** (asked for by the user: "too text-heavy and scholarly looking"; they chose a toolbar and an
  inspector for large-scale work, and want a step-by-step wizard kept in reserve for someone with a page or two):
  a toolbar (open, online, pages, zoom, undo, save, help), a rail of the big actions (find staves, read, accept), the
  page in the middle, an inspector on the right showing only what applies to the selection, with Chant, Checks and
  Export folded; the instructions moved into a help dialog (?). Right-click menus on neumes (shape: punctum, virga,
  inclinatum, quilisma, oriscus, via `CGChant.reshape`; climacus as diamonds; accept, delete), syllables, staves
  (read, accept, a chant begins here, find lines, space evenly, straighten, delete) and the page. Mid-line chant
  beginnings (asked for by the user): right-click a staff, "A chant begins here, at this point": `staff.beginsAt`,
  the chant beginning there `startsAt`; the staff is shared, its syllables split at the point (`CGChant.owns`) for
  the GABC, Volpiano and the checks; a chant placed above stops at the point, one placed on the staff starts from it.

- **Step 6, manuscripts** (branch `step-6-manuscripts`): IIIF manuscripts in the app (open a manifest, save its pages),
  two-column pages, staves ruled in red found in the red ink alone (hand-ruled, unevenly spaced, notes on a line
  bridged), Paris BnF lat. 15181 from Gallica paired line by line with the Cantus Database's melodies (source 123631;
  `training/cantus.py`), and training on the user's GPU by jobs (`training/worker.py`, the `jobs` branch).
  - `models/chant-ms.*`: the manuscript model (job 0026), chosen beside the Read buttons (automatic: on pages ruled
    in red). Synthetic manuscript-style staves, then two rounds on lat. 15181's own staves (3,524 paired, line breaks
    mended; a third round gained nothing), then more manuscripts, each paired line by line with Cantus's melodies:
    Einsiedeln 611 (14th century, Gothic neumes on black lines; e-codices, all of it, 4,994 staves) and the
    Salzinnes Antiphonal (1554-5, square notation on red; Leuven via the user's browser, both volumes, 3,814 staves).
    Notes wrong on held-out folios: Salzinnes 3.2%, Einsiedeln 7.6% (more of it held out now), lat. 15181 8.6%, the Graduale 2.7%
    (`models/chant.*` stays the printed books' model: 2.26%). Cantus's Volpiano records pitches only, so the labels made from it
    had no virgae or inclinata and the model learnt to read none (5 virgae in 15,000 notes); `training/shapes.py` puts
    them back (virgae read by a model that never learnt from those labels, or a hairline stem under the head;
    inclinata in every climacus, as the Graduale writes all 499 of its). Job 0022, trained on them, reads them (e.g.
    Einsiedeln's held-out folios: 894 virgae read of 892 marked, against 1 before) with its pitches as good as before
    (pitch errors 2.9% Salzinnes, 5.5% Einsiedeln, 5.3% lat. 15181, 2.6% the Graduale). Job 0024 added printed books aligned with GregoBase
    by `training/books.py` (scans from the Internet Archive): the Antiphonale Monasticum (1934), the Liber
    antiphonarius (1960) and the Antiphonale Romanum (1912), their labels without the Solesmes ictus and episema
    (`training/plain.py`) and cleaned (3,540 staves of 6,413 kept: align.js sometimes puts a melody on the staff next to
    it). The manuscripts as before; the Graduale 2.7% (3.0%), the books' held-out pages 14% (18-19%). Job 0026 added the Fribourg Cordeliers antiphoner (Cantus 123672, 3,651 staves with shapes) and the Graduale Romanum 1961 (GregoBase source 2, 5,640 staves, plain and cleaned on the PC). Against job 0024 on held-out pages (notes wrong): Fribourg 7.4% (11.0%), Salzinnes 3.6% (3.8%), Einsiedeln 12.0% (12.7%), lat. 15181 12.7% (13.0%), Graduale 1961 7.2% (10.1%), Liber antiphonarius 14.6% (14.8%); the 1908 Graduale 2.9% (2.7%). GregoBase has only 39-59 chants for the Graduale Cisterciense, Hymnarium Cisterciense and Liber responsorialis: set aside. The Liber usualis 1949 (2,748 chants) is aligned with an offset per 25 pages (`books.py local`: its index has pages put in, 262.8). Job 0028 added the Liber usualis 1949 (5,798 staves, 4,982 kept by cleaning) and the whole Graduale 1961: better on the printed books (Liber usualis 7.6% against 8.2%, Graduale 1961 7.3% against 7.5%) but a little worse on every manuscript (Fribourg 7.6% / 7.4%, Salzinnes 3.9% / 3.6%, Einsiedeln 12.6% / 12.0%, lat. 15181 13.4% / 12.7%): not installed; job 0026 stays. More printed books now dilute the manuscripts: next, more manuscript staves, or the printed sets weighted less. Job 0030 trained on the printed books' staves checked by their words (textcheck.py; a third to a half of the antiphoners' staves had another chant's melody) with the manuscripts counted twice: no better on the manuscripts (lat. 15181 13.1% / 12.7%, Einsiedeln 12.3% / 12.0%, Salzinnes 3.6% / 3.6%, Fribourg 7.4% / 7.4%): not installed. Measured on checked labels, 0026 reads the Liber antiphonarius at 8.0% (not the 14.6% the unchecked labels said) and the Liber usualis at 8.0%. The manuscript model has had what these sources can give it: next, more manuscript staves (Cantus sources this machine can fetch), or a wider model. Next: Karlsruhe Aug. LX (BLB, fetched here).

- **Step 4, the recognizer** (branch `step-4-recognizer`, merged into `main` with the model: the user is happy to
  publish it, GregoBase's transcriptions being there for anyone to use). See `training/README.md`.
  - The model in `models/`: trained on 14,442 synthetic staves, then with the Graduale's real staves (3 times over),
    then once more with only the real staves it agreed with (`labels-clean.jsonl`, 1,817 of 2,253), then 4 passes on
    the user's RX 6700 XT through DirectML (about 2 minutes a pass; 13 on the CPUs here). On 180 clean Graduale
    staves from pages it never learnt from: 7.1% of notes wrong (8.0% of tokens); synthetic: 5.4%. (Flattering: the
    model itself chose which labels count as clean.) More passes, and a model 1.5 times wider trained from scratch
    for 30 passes on the user's GPU (4.5% synthetic, 7.3% real), no longer helped: the real error was the labels'.
  - `recognizer.py rebreak`: the real labels' line breaks moved to where the model reads each neume (align.js put a
    neume or two on the wrong staff on about half the staves); then `clean` on those: `labels-rebroken-clean.jsonl`
    (1,868 staves). By them the same model reads 2.4% of the notes wrong on 190 held-out staves (was 7.1%).
  - Training on the user's PC: `training/README.md` section 5 (DirectML; the staves and checkpoint on the branch
    `training-data`; the user's clone is `D:\ChantGPT\changpt-repo`).
  - Training here is often cut short when the container restarts: run a pass at a time (`--epochs 1 --resume`).
  - The container: 4 CPUs, 15 GB, no GPU; PyTorch 2.14 (CPU) in `/home/user/venv`. Training here is slow (a pass
    over 14,000 staves about 50 minutes), enough to prove the pipeline; the real training is for the user's RX 6700 XT
    (ROCm).
  - Synthetic pages now also have heavier notes (outlined glyphs) and black-and-white scans (solid black lines).
  - `training/staffdata.py`: each staff straightened along its lines to 64 rows, 8 pixels to a space (top line at row
    20); its tokens: notes (letter, shape, liquescence), accidentals, mora, episema, ictus, clefs, bars, custos, `/`
    between glyphs and `|` between neumes. A custos, bar or clef written against other signs (`f+::c4`, as GregoBase
    has it) is split off, here and in `js/chant.js`.
  - `training/recognizer.py`: a CNN (about 800,000 weights; rows folded away, then dilated 1-D convolutions along the
    staff), CTC, augmentation; ONNX export (opset 17, dynamic width) with `chant.json` (tokens and the straightening's
    constants). ONNX Runtime agrees with PyTorch to 1e-7.
  - `training/align.js`: the Graduale aligned with GregoBase in the app, page by page; the staves of chants whose every
    custos agrees with the next line kept (about 57%), straightened, with their GABC: real staves with answers, not
    checked by hand.
  - `js/recognizer.js`: straightening (agrees with Python within one grey level), greedy CTC decoding, tokens into
    neumes (each with its place along the staff and its least sure token's probability), loading ONNX Runtime Web
    (`vendor/onnxruntime`, 1.27.0, the WebAssembly build only) and `models/chant.onnx` when first wanted.
  - The editor: "Read the notes" (selected staff) and "… on the whole page". On an empty staff what was read is put on
    it, a neume to a syllable. On a staff with chant, the reading is lined up with it (global alignment of neumes by
    their notes): each neume moved to where it was seen; where they differ the neume gets `conf` under 0.8 (orange)
    and `read`, what was read (`""`: nothing seen). The side panel says what the recognizer read.
- **Step 3, line breaks read from the page** (version 0.12.0, branch `step-3-breaks`):
  - `carries()` in `js/staves.js`: what a staff carries, from the ink along it: `mass` (its notes' ink beyond the
    lines', each column less a bare column's, the clef left out, in squared spaces), `words` (the ink in the band of
    its words, 1 to 2.9 spaces below the bottom line) and `custos` (a narrow last run of ink, set apart from the rest
    by a tenth of a space or more, with most of its ink in a head half a space high, so not a bar: its staff
    position). On 30 synthetic pages: 167 of 201 custos read right, 6 found where there were none (last staves).
  - `breaks()` in `js/neumes.js`: the chant's syllables weighed (notes; a bar 0.6, a double bar 1.2, an accidental
    0.5, a clef change 1.5) and their letters counted; each staff's mass and words scaled to the chant's totals; the
    breaks (dynamic programming over syllables) that make each line's weight and letters nearest what its staff
    carries (errors weighted as 20% and 8% of the expected), a custos disagreeing with the next line's first note
    costing 8, no line begun by a bar. `spread()` takes the breaks it is given; `gather()` takes a chant back off its
    staves (custos off, repeated clefs at line starts off).
  - Measured against the true breaks of synthetic pages: 69–78% of breaks exact (mean error 0.4–0.5 syllables),
    where the proportional spread had 6–8% (2.8–3.1 syllables). On the 1908 Graduale, pages 2 and 3: every break as
    printed but one at the page turn (Gloria Patri began two syllables early).
  - The app: placing a chant without line breaks reads them from the page (placing is now async); "Read the line
    breaks from the page" does it again for the selected staff's chant. Tests: the search itself (Node), and a
    synthetic page (`test/pages/synth.jpg`, its answers `synth.json`) placed and its breaks checked.
- **Step 3, aligning a book with GregoBase** (version 0.11.0, branch `step-3-align`). The user chose the 1908
  *Graduale Romanum* to start.
  - The scan: archive.org `graduale-romanum-1908` (the CMAA's PDF, the scan GregoBase's index was made from): 948
    pages, 1-bit CCITT at 300 dpi. Scan page 25 is printed page 1; the offset holds to the end (100, 500 and 100*
    checked). Its first 24 pages are an article from *Sacred Music* and the preface. Downloads come from
    `*.archive.org`; both it and `archive.org` are allowed.
  - `training/gregobase.py book --source N`: a book's index (`format: chantgpt-book`): its pages as numbered, the
    chants on each in order with `sequence`, `extent` (pages it runs over) and GABC. GregoBase sends no CORS headers,
    so the app takes the index as a file.
  - The app: the index opens like a document (by its `format`). Chant panel, "From the book's index": say which page
    of the book the shown page is (`doc.book.first`); the page's chants are listed (click one: placed on the selected
    staff); "Place this page's chants": finds the staves on the page (and on the pages its chants run onto), marks
    where chants begin where nothing is marked (the first staff begins one unless a chant runs on from the page before,
    by the index; the others where set in), places the chants in order at those staves, one undo for all.
  - `put()` / `staves()` in editor.js: placing split from its undo. A chant with no chant marked after it now goes
    down to the end of its page (or as many pages as the index says it runs over): it used to take one staff only.
  - `neumes.js` draws the words without GABC markup (`<i>`, `<sp>V/</sp>` as ℣, braces).
  - Tried on the Graduale's pages 1–4: staves found, the chants at the right set-in staves, *Ad te levavi* and the
    Alleluia *Ostende* over the page turn. The index lists *Sanctissimus namque Gregorius* on page 1 too (it is in
    the engraving at the head of the page, not on a staff): a count mismatch is reported, not guessed at.
  - The line breaks come from the proportional spread and drift from the print by a few syllables; `[` and `]` fix
    them. Better would be to read the breaks from the scan (the custos, the ink along each staff): for step 4.
  - Test: `test/pages/book.book.json`, an index for the test book; a browser test of the page-by-page flow.
- **Step 3, the corpus and synthetic pages** (version 0.10.0, branch `step-3-data`). See `training/README.md`.
  - The network: gregobase.selapa.net, cantusdatabase.org and archive.org are allowed from the session (the user
    allowed them, 2026-10-25). cantusindex.org and cantus.uwaterloo.ca are still blocked.
  - `training/gregobase.py`: GregoBase's GitHub repository (`gregorio-project/GregoBase`) keeps a dump of its
    database. `build` reads it (18,762 chants, January 2024). `update` fetches the chants added since from the site's
    per-chant GABC download, one a second (to id 20,974 on 2026-10-25). Each chant keeps its books and pages,
    which is what aligning real scans needs. The site has no bulk export.
  - `training/render.html` and `render.js`: synthetic Solesmes-like pages from the corpus, drawn by the app's own
    layout in greciliae, with their answers as a ChantGPT document plus a glyph list. The spacing is the book's:
    the wider of neumes and words, words further apart than syllables, the last line of a chant cut short.
    GregoBase's markup (`<sp>V/</sp>`, `<i>`, `<v>`, braces, brackets) is cleaned from the words. 200 pages: 2,110
    staves, 81,761 glyphs, 6 chants skipped. All 200 answer documents pass `CGChant.check`.
  - `js/neumes.js`: `layout()` now gives each glyph's pitch (`p`).
  - Next in step 3: aligning scans of the Vatican and Solesmes books with the corpus (page numbers); a second
    engraver for variety.
- **Step 1, first part: staves** (version 0.2.0, merged):
  - `js/editor.js`: the editing layer. Drag a box round a staff to add it; its lines are found in the ink, or spread
    evenly over the box if they can't be. Select a staff (click, or Tab) to move it (drag, or arrow keys), drag one
    line's end up or down (the dots), drag an end bar to lengthen, shorten or tilt it; F finds its lines again, E
    spaces them evenly, Delete removes it. Undo and redo (Ctrl+Z, Ctrl+Y) of everything, page by page. Holding H hides
    the layer.
  - `js/staves.js`: staff geometry, and `fit()`, which finds four lines in a region of the page: darkness against the
    paper summed along rows at each small tilt, the sharpest tilt kept; peaks that stand clear of the paper's noise;
    the four strongest evenly spaced; their ends where three of the four lines are drawn. Within about a pixel on
    `test/pages/engraved.jpg` (faint, blurred, tilted 0.7°, noisy).
  - `js/viewer.js`: `pixels(page)` gives a page in grey for this, at 300 dpi for a PDF.
  - Saving a document (`.chantgpt.json`) and opening it again with its scan (it must have the same pages).
  - `tools/make-test-scan.js`: makes the engraved test scan with exsurge; the truth is in `engraved-lines.json`.
  - Not yet: finding all the staves on a page at once (step 2 will start from `fitStaff()`), and the touch screen
    (dragging on the page doesn't scroll it).
- **Step 2, a book's chants** (version 0.9.0, merged). The user starts with Solesmes books.
  - Staves have `begins` (true: a chant begins on it; false: said by hand it doesn't; absent: not said).
    `beginnings()` in `js/staves.js`: a chant begins on a staff set in from its side's usual left margin (odd and
    even pages apart; the margin is the lower fifth of the starts) by two and a half spaces or more, as Solesmes sets
    the first staff of a chant for its initial; and on the book's first staff. "Find where chants begin" applies it
    where not said; B or the box toggles a staff. A mark (a flag) before the staff shows it.
  - Placing GABC without line breaks (as GregoBase gives it) on a staff spreads it over the staves down to the next
    `begins` (across pages): `spread()` in `js/neumes.js` breaks only between syllables, each line's share in
    proportion to its length (less room for the clef and custos it gets), a bar ending the line it follows; each
    line after the first begins with the clef in force, each but the last ends with a custos (`custosFor()`). GABC
    with (z) breaks still goes a line to a staff.
  - Moving a line break: with a syllable or neume selected, ] moves it (and what follows on its line) to the next
    line, [ (and what precedes) to the line before; only within its chant; both lines laid out afresh; custos kept
    pointing right.
  - Undo over several pages: a change touching more than the shown page records every page's staves (page null).
  - Staff finding: the "no strong line between" rule is now "nearly as strong" (80%): dense notes in a staff's
    spaces made a staff go missing at half.
  - Test book: `tools/make-test-book.js` (exsurge) makes `test/pages/book-1.jpg`, `book-2.jpg` (three chants, drop
    caps, set-in first staves, the Kyrie over the page turn) and `book.json` (lines, which staves begin chants, the
    GABC).
  - Not yet: titles and rubrics (Intr., Ant., the mode number over the initial) read as text; manuscripts' initials
    without a set-in staff.
- **Step 2, finding the staves** (version 0.8.0, merged):
  - `findStaves()` in `js/staves.js`: in a band across the page's middle (25–62% of its width), darkness summed
    along rows at the page's tilt; sharp peaks are lines; fours evenly spaced with no line between them at least
    half as strong are staves (that rule matters on evenly set pages, where the lines of different staves fall
    evenly too); the spacing most fours agree on is the staves', and the strongest fours near it are taken, none
    overlapping. Each is then fitted across the whole page with `fitStaff()` between its neighbours (ends, tilt,
    bends of its own). Staves already marked are skipped. About a third of a second a page.
  - "Find the staves on this page", and "… on every page" (from this one on, page by page, with Stop; one undo
    per page).
  - Tested: all five staves on the engraved and on the warped page (within 2 px, ends within a few), both pages of
    the PDF, a synthetic page of six with an indented first staff and lines of words.
  - Limits: a scan of an open book (two pages in one image) should be split first: a staff is fitted across the
    whole width and would join the two pages' staves. Staves shorter than the middle band (a short last line
    ending before the middle) can be missed: mark them by hand.
  - Next in step 2: splitting a book into chants (by initials, indented first staves, titles), with the user
    confirming.
- **Step 1, checks and exports** (version 0.7.0, merged). Step 1 is now complete.
  - `js/checks.js` (no AI): each staff begins with a clef; a custos agrees with the next note (across a line and a
    clef change); leaps of a seventh or more (not across a bar); flats and naturals only on B (or E); notes over no
    syllable; with `mode` in the GABC headers, the last note is the mode's final (or its usual transposition: A, B,
    C, D for modes 1–2, 3–4, 5–6, 7–8) and notes keep to its range (authentic: a step below the final to an octave
    above; plagal: a fourth below to a sixth above; a step's leeway). `warn` (likely wrong, purple marks) or `note`
    (worth a look, grey). Listed in the Checks panel and marked on the page; a click goes to the place.
  - `js/export.js`, Volpiano: the rules music21 (`music21/volpiano.py`) reads and writes (the CANTUS documents
    couldn't be reached from the session): `9abcdefghjklmnopqrs` G3–D6, capitals liquescent, flats `y w i x z`,
    `1---` clef, `-`/`--`/`---` between neumes/syllables/words, `---3`/`---4` for `:` `;` and `::` (other bars left
    out: Volpiano's barlines mark sections), `7` at each staff's end. Put in the octave CANTUS uses: the final
    between C4 and B4. Notes and accidentals it can't write are left out and named.
  - `js/export.js`, MEI 5 with neumes, one page, modelled on Neon's own sample files (DDMAL/Neon on GitHub;
    music-encoding.org couldn't be reached, so it hasn't been checked against the schema): facsimile zones for staves
    (with `rotate`), clefs, notes (placed along their glyphs), custos, accidentals, bars, syllables; `sb` per staff;
    `clef`, `divLine` (minima, minor, maior, finalis, virgula), `custos`, `accid`, `syllable`/`syl` (`wordpos`,
    `con`), `neume`/`nc` (`pname`, `oct` as Neon writes them: a C clef's line is C3, an octave below the app's own
    pitch names), `tilt` s/n/se for virga, reversed virga, inclinatum, `curve` and `<liquescent/>`, `<quilisma/>`,
    `<oriscus/>`. Zones are in the page's units: image pixels, or PDF points for a PDF (Neon will want the page as
    an image of the same size). To try: open an exported page in Neon with its image.
  - Pitch names in the app: GABC's C clef names middle C (C4), so a mode 1 final under c4 is D3.
- **Step 1, words and accepting staves** (version 0.6.0, merged):
  - Syllables: click the words to select (side panel: Text, As written, Begins a word); drag them, or arrow keys,
    to move them (they get a `box`); Enter accepts and goes on, Tab skips. `dipl` holds the reading as written when
    it differs from `text`. "New syllable here" splits a syllable at the selected neume (the new one takes that
    neume and those after, joined to the word, text to be typed); "Join to the one before" merges text and neumes.
  - Accept this staff (Shift+Enter), the middle way: refused while a doubtful neume or syllable (`conf` < 0.8,
    unchecked) is left, selecting the first; otherwise everything unchecked becomes `"staff"` and the next staff
    with chant is selected. Checked things are drawn green, doubtful orange, the rest red. The side panel counts
    what's checked on the staff.
  - Line finding: a staff whose bends come to less than a sixth of a space is straight (noise), fitted whole.
  - Not yet: a neume dragged past its neighbour keeps its GABC order; joining across staves; the text's own
    recognition (step 5).
- **Step 1, dragging neumes** (version 0.5.0, merged). Decided with the user: a drag moves a
  whole neume; accepting is the "middle way" (below).
  - A neume here is an item: one GABC group, all that stands over a syllable in it (a climacus `hvGF` moves as one).
    Click to select (its staff is selected too; the staff's handles hide). Drag up or down: snaps by steps and
    rewrites its letters (`CGChant.transpose`: notes, inclinata, accidentals, custos; a clef by whole lines; bars
    don't move; refused off the staff). Drag along: moves its box. Shift-drag: only the note nearest the pointer.
    Keys: arrows (up and down by a step, along by a pixel, Shift ten), Enter accepts and goes on, Tab skips, Delete
    takes it out (its syllable too if left empty), Esc lets go. The side panel gives its GABC, syllable, note names.
  - `checked` on items: `"item"` (accepted alone), `"edited"` (changed: counts as looked at), `"staff"` (to come).
    A drag that ends where it began changes nothing, not even `checked`.
  - Not yet: accepting a staff (the middle way: Accept staff refuses while doubtful neumes, conf < 0.8, are
    unchecked, and takes you to the first; the rest become `"staff"`); a neume dragged past its neighbour doesn't
    change their order yet (GABC order stands); syllables (dragging, typing, splitting).
- **Step 1, the notation drawn** (version 0.4.0, merged):
  - The font is **greciliae** (the user's choice): built unchanged from Gregorio 6.2.0's sources by
    `tools/build-greciliae.sh` (FontForge), in `fonts/` with its licence (OFL 1.1, Reserved Font Names "Caeciliae"
    and "Greciliae": not to be subset or converted without renaming). `js/greciliae.js`: its glyph table (name ->
    character, width), made by the same script; remake it with the font.
  - `js/neumes.js`: GABC neume material read into notes; notes gathered into glyphs as Gregorio does
    (`gabc-glyphs-determination.c`: pes, flexus, torculus, porrectus, scandicus, torculus resupinus, porrectus flexus;
    virga, inclinata, strophae, oriscus, quilisma alone or beginning a glyph; a liquescent or unison ends one); each
    named as Gregorio names it (`gregoriotex-write.c`: shape, queue length by where the note lies, intervals One–Five,
    liquescence), falling back to single notes where the font has no such glyph. Clefs (with cb3's flat), bars,
    custos, accidentals, moras. Not yet: fusion (@), hollow notes, episemata, ictus, the other signs.
  - Measurements: one pitch step is 157.5 font units, half the line spacing; a note's middle lies 72 units above
    its glyph's baseline (measured: C clef's line, divisio maior's middle, punctum's middle agree). So Gregorio's
    notes are about half a space high, smaller than in many printed books: over a scan the drawn note sits inside the
    printed one.
  - Placing: the Chant panel takes GABC and puts it on the selected staff and those below, one line per staff by its
    (z) breaks; each staff's items get boxes, spaced along the staff and stretched to fill it (as a printed line is
    justified). Drawn in red, see-through (adjustable), each glyph tilted with the staff where it sits; words under it.
    The chant is listed in the document's chants; saved as GABC with the page's line breaks.
  - **Licence:** neumes.js follows Gregorio's GPLv3 code closely (a port of its rules), so ChantGPT is GPLv3 or later
    (the user's decision, 2026-10-25; `LICENSE`). An independent rewrite of the rules was considered and declined.
  - Next: dragging neumes (up and down by step, rewriting their GABC; sideways along the staff) and syllables.
- **Step 1, bent staves** (version 0.3.0, merged): pages that couldn't be scanned flat (the user
  sees these often in bound books).
  - The format: a staff line is a list of points `[x0, y0, x1, y1, …]`, straight between them; two for a straight
    staff, as before, so older documents still open.
  - `fitStaff()` in `js/staves.js`: fits the middle of the box first, then follows the staff outwards a strip (about
    eight spaces) at a time, each strip searched where the last said the lines were heading, the slope's steepening
    carried on (a curl grows towards the binding); then drops the points that make no difference, and finds the ends
    again along the bent lines. A straight staff comes out with two points, fitted as a whole. Follows a bow of up to
    about three spaces; on `test/pages/warped.jpg` (a curl of about 1.3 spaces at the binding) within 2 px.
  - Editing: every point (ends and bends) has a bar through the four lines (drag to move that point of the staff)
    and a dot on each line; double-click a staff to add a bend there, double-click a bend's bar to take it away.
- **Step 0** (version 0.1.0):
  - `index.html`, `css/site.css`, `js/app.js`: open a PDF or page images, page through them, zoom, with an empty
    overlay (`<svg>`) drawn from the document in page coordinates, ready for the editor.
  - `js/viewer.js`: renders PDF pages (pdf.js) and images to a canvas, one page at a time.
  - `js/chant.js`: the internal format (see `docs/format.md`): a new document for a source, GABC import and export,
    pitch from the clef, the kind of each GABC group, and checks of a document.
  - `test/`: unit tests, in the browser (`test/index.html`) or with Node (`node test/node.js`).

## Still open

- **Diastematic neumes, set aside for another day** (the user, 11-03): reading staffless/heighted neumes (St Gall, Laon, Aquitanian and the like) and setting them in GABC's square notes. Their many forms and readings make it a project of its own; the manuscript text reader already reads the words under them. Paris lat. 12044 and Köln (points and Hufnagel on lines) are done as far as rounds help.
- **Mensural notation, later**: same app and staff finding, but its own model (note values, rests, mensuration, ligatures) and its own document model and export (MEI mensural, not GABC); see the conversation of 11-03.
- Which print, and which pages, for the first test (suggested: the 1908 *Graduale Romanum*).
- Versioning: does "stage, commit, and sync" here also bump the version and add release notes and a tag, as in
  Serenissima Press?
- The editing layer's open decisions (above): the chant font, what a drag moves, what "accept" means.
- The repository clones heavy (~3 GB) because the `training-data` branch holds the zips: testers only need the site,
  but if people start cloning, move training-data to a repository of its own.

## Working with the user

- The user is Ted Hamacher, a musicologist fluent in mensural notation, chant and Renaissance sources. They work on
  Windows (PowerShell and Git Bash).
- **Commits:** no git identity is configured, so commit with
  `git -c user.name="Ted Hamacher" -c user.email="60490684+tghamacher@users.noreply.github.com" commit ...`.
- **"Stage, commit, and sync"** means commit, then `git pull --rebase`, then push.
  - In Serenissima Press, each such commit also gets a version bump, release notes and a tag, unless the user calls it a
    silent update. Not yet decided for this repo.
- The user prefers user-facing text that is plain, instructive and sounds human, not stilted.
