---
name: bible150-audio-publication
description: Prepare, verify, and gate Bible150 audio for publication to the static audio host. Use when audio manifests, host bundles, or data/audio/publication.json change; not for player UI work.
---

<!-- generated: scripts/agents/adapters.mjs | source: .agents/skills/bible150-audio-publication/ | files: SKILL.md references/publication-gate.md | do not edit; run "npm run agents -- sync" after fixing canonical files -->

# Audio publication

Prepared is not published. Audio counts as available only after the deployed host has been verified; `docs/audio.md` ("Prepared is not published", "Publishing a release") is the authority.

## Stages

1. **Build and verify locally:** use the build and verification scripts named in `docs/audio.md`. Binaries and reports stay out of Git. Keep the durable source recordings in a media root outside every worktree (`mediaRoot` in the local profile), passed as `AUDIO_MEDIA_ROOT` or `--media`.
2. **Prepare the host bundle:** `npm run audio:host:prepare` builds `artifacts/pages-audio` and its inventory. The bundle is rebuildable only while its source media still exists elsewhere; see [references/publication-gate.md](references/publication-gate.md) before discarding anything.
3. **Upload and deploy:** only with authorization the user gave for this task. Check recording rights in `data/audio/SOURCES.md` first.
4. **Verify, then publish:** `python3 scripts/verify-audio-host.py https://<app origin>` checks every prepared file; add `--publish` to merge the passing release into `data/audio/publication.json`. Do not hand-edit that file.

## Rules

- Audio starts only when the reader presses Listen; nothing downloads earlier.
- Do not describe unpublished or unverified audio as shipped in README, docs, or the UI.
- A failed verification publishes nothing; report which files failed and why.
