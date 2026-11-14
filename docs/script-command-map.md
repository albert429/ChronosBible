# Retired script entrypoints

The former compatibility files in the root `scripts/` directory have been
removed. Use the maintained paths below with the same arguments. Existing npm
command names are unchanged. Historical plans retain the paths used at the time.

For Python commands, run `python3 -I <maintained path> ...`. For the Cloudflare
command, run `node <maintained path> <action> <target>`; checkout verification,
build and deployment safeguards still apply.

| Former filename in root `scripts/` | Maintained path                              |
| ---------------------------------- | -------------------------------------------- |
| `align-audio.py`                   | `scripts/audio/align-audio.py`               |
| `build-audio.py`                   | `scripts/audio/build-audio.py`               |
| `build-canonical-audio.py`         | `scripts/audio/build-canonical-audio.py`     |
| `build-reading-audio.py`           | `scripts/audio/build-reading-audio.py`       |
| `build-reference-auditions.py`     | `scripts/audio/build-reference-auditions.py` |
| `build-voice-auditions.py`         | `scripts/audio/build-voice-auditions.py`     |
| `extract-plan.py`                  | `scripts/data/extract-plan.py`               |
| `import-bible.py`                  | `scripts/data/import-bible.py`               |
| `import-chronology.py`             | `scripts/data/import-chronology.py`          |
| `import-study-full.py`             | `scripts/data/import-study-full.py`          |
| `import-study.py`                  | `scripts/data/import-study.py`               |
| `import.py`                        | `scripts/data/import.py`                     |
| `optimize-assets.py`               | `scripts/assets/optimize-assets.py`          |
| `prepare-reference-texts.py`       | `scripts/audio/prepare-reference-texts.py`   |
| `review-audio-alignments.py`       | `scripts/audio/review-audio-alignments.py`   |
| `verify-audio-host.py`             | `scripts/hosting/verify-audio-host.py`       |
| `verify-canonical-audio.py`        | `scripts/audio/verify-canonical-audio.py`    |
| `build-study.js`                   | `scripts/data/build-study.js`                |
| `cloudflare-app.mjs`               | `scripts/hosting/cloudflare-app.mjs`         |

`build-study.js` was a module re-export. Import `buildStudy` from the maintained
module; the normal data-generation entrypoint remains
`scripts/data/build-data.js`.
