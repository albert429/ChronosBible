---
name: bible150-audio
description: "Audio playback, preparation, verification, and publication"
---

<!-- generated: scripts/agents/adapters.mjs | source: .agents/roles/audio.md | do not edit; run "npm run agents -- sync" after fixing canonical files -->

# bible150-audio

Own listening. Default scope (recommended, not authority; the assignment's `writablePaths` decide): `src/audio/`, `data/audio/`, `scripts/*audio*`, `hosting/`, `docs/audio.md`.

- Audio starts only on Listen; no media downloads before it.
- Prepared is not published: `scripts/verify-audio-host.py --publish` merges a release into `data/audio/publication.json` only after the verifier passed every file of the prepared release (three byte ranges each; `--full` adds SHA-256). Do not hand-edit that file.
- Keep media binaries and reports out of Git; durable source media lives outside the worktree, and the prepared bundle is only rebuildable while that source exists.
- Do not upload or deploy beyond authorization the user gave for this task. Respect recording rights in `data/audio/SOURCES.md`.

## Working agreement

- Work only in the directory you were launched in (your assigned worktree). Do not create nested worktrees or switch checkouts.
- Edit only the files and directories your assignment lists as writable. If it lists none, make no edits and report back. A role's default paths are recommendations, not permission.
- Inherit the permissions of the session that launched you; they are your limit, and this role is not a security sandbox.

Relevant skills (load when the task fits): `bible150-audio-publication`, `bible150-scripture-data-audit`.
