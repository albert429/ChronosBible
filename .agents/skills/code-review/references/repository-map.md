# ChronosBible review map

Read sections relevant to the diff. Paths are repository-relative. This map
describes the architecture after the refactor; inspect current source and tests
for exact schemas, limits, and deliberate subsequent changes. The app is static
React/TypeScript/Vite, Arabic-first, with an optional Cloudflare AI Worker and no path router.

## Architecture and dependency direction

Start with `AGENTS.md`, `docs/development.md`,
`scripts/quality/import-boundaries.mjs`, and `vite.config.ts`.

- `src/core/` and feature `domain/` owns pure scripture, reading, profiles, audio, and study contracts.
  No React, browser APIs, storage, network, wall clock, or build globals. Its
  allowed dependencies are domain areas and pure `src/shared/lib/` helpers.
- feature `data/` and `src/shared/network/` owns network clients and imports only domain/data. Shared UI,
  hooks, browser adapters, styles, and pure helpers live in `src/shared/`, which
  never imports data, features, or app. `shared/lib` imports only itself.
- `src/features/` owns reader, navigation, plan, profiles, audio, study, ai,
  appearance, offline, and streak. Consult `FEATURE_EDGES`/`DOMAIN_EDGES` in the
  boundary rule for allowed edges rather than expanding an allowlist to silence
  a lint failure. Component CSS stays adjacent; tokens are shared.
- `src/app/` coordinates features; only `src/main.tsx` imports it from outside.
  Keep direct module imports and explicit lazy entry points. Check dynamic imports
  as well as static edges when moving code. Node-executed TypeScript imports need
  explicit `.ts` extensions and cannot rely on Vite aliases.
- `vite.config.ts` validates public `VITE_*` inputs and emits build constants.
  Runtime app code does not read `import.meta.env`. Disabled optional AI must be
  absent from the bundle. Avoid barrel files or helper imports that pull optional
  features, React, or browser globals into startup, tooling, or pure contracts.

Tests: `scripts/quality/tests/import-boundaries.test.ts`, `scripts/build/tests/vite-config.test.ts`,
`tests/integration/ai-static.test.ts`, `tests/integration/build-config.test.ts`, plus `npm run layers`.

## Reader, navigation, and profiles

Start with `src/app/useReadingSession.ts`, `src/app/trackChoice.ts`,
`src/core/reading/`, `src/features/reader/useReadingLocation.ts`,
`src/features/profiles/domain/`, and `src/features/profiles/storage.ts`.

- Four tracks share one reader: the youth plan, the Bible, and OT/NT chronology.
  Query strings (`?day=N`, `?mode=bible&book=GEN&chapter=1`,
  `?mode=chronological&testament=OT&reading=<id>`) are the navigation contract;
  parsing belongs to `src/core/reading/location.ts`. Preserve verse links,
  history/back behavior, explicit-link precedence, and canonical reading identity.
  Do not hardcode catalog counts or assume every reading is one chapter.
- Guest and named profiles retain independent places and completion per track.
  Opening a reading, paging, and finishing audio never imply completion. Explicit
  completion uses Cairo dates; `readOn` must stay consistent with completed entries
  while older state/backups without it remain valid.
- A delayed track/catalog choice must not override later navigation, browser
  history, or a profile switch. Check cold/error states for old Scripture shown
  beneath new controls and for stale callbacks saving to the wrong reader.
- Preserve `bible-reader-state-v2`, migrations from `nt-reading-progress-v1` and
  `bible-reader-location-v1`, and backup v1/v2 import. Migration leaves legacy
  keys intact. Failed reads must not become a fresh state that overwrites data;
  blocked/full storage and read-back verification must surface failure. Check
  cross-tab updates, malformed backups, bounds, and restore behavior.
- Audio position (`bible-reader-audio-position-v1`) and scroll position
  (`bible-reader-scroll-v1`) are device-local and outside progress backups.
  Keep their identity, eviction, and restore rules separate from completion.

Tests: `tests/integration/app-coordination.test.ts`, `tests/integration/reader-seams.test.ts`,
`tests/integration/reader-location.test.ts`, `tests/integration/reader-contracts.test.ts`,
`src/core/reading/tests/reader-modes.test.ts`, `src/features/profiles/tests/progress.test.ts`,
`src/features/profiles/tests/profile-state.test.ts`, `src/features/profiles/tests/streak.test.ts`, `tests/integration/schedule.test.ts`.
Browser coverage: `places`, `progress`, `reading-flow`, `bible`, `chronology`,
`loading`, and `streak` specs under `tests/browser/`.

## Arabic UI, accessibility, and reading position

Start with `src/features/navigation/`, `src/features/appearance/`,
`src/shared/ui/Sheet.tsx`, `src/shared/browser/scriptureDom.ts`,
`src/features/reader/verseScroll.ts`, and `src/features/reader/passageJump.ts`.

- Verify 320–430px widths, both themes, the largest Arabic font, reduced motion,
  RTL direction, and mixed Arabic/Latin references. Check overflow, sticky controls,
  touch targets, accessible names, and keyboard operation, not just screenshots.
- Preserve Arabic wording and punctuation; diacritic hiding is a display choice.
  Font/theme preferences and the legacy theme migration must work before first
  paint; automatic theme changes must still react to the system preference.
- Sheets must restore focus and defer actions until closing. Paging shortcuts
  must not fire in inputs/dialogs; check the existing RTL keyboard/swipe convention.
  Linked verses and saved positions can need correction after fonts load, but
  late restoration must stop when the user deliberately scrolls or interacts.
- Scripture DOM attributes are shared with tap selection, audio highlighting,
  scrolling, and tests. Treat markup refactors as contract changes.

Tests: `src/shared/lib/tests/arabic-display.test.ts`, `tests/integration/reader-seams.test.ts`; browser
`layout`, `loading-layout`, `sheets`, `menu`, `jumper`, and `diacritics` specs.

## Audio and publication

Read `docs/audio.md`; trace `src/features/audio/domain/`,
`src/features/audio/playlistController.ts`, `src/features/audio/useMediaElement.ts`,
`src/features/reader/useListeningSession.ts`, and `data/audio/publication.json`.

- Preserve legacy/canonical/playlist manifest compatibility. Structural validity
  alone is insufficient: text fingerprints, passage identity, verse/timing order,
  and the actual reading must agree. Follow source licenses and review status.
- Playback uses one persistent native media element. The native `ended` event
  advances files in the same task for locked-phone continuation; replacing it with
  timers or asynchronous UI orchestration can break playback. Preserve rate,
  pending seeks, retry position, Media Session controls, and pause-on-dialog rules.
- Replay after the last entry ends loads the first file afresh; seeking an ended
  WebKit element to zero can appear to play without advancing. Check stale play
  promises, switching readings/profiles, repeat/continue, and failed media loads.
- Do not fetch media before Listen. Metadata prefetch is separate and respects
  its own network policy; do not unify it with reading prefetch indiscriminately.
  An audio event must not mark progress completed.
- Recordings are immutable content-hashed objects. The build advertises verified
  publication inventory only. Upload/verification is a separate authorized task;
  a code review does not publish media or mutate the publication inventory.

Tests: `tests/audio*.test.ts`, `src/features/audio/tests/end-action.test.ts`,
`tests/integration/build-audio-index.test.ts`; browser `audio`, `bible-audio`, and
`chronological-audio` specs. Use Python tests for encoding/alignment/importer
changes. Simulated media tests do not replace real-device lock-screen evidence.

## Study, source text, and optional AI

Start with `data/study/CANONICAL.md`, `data/study/LICENSE.md`,
`src/features/study/domain/`, `src/features/study/data/`, `src/features/study/`,
`src/features/ai/`, and the relevant importers in `scripts/data/`.

- Study is keyed by canonical book/chapter/verse across every reading track.
  Runtime resources live under `/study/v2/`: chapter indexes, ranged
  `.words.json.gz`/`.tr.json`, lexicon shards, and an inventory. The original-word
  tuple has eight fields, including `grc`/`he`/`arc`; the old day-based Greek
  format is not the runtime API. Legacy source files can still be importer inputs.
- Preserve exact original-language codepoints, reviewed verse bridges and
  superscriptions, Hebrew/Aramaic direction and affixes, and nullable alignment
  spans. Never invent word alignment or import restricted lexicon definitions.
  Titles and context must reflect the verse's language rather than assume Greek.
- Clients validate before caching, bound caches, and allow retry. A failed range
  invalidates the associated chapter index. Keep shared pending requests and
  cancellation ownership correct; avoid an unbounded derived verse cache.
- Word decoding handles stored gzip and already-decoded HTTP responses. Preserve
  size limits from `src/features/study/domain/limits.ts`, native `DecompressionStream`, and
  the lazy `fflate` fallback. Test raw gzip through the production-like static
  server as well as decoded responses; Vite preview alone is insufficient.
- Opening study does not eagerly fetch all resources. Optional AI is behind the
  compile-time flag, with a lazy panel and request pipeline. Keep provider secrets
  out of public configuration; all `VITE_*` values reach the browser.
- Check request abort, SSE parsing, error/retry, stale answers, cache keys, and
  session/cooldown accounting. Optional static context failures must not prevent
  the core request; aborting one AI request must not cancel shared study fetches.
  UI language selection and prompt-context selection can have different purposes.

Tests: `tests/study*.test.ts`, `src/shared/network/tests/json-client.test.ts`, `tests/ai-*.test.ts`,
Python `test_import_study*.py`; browser `study`, `study-full-bible`, and `ai` specs.

## Offline packs, service worker, and startup

Start with `src/features/offline/`, `src/shared/network/dataVersion.ts`,
`src/shared/network/earlyResponses.ts`, `src/features/reader/earlyReading.ts`,
`src/shared/browser/afterStartup.ts`, and `scripts/build/`.

- Offline packs validate inventory paths and persist raw responses, including
  stored gzip. Pack saving is bounded, resumes partial downloads, stops all workers
  on failure/cancel, and emits no progress after cancellation. Cover abort before
  the first await and while the cache is opening, not just during fetch.
- Keep shell-cache lifetime separate from content-versioned data-cache lifetime.
  An unrelated app build must not discard saved Scripture. Version identity
  includes filenames and bytes. Keep audio and AI traffic out of persistent caches.
  Updates wait for user acceptance; avoid activating a new shell mid-session.
- `/sw.js` is built as a separate classic worker without application chunks or
  recursive Vite config/public-directory copying. App and worker must agree on
  versioned `.json` and `.json.gz` routing.
- The early reading request is inlined at build time and handed off once through
  `window.__earlyData`. Preserve dev/production behavior and WebKit request reuse.
  Service-worker registration and optional preloads wait until after startup.

Tests: `tests/offline-*.test.ts`, `src/features/offline/tests/pwa-rules.test.ts`,
`tests/service-worker*.test.ts`, `tests/integration/early-reading.test.ts`,
`src/shared/browser/tests/prefetch.test.ts`, `scripts/quality/tests/measure-startup.test.ts`; browser `offline` and
`loading` specs. Check both raw-gzip and data-version behavior when cache paths move.

## Generators, licensing, and hosting

Start with `scripts/data/`, `scripts/audio/`, `scripts/lib/ownership.js`,
`scripts/lib/chronos_tools/`, `scripts/hosting/`, `scripts/build/`,
`data/bible/SOURCES.md`, `data/audio/SOURCES.md`, and the affected provenance files.

- `data/` and documented importers are the source of generated `public/` assets.
  Never hand-edit generated Scripture, study, or audio JSON. Preserve text,
  passage ordering, attribution, licenses, source revisions, and exact-data tests.
- JS/Python output ownership inventories record file identity. Validate before
  writing; remove only unchanged obsolete files owned by that generator. Preserve
  unknown files/local media and reject unsafe paths, symlinks, and modified owned
  output. Recursive cleanup is not an equivalent refactor.
- Preserve cross-language transcript/fingerprint serialization (including Arabic
  Unicode) using `tests/fixtures/transcript.json`. Similar source parsers can have
  intentionally different text/verse semantics; prove equivalence before merging.
- Thin top-level script aliases are public CLI compatibility. Search docs, CI,
  package scripts, and external workflow assumptions before removing them. Keep
  Python tools runnable in isolated mode; Python is not required to build the app.
- Every push deploys. Production `main` has AI off; dev enables it explicitly.
  Hosting stays static-only. Keep Cloudflare `_headers`/`_redirects` in step with
  `vercel.json`, and check cache policy and gzip handling against shipped assets.
- `scripts/cloudflare-app.mjs` is the guarded deployment entry. Never use bare
  `wrangler deploy` or bypass dirty-checkout, branch, environment, media, and
  publication preflights. Test guards with fixtures or a controlled checkout;
  reviewing them never requires a real deployment. Do not print credentials.
- Quality checks must exclude local `.agents/` worktrees, `.claude/worktrees/`,
  ignored media, and generated output while still covering maintained skills,
  source, docs, tests, and scripts. See `tests/integration/quality-scope.test.ts`.

Tests: `scripts/lib/tests/ownership.test.ts`, `scripts/data/tests/generated-output.test.ts`,
`tests/build-*.test.ts`, `scripts/lib/tests/script-books.test.ts`, `scripts/quality/tests/snapshot.test.ts`,
`tests/integration/app-host.test.ts`, `tests/integration/cloudflare-app.test.ts`,
`scripts/quality/tests/static-server.test.ts`, `tests/integration/quality-scope.test.ts`, and
`scripts/tests/`. Inspect `.github/workflows/checks.yml` for the current CI contract.
