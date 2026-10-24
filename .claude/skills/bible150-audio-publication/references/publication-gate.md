# Publication gate

Read before changing anything that decides whether audio counts as published. Details live in `docs/audio.md`; this is the short version.

- **Inventory:** `data/audio/publication.json` is the committed verified inventory. `scripts/verify-audio-host.py --publish` merges a release into it after the verifier passes; a path whose bytes differ from an earlier verified entry is refused. Do not edit it by hand.
- **What verification proves:** for every file in the prepared inventory, three byte ranges (start, middle, suffix) must match the local bytes with exact `Content-Range` and `Content-Length`, plus one past-the-end `416`. `--full` additionally downloads each file and compares its SHA-256. A default run is range-level evidence for every file, not a full-content hash; say which method the report used (`ranges` or `full`).
- **Partial runs:** `--only <prefixes>` is for investigation and cannot be combined with `--publish`.
- **Claims:** wording in `README.md` and `docs/audio.md` follows the publication inventory, never the prepared bundle.
- **Bundle:** `artifacts/pages-audio` and its inventory are ignored by Git. Files are hard-linked from the media roots by default (`--copy` copies), so the bundle may be the only copy of locally produced media. Confirm the durable source recordings are saved outside every worktree before deleting a bundle or worktree; it is otherwise rebuildable.
- **Authorization:** `wrangler` or any upload runs only when the user authorized it for this task. Preparing and verifying locally needs no approval.
