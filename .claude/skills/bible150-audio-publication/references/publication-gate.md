# Publication gate

Read before changing anything that decides whether audio counts as published.

- **State owner:** `data/audio/publication.json` changes only through `scripts/verify-audio-host.py --publish`. A pull request that edits it by hand is wrong; regenerate it.
- **Evidence:** full byte-range verification of every published file on the live host, not a sample and not the local bundle.
- **Claims:** wording in `README.md` and `docs/audio.md` follows the publication file, never the prepared bundle.
- **Bundle:** built by `scripts/prepare-audio-host.mjs` into `artifacts/pages-audio`; contents are disposable and ignored by Git.
- **Authorization:** `wrangler` or any upload runs only when the user authorized it for this task. A dry run (prepare and local verify) needs no approval.
