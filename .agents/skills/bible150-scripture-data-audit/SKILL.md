---
name: bible150-scripture-data-audit
description: Audit Bible150 Scripture, plan, chronology, or audio-alignment data after an importer or builder change, proving wording and order are unchanged or intentionally changed. Use when data files, importers, or build scripts change.
---

# Scripture data audit

Scripture wording, passage order, and attribution are fixed content. Treat any difference as a finding until it is explained.

## Procedure

1. Identify the source of truth for the touched data: `data/bible/`, `data/plan.json` and `data/source-plan.json`, `data/chronology/` (rules in `docs/chronology.md`), `data/study/`, or `data/audio/`. Provenance and licences are in the `SOURCES.md` files beside them.
2. Change data only through its documented importer or builder (`scripts/import*.py`, `scripts/build-*.js`). Never hand-edit generated `public/readings/`, `public/bible/`, `public/study/`, or `public/audio/`.
3. Record a baseline before the change (`npm run snapshot -- save <dir>` with the dir under `.agents/artifacts/`), regenerate, then `npm run snapshot -- compare <dir>`. An unexpected data diff fails the audit.
4. Run the exact-data tests (`npm test`) and, for importers, `python3 -I -m unittest discover -s scripts/tests`. Coverage gates in importers must stay on.
5. Spot-check boundaries by hand: first and last verse of changed books, repeated passages, and the documented chronology exceptions.

## Report

State which importer ran, the commit or source version used, the snapshot comparison result, and the tests that prove the result. If the change is intentionally different, list each changed reading and why. Reading identities (the `plan|12`, `bible|GEN:1`, `chrono:OT|<id>` forms in `docs/development.md`) must keep resolving, since saved progress uses them.
