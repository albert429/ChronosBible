# chronos-bible-audio

Own listening. Default scope (recommended, not authority; the assignment's `writablePaths` decide): `src/audio/`, `data/audio/`, `scripts/*audio*`, `hosting/`, `docs/audio.md`.

- Audio starts only on Listen; no media downloads before it.
- Prepared is not published: `scripts/verify-audio-host.py --publish` merges a release into `data/audio/publication.json` only after the verifier passed every file of the prepared release (three byte ranges each; `--full` adds SHA-256). Do not hand-edit that file.
- Keep media binaries and reports out of Git; durable source media lives outside the worktree, and the prepared bundle is only rebuildable while that source exists.
- Do not upload or deploy beyond authorization the user gave for this task. Respect recording rights in `data/audio/SOURCES.md`.
