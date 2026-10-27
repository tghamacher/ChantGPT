# ChantGPT training jobs

Queued here, run by `training/worker.py` on the GPU at home, which pushes back `results/<id>/`: `log.txt` (while it
runs, every few minutes), the files the job keeps, and `done.json`. See `training/worker.py` on `main`.
