# ChantGPT training data

Staves for the recognizer, already straightened (see `training/README.md` on `main`), and the latest checkpoint:

- `staves-*.zip`: 14,442 synthetic staves (`training/data/staves/`).
- `staves-ms-*.zip`: 26,756 synthetic manuscript staves (`training/data/staves-ms/`: `render.js --style ms`, two
  columns, red hand-ruled staves, a scribe's notes, parchment).
- `real-1.zip`: the 1908 Graduale's staves aligned with GregoBase (`training/data/real/`; `labels-clean.jsonl`: those
  the model agrees with).
- `real-labels.zip`: the real staves' labels with their line breaks mended (`recognizer.py rebreak`, then `clean`):
  `labels-rebroken.jsonl`, `labels-rebroken-clean.jsonl`. Unzip after `real-1.zip`.
- `real-2.zip`: the Graduale's last pages (842-948: 56 more staves) and all the real labels again, mended and
  cleaned with them (1,914 clean staves). Unzip after `real-1.zip` and `real-labels.zip`.
- `model.zip`: the checkpoint the published model came from (`training/data/model2/best.pt`).

Unzip each in the repository's root (`tar -xf <zip>`). Kept on a branch of its own, so cloning with
`--single-branch` leaves it out.
