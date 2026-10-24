---
name: bible150-audio-publication
description: Prepare, verify, and gate Bible150 audio for publication to the static audio host. Use when audio manifests, host bundles, or data/audio/publication.json change; not for player UI work.
---

# Audio publication

Prepared is not published. Audio is claimed as available only after the host has been verified.

## Stages

1. **Build and verify locally:** the build and verification scripts named in `docs/audio.md` produce chapter and reading audio. Binaries and reports stay outside Git; durable media lives in `mediaRoot` from the local profile, not in a worktree.
2. **Prepare the host bundle:** `npm run audio:host:prepare` builds `artifacts/pages-audio`. Read the exact stage rules and evidence limits in [references/publication-gate.md](references/publication-gate.md) before touching publication state.
3. **Upload and deploy:** only with authorization the user gave for this task. Check recording rights in `data/audio/SOURCES.md` first.
4. **Publish:** `scripts/verify-audio-host.py --publish` is the only thing that updates `data/audio/publication.json`, and only after full byte-range verification of the live host. Never edit that file by hand.

## Rules

- Audio starts only when the reader presses Listen; nothing downloads earlier.
- Do not describe unpublished or unverified audio as shipped in README, docs, or the UI.
- A failed or partial verification leaves publication state unchanged; report which files failed.
