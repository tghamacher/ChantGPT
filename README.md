# ChantGPT training data

Staves for the recognizer, already straightened (see `training/README.md` on `main`), and the latest checkpoint:

- `staves-*.zip`: 14,442 synthetic staves (`training/data/staves/`).
- `real-1.zip`: the 1908 Graduale's staves aligned with GregoBase (`training/data/real/`; `labels-clean.jsonl`: those
  the model agrees with).
- `model.zip`: the checkpoint the published model came from (`training/data/model2/best.pt`).

Unzip each in the repository's root (`tar -xf <zip>`). Kept on a branch of its own, so cloning with
`--single-branch` leaves it out.
