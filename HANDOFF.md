# Handoff: partbook OMR app (from the Serenissima Press session, 2026-10-23)

Background for a new Claude Code session. Nothing has been built yet: this repo is empty apart from this file.

## The idea

Elam Rotem (Early Music Sources, maker of the EMS Serenissima font) saw Serenissima Press, which typesets MusicXML as
mensural partbooks and choirbooks (github.com/tghamacher/serenissima-press, live at tghamacher.github.io/serenissima-press).
He asked for the reverse:

> The dream would be to put a complete PDF, and the app would understand which part belongs to what, and would put
> everything in modern scores. It would probably need to have a system of alerting the user for possible mistakes that
> they could then review manually.

**Input:** a whole PDF of Renaissance partbooks. **Output:** modern scores (MusicXML, perhaps MEI), with a list of
places flagged for the user to check.

## What already exists

- **Mensural OMR** by David Cheong: omr-webapp-1046295414238.us-central1.run.app.
  - It takes one JPG page, needs a login, and the user marks each staff and sets clef, key and time by hand.
  - It gives one modern part. It doesn't sort pages into parts, score up or check anything.
  - Worth contacting about sharing its model or data.
- **Aruspix** (Laurent Pugin): recognition of early printed music.
- **MuRET** (University of Alicante: Calvo-Zaragoza, Rizo): mensural recognition with a correction interface.
- **Martha Thomae's scoring-up tool** (SIMSSA, McGill): turns mensural parts into a score.

## Decisions so far

- **Run everything in the browser, hosted on GitHub Pages.** No server, no uploads, no accounts, the same as
  Serenissima Press.
  - Use pdf.js to open the PDF.
  - Run the recognizer with ONNX Runtime Web (WebGPU or WASM).
- **The recognizer is a small specialist model, not an LLM or general vision model.**
  - It's a staff-level network that reads a cut-out staff left to right and outputs a symbol sequence (CRNN + CTC, as
    in text recognition).
  - The finished model is a 10–50 MB `.onnx` file. Host it on GitHub Releases or Hugging Face Hub, not in git.
  - It must never route users' files through Claude or the user's account.
- **Most of the app is ordinary code, not AI.**
  - Sorting the pages into voices and pieces.
  - The mensural rules: perfection, imperfection, alteration, coloration, ligatures.
  - Scoring up.
  - The alerts. These come from the parts disagreeing (a voice out of step by the end of a section, parts not ending
    together, a perfection that can't be resolved, odd dissonances), combined with the model's confidence scores.
  - Serenissima Press's `js/convert.js` does the reverse conversion and already has a bar-by-bar "voices out of step"
    check (`checkBars`).
- **Training happens locally on the user's AMD RX 6700 XT (12 GB).**
  - Try `torch-directml` on Windows first.
  - Linux with ROCm and `HSA_OVERRIDE_GFX_VERSION=10.3.0` is faster.
  - Google Colab is the fallback.
- **Training data, in order of use:**
  1. Synthetic staves rendered by Serenissima Press from MusicXML (CPDL, Josquin Research Project, CMME corpus), with
     known answers and degradation effects (paper texture, ink spread, blur, tilt). A new export mode is needed in that
     repo.
  2. Existing datasets: SEILS (Italian madrigal partbooks), Capitan, MuRET data. Check each one's contents and license
     first.
  3. Facsimiles (BSB, ÖNB, Gallica, IMSLP; DIAMM has stricter terms) aligned automatically with existing modern
     editions, then checked by hand.
  4. Corrections made in the app's own editor, and later corrections users share (this needs a small backend, such as
     a Cloudflare Worker; it isn't part of the core app).
- **Proof-of-concept target:** one printer's partbooks, for example a complete Gardano set.

## Plan

0. **Set-up:**
   - repo skeleton and GitHub Pages;
   - pdf.js page viewer;
   - an internal format for a recognized part (mensural symbols with their page and staff positions).
1. **No AI yet (the first real milestone):**
   - a symbol editor laid over the page image;
   - the mensural rules;
   - scoring up;
   - alerts;
   - MusicXML and MEI export.
   - Test it on one piece entered by hand.
2. **Sorting a whole PDF:** find staves automatically, group pages into books by voice name, match pieces across books
   by title, order and initials, and have the user confirm.
3. **Training data:** the synthetic export in Serenissima Press, facsimile collection and alignment, and contacting
   David Cheong.
4. **The recognizer:** train it, run it in the browser, and feed its confidence scores into the alerts.
5. **Later:** manuscripts, other printers, text and underlay recognition (perhaps with Kraken), and shared corrections.

## Still open

- The app's final name. This repo is ChantGPT; check whether the user means that to be the app's name.
- Which piece and print to use as the first test.

## Working with the user

- The user is Ted Hamacher, a musicologist fluent in mensural notation and Renaissance sources. They work on Windows
  (PowerShell and Git Bash).
- **Commits:** no git identity is configured, so commit with
  `git -c user.name="Ted Hamacher" -c user.email="60490684+tghamacher@users.noreply.github.com" commit ...`.
- **"Stage, commit, and sync"** means commit, then `git pull --rebase`, then push.
  - In Serenissima Press, each such commit also gets a version bump, release notes and a tag, unless the user calls it a
    silent update.
  - Ask whether this repo should follow the same practice.
- The user prefers user-facing text that is plain, instructive and sounds human, not stilted.
