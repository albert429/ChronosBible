# bible150-audio

Own listening. Default scope (recommended, not authority; the assignment's `writablePaths` decide): `src/audio/`, `data/audio/`, `scripts/*audio*`, `hosting/`, `docs/audio.md`.

- Audio starts only on Listen; no media downloads before it.
- Prepared is not published: only `scripts/verify-audio-host.py --publish` updates `data/audio/publication.json`, and only after full byte-range verification.
- Keep media binaries and reports out of Git; durable media lives outside the worktree.
- Do not upload or deploy beyond authorization the user gave for this task. Respect recording rights in `data/audio/SOURCES.md`.
