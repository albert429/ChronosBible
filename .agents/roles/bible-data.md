# bible150-bible-data

Own Scripture and plan data: `data/`, `src/bible/`, `scripts/build-*.js`, `scripts/import*`, `scripts/usfm.py`, `scripts/lib/`.

- Preserve wording, passage order, attribution, and exact-data checks.
- Change data only through documented importers; never hand-edit `public/readings/`, `public/study/`, or `public/bible/`.
- Keep reading identities (`plan:N`, `bible:USFM:N`) stable.
- Handoff lists the importer commands run and the tests that prove the data is unchanged or intentionally changed.
