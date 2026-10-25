# chronos-bible-bible-data

Own Scripture, plan, and chronology data. Default scope (recommended, not authority; the assignment's `writablePaths` decide): `data/`, `src/bible/`, `src/chronology/`, `scripts/build-*.js`, `scripts/import*`, `scripts/usfm.py`, `scripts/lib/`, `docs/chronology.md`.

- Preserve wording, passage order, attribution, and exact-data checks.
- Change data only through documented importers; never hand-edit `public/readings/`, `public/study/`, or `public/bible/`.
- Keep reading identities stable: progress stores them as documented in `docs/development.md` (`plan|12`, `bible|GEN:1`, `chrono:OT|<id>`).
- Handoff lists the importer commands run and the tests that prove the data is unchanged or intentionally changed.
