# ChronosBible architecture refactor

Status: **completed; historical record.** The refactor was implemented in
milestones 1-7 and delivered as one pull request against `dev`. This document is
no longer an instruction set: [AGENTS.md](../../AGENTS.md), the
[development guide](../development.md) and the [audio guide](../audio.md)
describe the final structure and commands. The sections below keep the plan as
it was written; the checklists are ticked, and the decision log, verification
results and deferred ideas at the end record what happened.

## Objective and reviewed baseline

Refactor the whole repository into cohesive modules, remove demonstrated
redundancy, and consolidate repeated behavior. Deliver **one coordinated PR
against `dev`**, with focused, signed-off commits and independently verified
milestones. The agreed scope is internal redesign plus separately tested fixes
for confirmed bugs. Preserve the UI, public URLs, Scripture, saved progress,
backups, accessibility, offline behavior, and deployment contracts.

Keep React, Vite, TypeScript, Node 22, and the existing testing tools. Introduce
dependencies only for a demonstrated benefit, not as a prerequisite for moving
code. Preserve the existing lazy `fflate` compatibility fallback.

This document supersedes the chat plan based on `c29f912`. It was reviewed on
2026-10-31 against fetched `origin/dev` at
`02520e68c7345c285662915060c7d15a88532978`, which includes:

- [PR #15](https://github.com/albert429/ChronosBible/pull/15), reading flow,
  listening controls, startup improvements, and the installable offline app.
- [PR #16](https://github.com/albert429/ChronosBible/pull/16), canonical
  full-Bible study, compressed original-language resources, bounded caches,
  inventory-based offline study, and source/licensing checks.
- Commit `02520e6`, reloading a finished recording before replay to prevent a
  WebKit stall. Seeking the ended recording to zero is not equivalent.

Before implementation, fetch `dev`, inspect subsequent changes, and record the
actual implementation baseline below. Work from that baseline, not the original
PR #15 checkout. Follow [AGENTS.md](../../AGENTS.md), the
[development guide](../development.md), [audio guide](../audio.md), and
[canonical study source contract](../../data/study/CANONICAL.md).

### Changes from the original proposal

- Drop the proposed first-plan-occurrence study resolver. Canonical study is
  already shared by every reading mode; do not recreate day-based lookup.
- Add shared study domain and data modules so study UI and AI consume the same
  contracts and caches without a study-to-AI-to-study dependency cycle.
- Snapshot nested study v2 files, including stored gzip, inventory, and lexicon
  shards. A JSON-only or top-level scan no longer covers study output.
- Reuse the canonical study builder's existing output-ownership safeguards.
  Study stale-output cleanup is partly solved, not a new blanket deletion task.
- Preserve the new compression, cache limits, multilingual display, offline
  inventory, hosting audit, and replay contracts described below.
- Keep legacy Greek data and importer helpers that canonical generation still
  consumes. Removed runtime consumers do not prove source inputs are dead.

### Verification provenance

The original planning session ran 282 Node tests, 52 Python tests, and TypeScript
checking successfully on `c29f912`. Its lint/format failures came from scanning
Git-ignored video projects, Wrangler output, and a local settings file; two AI
lint warnings also existed. These are historical results, not validation of the
updated revision. PR #16 reports 299 Node and 65 Python tests, plus browser
checks; the later replay commit adds another regression. The updated revision
was inspected through Git objects, not freshly built or tested during this plan
update. Establish fresh results before implementation and after the refactor.

## Target architecture and dependency rules

Use feature-oriented organization with pure shared contracts and explicit side
effects. The repository-relative target is:

```text
src/
  main.tsx
  app/                  # Composition, session coordination, startup
  domain/
    scripture/          # Verse, passage, book, structure primitives
    reading/            # Reading shapes, tracks, locations, identity, navigation
    profiles/           # State schemas, completion rules, backup validation
    audio/              # Manifest contracts, timelines, publication rules
    study/              # Canonical references, schemas, budgets, word rules
  data/
    bible/
    plan/
    chronology/
    study/              # Shared canonical clients and transport decoding
                          # Generic JSON loading and versioned addresses
  features/
    reader/
    navigation/
    plan/
    profiles/
    audio/
    study/
    ai/
    appearance/
    offline/
  shared/
    ui/
    hooks/
    lib/
    browser/
    styles/
scripts/
  build/                # Vite plugins, build policy, orchestration
  data/                 # Importers and static builders
  audio/                # Alignment, encoding, review, publication
  hosting/
  assets/
  quality/
  lib/
```

Keep root `data/` as source material and `public/` as the runtime asset
destination. Keep conventional root configuration, licensing, and community
files. Keep component CSS adjacent to its owner. Do not create empty layers or
split coherent small modules merely to fill the tree.

Dependency rules:

- Domain modules are pure: no React, DOM, storage, network, filesystem access,
  or build globals. Inject dates and other changing inputs. They may depend on
  genuinely pure shared utilities, never shared UI or browser adapters.
- Scripture primitives are independent. Reading depends on Scripture; profiles,
  audio, and study use the appropriate pure contracts. Reading never depends
  on profile persistence. Remove the current plan/Bible/chronology type cycle.
- Data modules depend on contracts and loading helpers, never feature UI.
  Study UI and AI both use `data/study`; do not make one load through the other.
- Shared modules never import features or app orchestration. Features expose
  narrow entry points. Keep justified dependencies such as reader to audio/study,
  study to AI UI, and navigation to appearance/profiles/offline. Navigation
  receives passage-jump actions instead of importing reader DOM internals.
- App coordinates cross-feature workflows. Avoid one context holding all state
  or a generic service/container framework. Retain the external-store approach
  unless a concrete remaining problem justifies changing it.
- Preserve explicit lazy entry points; avoid barrel exports that eagerly load
  optional features. Modules executed by Node retain compatible relative imports
  and explicit TypeScript extensions where required, without an alias loader.

Internal interfaces to establish:

- One owner for `Verse`, `PassageRef`, `Passage`, `BibleBlock`, `BibleBook`, and
  `Testament`, separate from network clients.
- One all-track reading/location union with canonical identity, URL conversion,
  adjacency, and labels. Retain narrower legacy types only for real migration
  needs; external URLs and wire formats remain unchanged.
- A reading-resource interface preserving loading/error/retry behavior and a
  session controller coordinating navigation, profile changes, and completion.
- Pure profile transformations with storage adapters and React subscriptions.
- A canonical study context containing the selected reference, verse, and
  passage context. Keep focus elements in the UI layer. Replace Reader's
  synthetic BibleChapter adaptation with this context once parity is covered.
- Shared study reference parsing and pure word transformations. Keep display
  grouping distinct from AI content-word selection; both already share helpers.

## Implementation milestones

Each milestone ends with relevant tests and a functioning intermediate commit.
Do not implement the application refactor merely to update this document.

### 1. Establish a trustworthy baseline

- [x] Record the latest reviewed `dev` commit and reconcile changes since
      `02520e6`. Capture baseline builds in a clean environment with explicit
      production-audio, fixture-audio, and AI-stub configurations.
- [x] Repair `scripts/snapshot.mjs` before architectural edits. Recursively
      compare complete relative-path sets and file bytes in generated Bible,
      readings, chronology, study, and audio output. Include study `.json.gz`,
      inventory, lexicon shards, and nested audio manifests. Also capture the
      generated data actually shipped after build filtering. Use
      `fileURLToPath` and test filesystem paths containing spaces.
- [x] Run the corrected snapshot harness against the unrefactored baseline,
      not only against its own modified build. Record initial JS/CSS gzip,
      inline startup code, lazy chunks, and startup requests. Retain the existing
      512-byte growth allowance for initial JS and CSS; record inline startup
      size separately so moving code inline cannot hide growth.
- [x] Correct lint/format scan boundaries while covering all maintained code.
      Exclude generated/local ignored work without deleting or reformatting it.
      Record existing warnings and add only missing high-risk regression cases.

Exit: reproducible baseline and a snapshot that covers all generated content.

### 2. Establish domain, data, and persistence ownership

- [x] Move foundational contracts before consumers. Separate all-track profile
      schemas, completion, and backups from youth-plan UI; preserve migration,
      blocked/full storage behavior, guest isolation, and cross-tab updates.
- [x] Put reader-place contracts in reading, profile storage in profiles,
      playback-position persistence in audio, and scroll/DOM restoration in
      reader. Preserve keys and serialization formats.
- [x] Move appearance to its own feature and shared Scripture clients to data.
      Move canonical study contracts to domain/study and its shared client and
      decoder to data/study. Pure limits can be shared with build/hosting tools;
      browser and Node decoding remain environment-specific adapters.
- [x] Reuse `createJsonClient` parser injection, LRU bounds, pending-request
      deduplication, validation, invalidation, and error-cause behavior. Do not
      introduce a competing study cache. Use temporary internal re-exports only
      during the move, then remove them. (None were needed, and none remain.)

Exit: one owner per shared contract and no new feature dependency cycles.

### 3. Separate coordination from presentation

- [x] Extract App's reading selection/session logic, keyboard paging,
      document-title/preload effects, and profile dialog host.
- [x] Extract Reader's position restoration and listening-session coordination.
      Use the canonical study context instead of plan-day lookup or synthetic
      chapter objects. Preserve passage context, selected verse, and focus.
- [x] Split Navigation into toolbar, sheet host, and sheet controller. Use
      cohesive models/actions. Preserve closing/focus restoration before a
      deferred navigation, dialog, or passage-jump action.
- [x] Preserve chronology-selection supersession by newer choices, Back,
      navigation, or profile changes; never show old text beneath new controls.
- [x] Move feature-specific CSS out of global styles without changing early
      layout reservations or lazy-load boundaries.

Exit: major views compose focused controllers and presentation with identical
reading/navigation behavior.

### 4. Consolidate repeated behavior and feature internals

- [x] Share backup-file restoration, verse-number markup, reading labels,
      audio cue-step calculations, connection facts, and browser media fixtures.
      Retain distinct close behavior, compact labels, prefetch policies, and DOM
      shape where intentional.
- [x] Split audio contracts, structural validation, reading compatibility,
      addressing, and timeline operations. Preserve all supported manifest
      versions and the fresh-load-on-replay fix from `02520e6`.
- [x] Extract AI request/session control, accounting, cooldowns, cancellation,
      and report formatting from the panel. Keep guards across remounts,
      first-request lazy loading, and optional canonical context behavior.
- [x] Share canonical reference access instead of repeated string splitting.
      Preserve original-language UI versus AI selection policies.
- [x] Audit and remove confirmed redundancy: the audio reading-key wrapper,
      unread playlist generation counter, unused plan-only completion hook
      action, and obsolete chronology-disabled runtime branch. Recheck consumers
      on the implementation baseline; preserve legitimate legacy migration APIs.

Exit: abstractions have concrete consumers, and every deletion has evidence.

### 5. Refactor build, startup, and offline responsibilities

- [x] Replace deployment's source-string detection of chapter-audio support
      with explicit policy before extracting Vite configuration. Move data
      hashing, audio publication inputs, manifest filtering, and independent
      service-worker building into focused build modules.
- [x] Extract early-reading source into testable code bundled inline. Preserve
      its startup timing and single-use `window.__earlyData` response handoff;
      an external module script is not an equivalent replacement.
- [x] Separate offline pack enumeration, downloads, and UI state. Study uses
      `/study/v2/inventory.json`, saving indexes, translations, and word ranges
      while excluding AI-only lexicon shards. Derive pack contents from the
      inventory rather than hardcoding current counts or chapter ranges.
- [x] Preserve six concurrent saves, versioned URL resumption, raw-response
      persistence, and abort-all-on-failure. Keep memory resources, persistent
      Scripture, per-build shell, and browser audio caches distinct.
- [x] Reproduce and separately fix missed cancellation before the abort
      listener is installed in `savePack`; test pre-aborted signals and abort
      during cache setup. Characterize malformed inventory/path handling and
      cancellation during inventory acquisition before changing those flows.
- [x] Preserve strict gzip hosting admission and decoded-content auditing.
      Sharing budgets/schema must not weaken independent deployment checks.

Exit: worker/startup contracts, compression compatibility, and deployment
behavior remain stable.

### 6. Organize tooling and generated-output ownership

- [x] Group scripts by workflow and centralize repository-root resolution.
      Preserve npm commands and documented operational Python paths through
      thin wrappers where necessary. Keep existing test locations until a move
      has a specific ownership benefit; update discovery/config/CI together.
- [x] Make Python helpers importable. The full-study importer currently loads
      the older study importer for normalization/parser helpers; extract those
      helpers before considering deletion. Production builds remain independent
      of Python and heavyweight audio-generation dependencies.
- [x] Share authoritative book metadata, narrow USFM cleanup/tokenization,
      ffprobe/subprocess handling, and audio fingerprint formats. Preserve
      importer-specific structure and independent verification assertions.
      Extend existing cross-language golden fixtures rather than duplicating
      transcript specifications.
- [x] Preserve canonical study publication's existing inventory ownership:
      validate before publishing, delete only unchanged obsolete owned files,
      and reject unsafe paths, symlinks, and modified owned files. Preserve
      removal of the 450 obsolete per-day study files. Extend appropriate
      ownership safeguards to other generators, especially stale audio manifests;
      never recursively delete local media or unrelated output.
- [x] Keep `data/study/greek.json` and `lexicon.json`: canonical generation
      consumes them and verifies pinned hashes. Audit other legacy inputs
      against importers, reproduction commands, licenses, and provenance.
- [x] Make ordinary and AI browser builds explicit and self-contained, with
      fixture resources matching production gzip behavior. Fail on occupied
      ports rather than silently reuse stale preview servers.

Exit: repeatable generation, working operational commands, and safe stale-output
handling from a clean checkout and paths containing spaces.

### 7. Enforce boundaries and complete the handoff

- [x] Add targeted import-boundary lint rules without an architecture framework.
- [x] Audit remaining unused exports, CSS, dependencies, and shims using code,
      configuration, dynamic entry points, and build evidence. Direct Playwright,
      lazy fflate, source assets, and provenance are not automatically redundant.
- [x] Update AGENTS and development/audio/study instructions to the final
      structure. Mark completed plans historical and remove contradictions from
      current instructions.
- [x] Add `npm run verify:all` for maintained-code validation, Python checks,
      and browser tests; retain the faster existing `npm run validate` gate.
- [x] Run final acceptance, record comparisons and limitations, and prepare the
      single PR against dev. Distinguish refactors from independently tested fixes.

## Compatibility and acceptance

### Scripture, profiles, reading, and audio

Preserve Scripture bytes, passage order and repeats, structure/codepoint offsets,
attribution, query URLs, all reading identities, legacy migration, v2 backups,
guest isolation, Cairo dates, cross-tab updates, and storage-error behavior.
Maintain explicit completion independently of navigation or reaching audio end.

Cover RTL arrows/swipes, input/dialog keyboard exclusions, linked verse focus,
font-settlement restoration, remembered places, invalid chronology recovery,
both themes/auto theme, diacritics, reduced motion, 38px Arabic text, and
320–430px layouts.

Preserve v1/v2/v3 audio validation, transcript/identity matching, published-audio
gates, one media element, native-ended transitions, stale-play rejection,
seek/speed/resume, follow-along, lock-screen controls, repeat/continue/stop, and
fresh file reload when replaying a finished recording. Retain the replay unit
test and mobile WebKit replay/continuation browser coverage.

### Canonical study and AI

- All four tracks address study by canonical `BOOK.CHAPTER.VERSE`, independent
  of plan day or repeated occurrence. Preserve all 1,189 chapters and 31,104
  canonical verses, reviewed bridges/superscriptions, source checksums, exact
  Hebrew/Aramaic codepoints, unchanged legacy NT input, and documented exceptions.
- Opening the sheet alone requests no study data. Translation and words sections
  load independently. Cache bounds remain 24 chapter indexes, 12 word ranges,
  12 translation ranges, and 64 lexicon shards, without another per-verse cache.
  Failed range loads invalidate the chapter index so a retry can discover new
  ranges. Failed resources remain retryable and validation precedes caching.
- Preserve raw-gzip and already-decoded JSON handling, fatal UTF-8 validation,
  native decompression and lazy fflate fallback, and rejection of corrupt or
  oversized responses. Word payloads stay within 30,000 compressed bytes and
  256 KiB decoded; translation gzip budget is 30,000 bytes and lexicon gzip
  budget is 35,000 bytes.
- Preserve Greek phrase order, grouped Hebrew affixes, bidi isolation, language
  direction, and reference-derived mixed-language titles. Do not invent Arabic
  alignment where spans are unknown. Preserve different UI and AI word selection.
- Optional context failures omit only failed material; one failed lexicon shard
  does not discard successful shards. AI Stop is immediate while shared static
  fetches may finish. Preserve attempt/answer accounting, session limits,
  cooldowns, partial results, retry, and focus. Disabled builds contain no AI code.

### Offline, generation, and hosting

Versioned `.json.gz` remains worker-cacheable data. Offline study includes every
inventory-selected chapter resource, excluding AI-only lexicon. Workers retain
saved data across unrelated builds, wait for update acceptance, and exclude audio
and AI requests. `/sw.js` stays an independent classic build, without importing
app chunks or clearing/recopying the app output. Initial Scripture loads once
in Chromium and WebKit; registration stays deferred.

Snapshot complete generated path sets and bytes, including compressed bytes;
use decoded semantic fixtures as additional checks, not a substitute. Require
zero unexplained output differences. Test repeat builds, source removals, modified
owned-file refusal, and path resolution. Do not restore obsolete per-day study
publication. Preserve source pins, reviewed licensing boundaries, and notices.

Cloudflare must admit compressed assets only at validated study-word paths,
check identity and decoded size, and scan decoded content for credentials.
Retain production AI-off, environment allowlists, branch/checkout guards, asset
limits, redirects, caching headers, and verified audio publication inventory.
No upload or deployment is necessary to validate the refactor.

### Verification commands and evidence

Use Node 22 and locked dependencies. Existing commands before tooling moves:

```sh
npm run validate
python3 -I -m unittest discover -s scripts/tests
python3 -m py_compile scripts/*.py
PW_PORT=4400 npm run test:e2e
```

Browser setup requires installed Chromium and WebKit binaries. The e2e command
supplies audio fixtures; retain all Chromium, mobile WebKit, and AI projects and
intentional platform skips. Tests/builds must use clean, explicit environments,
not private local `.env` values or existing generated files from another revision.

Reuse existing tests, particularly canonical-study client/data/word/license,
JSON-client LRU/decoder, AI context, PWA/offline, hosting gzip, full-Bible study
browser, and audio replay cases. Keep meaningful semantic assertions; do not
replace them with tests mirroring new helper implementations. Run focused tests
after each change and the full suite at the end.

Compare final builds using the same configurations as the baseline. Enforce
bundle budgets and lazy loading, and remeasure startup/network timing after
preload/chunk changes. Record physical-device results separately from browser
emulation and report unperformed checks honestly.

## Agent latitude, decision log, and completion

The structure is the default implementation, not a reason to ignore better
refactors discovered while working. Additional internal extractions, names,
narrow placement changes, and reproduced bug fixes are allowed when they solve
a concrete problem, preserve the contracts above, and have appropriate evidence.
Record the rationale instead of asking permission for routine implementation
choices. Propose UI, public/storage-format, infrastructure, or major dependency
changes separately; record other out-of-scope ideas as follow-ups.

Keep decisions concise: finding → chosen change → reason → verification → result.

| Decision                                                                 | Rationale                                                                                              | Status                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Use updated dev, including PR #16 and replay fix                         | The original study assumptions are obsolete                                                            | Done. Baseline `40c1458` (`02520e6` plus this plan)                               |
| Add shared study domain/data ownership                                   | UI and AI share canonical contracts and bounded clients                                                | Done: `domain/study`, `data/study`; no study-to-AI-to-study cycle                 |
| Keep canonical publication ownership                                     | Existing inventory cleanup protects modified/unowned files                                             | Done, and extended to every generator (inventories)                               |
| Keep fflate and pinned legacy Greek inputs                               | Required compatibility and reproducible source inputs                                                  | Preserved (`import-study.py`, `greek.json`, `lexicon.json` kept)                  |
| Move files mechanically before changing contents                         | Reviewable renames; proves the move alone changes nothing                                              | Done: `04aad74` builds byte-identical to the baseline                             |
| Enforce layering with a data table, one small ESLint rule, a layer check | No architecture framework or dependency; resolving relative paths sees lazy `import()` and any depth   | Done (milestone 7)                                                                |
| Controllers return per-view models; no global context or container       | Keeps the external-store approach; property names in one literal cost less bundle than ~40 flat fields | Done (`useReadingSession`, `useSheetController`)                                  |
| Bundle the early-reading source inline from testable modules             | An external module script would run too late; one owner for keys and versioned addresses               | Done: inline startup 1106 to 910 B gzip                                           |
| Decide chapter audio per Worker by explicit policy                       | The old source-string detection of `vite.config.ts` was fragile                                        | Done: same environment as before (`CHAPTER_AUDIO`, both on)                       |
| Publish every generated folder through an inventory                      | Stale output is removed only when owned and unmodified; recursive deletes are gone                     | Done; non-shipping inventories are local state in `artifacts/generated-output/`   |
| Make browser builds explicit and never reuse a server                    | A stale preview or a developer's `.env` must not decide a test result                                  | Done: `browser-build.mjs`, `static-server.mjs`                                    |
| Keep the deploy path plain JavaScript                                    | Workers Builds may run a Node that cannot load `.ts`                                                   | Done: audit keeps its own limit copies, a test pins them to the domain            |
| Keep thin wrappers at documented old script paths                        | Operational commands, `wrangler.json` and the shipped study notice name them                           | Kept: 17 Python aliases, `cloudflare-app.mjs`, `build-study.js`; removal proposed |
| Remove only confirmed-unused code, each deletion with evidence           | Test-only seams and documented operational paths are not dead                                          | Done; see "Deletions and what was kept"                                           |
| Add `npm run verify:all` as a Node script; leave CI as it is             | One local command for everything CI runs; CI keeps per-step reporting; a test pins the two together    | Done                                                                              |
| Mark this plan historical; keep AGENTS.md short                          | Current instructions must not contradict the code                                                      | Done                                                                              |

### Implementation baseline

`40c1458` (`origin/dev`, 2026-10-31). Relative to the reviewed `02520e6` it adds
only this plan and a five-line note in `docs/development.md`, so the PR #15/#16
assumptions above held. The baseline builds and measurements were taken at
`95ff2aa` (`40c1458` plus the milestone 1 tooling; `src/` identical). The
implementation is a linear series of signed-off commits from `e77dfcb` to the
head of `refactor/m7-handoff`, one coordinated pull request against `dev`.

| Milestone | Commits (oldest first)                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1         | `e77dfcb` snapshot harness, `4bfc0ff` clean build configurations and startup measurement, `95ff2aa` lint and format scan scope    |
| 6 Python  | `aa8f0af` grouped tools and `chronos_tools`, `5e35ab9` reading-manifest inventory, `2aa90d7` licence notice, `be2b7db`, `cebbecc` |
| 2         | `04aad74` mechanical move, then `ab315e6`, `c8469b2`, `a2c9b61`, `f28fc0a`, `748e0f3`, `c09744b`, `a990c4e`, `fb39dfa`, `ada45e8` |
| 5, 6 JS   | `827fbf6`, `b2c941a`, `85deef8`, `53fec66`, `7f3a8bd`, `1a5c361`, `f0e4d89`, `9f90d95`, `166fc25`, `4387642`                      |
| 4         | `674562c`, `e2b2a8f`, `5fc8fe3`, `2b77447`, `cd2b55f`, `aba3818`                                                                  |
| 3         | `5ffc603`, `4791424`, `85a7677`, `666aa40`, `464509b`, `6c0dd21`, `0c510f6`, `160b79a`, `ec5d737`, `1d9fb65`                      |
| 5 offline | `299e0db`, `b80f6c7`, `0cd5670`, `4bd3809`, `95a490a`, `aedfd17`                                                                  |
| 7         | `accb236` layering rule and check, `20656d5` dead code, `8b1e2c9` `verify:all` and instructions, then this plan's completion      |

### Final structure

As planned, with these differences:

- `features/streak/` exists as a tenth feature: one lazy chunk used by reader,
  navigation and plan, with its rules in `domain/profiles/streak.ts`.
- `src/app/` holds the controllers (`useReadingSession`, `trackChoice`,
  `useKeyboardPaging`, `useDocumentTitle`, `useShownPreload`,
  `useProfileDialogs`, `DialogHost`), not only `App`.
- `data/earlyResponses.ts` owns the single-use early-response handoff, and
  `features/reader/earlyReading.ts` the early script's source.
- `scripts/` is `build/`, `data/`, `audio/`, `hosting/`, `assets/`, `quality/`
  and `lib/` (shared helpers, and the Python package `lib/chronos_tools/`).
- The import rules, allowed cross-feature edges and lazy entry points are in the
  [development guide](../development.md#layering) and enforced by
  `scripts/quality/import-boundaries.mjs`.

### Fresh verification results and artifact locations

All numbers are from this branch at its final commit, in clean environments
(no `.env*` files; every `VITE_*` and test variable set on the command line),
against the baseline captured from the unrefactored `src/`. Evidence lives
outside the repository, in the ignored `artifacts/refactor/` of the main checkout
(`BRIEF.md`, `VERIFY.md`, `baseline/<config>/`, `candidate/<task>/<config>/`,
`logs/<task>/`, `reports/<task>.md`, and `screens/m3/` for the screenshots).
None of it is committed. The layer graph tool that began there is now
`scripts/quality/layers.mjs`.

**Acceptance on the final tree** (`npm run verify:all` with `PW_PORT=4470`; the
four steps also ran separately, with the same counts):

| Check                                                                 | Baseline (`40c1458` plus milestone 1 tooling)        | Final                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run validate` (CI environment)                                   | pass; 316 Node tests; ESLint 0 errors, 2 warnings    | pass; **391 Node tests, 391 pass, 0 fail, 0 skipped**; Prettier clean; ESLint 0 errors, the same 2 `no-control-regex` warnings; tsc clean; build OK                                             |
| `python3 -I -m unittest discover -s scripts/tests`                    | 65 tests OK                                          | **117 tests OK**                                                                                                                                                                                |
| `find scripts -name '*.py' -print0 \| xargs -0 python3 -m py_compile` | pass (then `scripts/*.py` only)                      | pass (recursive)                                                                                                                                                                                |
| `PW_PORT=4470 npm run test:e2e` (inside `verify:all`)                 | 263 passed, 6 skipped, 0 failed (269 tests, 9.4 min) | **265 passed, 6 skipped, 0 failed** (271 tests, 9.3 min; two browser tests were added). Skips are the intentional mobile-webkit platform skips: `offline.spec.ts` x4, `reading-flow.spec.ts` x2 |
| `npm run layers` / layering lint                                      | n/a                                                  | no cycles, no violations; lint 0 errors                                                                                                                                                         |

**Snapshot and bundle comparison** (VERIFY loop: a clean build of each
configuration, then `snapshot.mjs` and `measure-startup.mjs` against the baseline
captures):

| Configuration    | generated    | shipped      | shell     | Initial JS gzip (limit +512) | Initial CSS gzip    | Inline startup gzip (raw)  | Lazy chunks                       | Startup requests (day 1 / GEN 1 / chronological) |
| ---------------- | ------------ | ------------ | --------- | ---------------------------- | ------------------- | -------------------------- | --------------------------------- | ------------------------------------------------ |
| production-audio | 7502, 0 diff | 7502, 0 diff | 9, 0 diff | 101433 to 101868 (**+435**)  | 4182 to 4021 (-161) | 1106 to 910 (2936 to 1691) | 34 to 35 (added `VerseStudy.css`) | 22/17/22, unchanged                              |
| fixture-audio    | 7502, 0 diff | 7502, 0 diff | 9, 0 diff | 101428 to 101863 (**+435**)  | 4182 to 4021 (-161) | 1106 to 910 (2936 to 1691) | 34 to 35 (added `VerseStudy.css`) | 22/17/22, unchanged                              |
| ai-stub          | 7502, 0 diff | 7502, 0 diff | 9, 0 diff | 101445 to 101899 (**+454**)  | 4182 to 4021 (-161) | 1106 to 910 (2936 to 1691) | 38 to 39 (added `VerseStudy.css`) | 22/17/22, unchanged                              |

Generated output is readings 151, bible 1190, chronology 555, study 3714 and audio
1892 files in each. `index.html` and `sw.js` differ by design (the inlined
early script; the worker's build id hashes the page). Disabled builds contain no AI
code. Startup bytes per entry place fall by 394 to 410 B (the smaller inline script
outweighs the +435 B of main-chunk code).

Why initial JS grew: component and hook boundaries carry property names that
minification cannot mangle (props objects, returned view models). Milestone 7
added nothing to the initial bundle. Initial CSS shrank because study-sheet and
dialog-form rules moved into the lazy chunks that use them.

**Production hosting path.** `npm run app:host:build` ran locally (no deploy, no
upload), in a clean detached clone of the final code (path containing a space),
with `WORKERS_CI_BRANCH=main` and the exact commit as `WORKERS_CI_COMMIT_SHA`. It
ended with "Cloudflare production: assets verified; AI disabled." Its `dist/`,
snapshotted and compared with the production-audio baseline, has the same 7502
generated and 7502 shipped files with zero differences, the same initial JS/CSS
numbers as above, and differs only by the two Cloudflare-only files `_headers` and
`_redirects`. `_redirects` and `wrangler.json` are byte-identical to `40c1458`;
`_headers` differs by one comment (`src/lib/dataVersion.ts` became
`src/data/dataVersion.ts`).

**UI parity.** Eight scenes (Genesis 1 and plan day 1 readers, menu sheet, day
sheet, join dialog, verse study sheet, completion toast, plan calendar) at 320 and
430 px, light and dark, 38 px text, reduced motion: **32 of 32 screenshots
identical to the baseline, 0 differing pixels in every pair.** First measured on the
milestone 3 tree, and re-run on the final tree.

**History of the gates through the milestones** (Node tests / Python tests / e2e
passed and skipped): baseline 316 / 65 / 263 and 6; after 2: 321 / 117 / 263 and 6;
after 6 (JavaScript): 343 / 117 / 263 and 6; after 4: 355 / 117 / 263 and 6; after 3:
362 / 117 / 265 and 6; after 5: 375 / 117 / 263 and 6 (it branched before milestone 3's
tests); final: 391 / 117 / 265 and 6.

**Limitations, stated plainly.**

- No physical-device checks. Everything is Playwright emulation (Chromium,
  mobile WebKit emulation, an axe pass), which is not a claim of device testing.
- Nothing was deployed or uploaded: no `wrangler deploy`, no R2 upload, no push to
  a hosting branch. The hosting path was exercised by a local build only.
- `scripts/data/import.py` and the other importers were not rerun against the real
  eBible archive and source downloads (not available offline). Their parsers are
  covered by synthetic-archive tests and old-versus-new differential tests, and
  the committed data is unchanged. The single indirect proof is the whitespace
  case in decision 7.
- The dev server's early-script rebundling (rebuilt when one of its four modules
  changes) was not exercised by hand during a `npm run dev` session; only builds
  and the production path were.
- Lighthouse was not re-run (informational only, noisy, and unchanged startup
  request counts); the baseline summary is `baseline/production-audio/lighthouse-summary.json`.
- The service worker's real browser behavior is covered by the built-worker contract
  test and Chromium's offline spec; the offline specs are skipped in mobile WebKit
  by design.

### Additional decisions and deferred ideas

Each item reads finding, change, reason, verification, result. Commit hashes are
those of the final history.

#### Milestone 1: baseline

1. The old snapshot hashed only top-level files, used `URL.pathname` (breaking on
   spaces) and ignored shipped data. It now records the recursive path set and
   SHA-256 of generated and shipped (post-filter) output, other dist files,
   initial JS/CSS gzip, inline startup gzip (separately), lazy chunks and an AI
   marker. Verified by `tests/snapshot.test.ts` (paths with spaces, nested
   `.json.gz`, lexicon shards, exit codes, the 512 B allowance); zero
   differences across rebuilds (`e77dfcb`).
2. Production, fixture and AI-stub builds were implicit. They are three explicit
   configurations built from a minimal environment that refuses `.env*` and local
   media; tests cross-check them against `vite.config.ts`, `test:e2e` and
   `playwright.config.ts`. Builds are bit-for-bit reproducible (`4bfc0ff`).
3. Startup requests cannot be measured without a browser; `measure-startup.mjs`
   serves `dist/` locally in Chromium (390x844, no worker) for three entry places
   and fails only if the request count grows.
4. `eslint .` and `prettier --check .` scanned other worktrees, video projects
   and Wrangler output. The ignore lists now skip local and generated work, and
   `tests/quality-scope.test.ts` pins both directions (`95ff2aa`). Existing
   warnings (two `no-control-regex` in `features/ai`) were recorded, not hidden.

#### Milestone 6, Python: tooling and ownership

5. Importers loaded sibling scripts by file path and repeated the book table,
   USFM cleanup, ffmpeg/ffprobe calls and fingerprint recipe. They became the
   importable stdlib-only package `scripts/lib/chronos_tools/` (`aa8f0af`);
   the full study importer no longer needs the legacy one. Verified by old-versus-new
   differential tests, 117 Python tests (65 before), and offline reruns that
   reproduce `reference-texts.json` and the alignment reviews byte for byte.
6. `build-reading-audio.py` deleted any unlisted `*.json` under
   `data/audio/readings`. It now publishes through an inventory (see the fixes
   below). The daily and chapter builders stop on a stray manifest instead of
   cataloguing it (`be2b7db`).
7. The shared USFM `clean` collapses the double space a mid-verse footnote left.
   `plan.json` must equal the `usfm.clean`-built source verse by verse, so Van Dyck
   has no such verse; `import.py` itself could not be rerun without the eBible
   archive (limitation below).
8. Seventeen old Python paths stay as thin aliases (documented operational
   commands); `data/study/LICENSE.md`, mirrored byte for byte into a shipped
   notice, still names them and was left unchanged (`2aa90d7`).

#### Milestone 2: domain, data and persistence

9. Finding: `bible/types.ts` imported the plan client and chronology types, which
   imported both back. Change: `domain/scripture/types.ts` owns `Verse`,
   `PassageRef`, `Passage`, `BibleBlock`, `BibleBook` and `Testament`; reading
   identity moved out of the network clients into `domain/reading/`
   (`ab315e6`, `c8469b2`). Result: no domain module imports data.
10. `scheduledDay` read the clock inside the domain; the date is now a required
    argument and `App` passes `today()` at the same call sites (`c8469b2`).
11. Profile storage mixed schema, transitions and persistence. Pure transitions
    (`domain/profiles/state.ts`) return new states; the adapter keeps keys,
    write-and-read-back and the blocked/unreadable/unsaved messages. Validation
    that ran before storage still does, so each bad input reports the same
    message with unreadable storage (`f28fc0a`). Verified by the unchanged
    progress, backup and migration tests plus `profile-state.test.ts`.
12. `readingHasAudio` read build globals inside the audio domain; it moved to
    `features/audio/availability.ts`, while the pure rules `vite.config.ts` needs
    stay in the domain (`748e0f3`).
13. The AI panel imported `reveal` from the study feature, which loaded AI.
    `reveal` moved to `shared/ui`, and the canonical reference helpers to
    `domain/study/reference.ts` (`c09744b`).
14. After the move one strongly connected set of seven features remained, caused
    by audio, study and navigation importing `reader/scriptureDom.ts` and the
    profile dialogs importing navigation's `View`. The markup contract moved to
    `shared/browser/scriptureDom.ts`; dialogs take `navigate: (view: "read")`
    (`a990c4e`). Result: no cycles.
15. The names `AnyReadingLocation`/`AnyScriptureReading` became `ReadingLocation`
    and `ScriptureReading`; the narrow v1 types are `PlanOrBibleLocation`/
    `PlanOrBibleReading` (`fb39dfa`). A rename only; `tsc` is clean.

#### Milestones 5 and 6, JavaScript: build modules and tooling

16. Production enabled chapter audio only because `vite.config.ts`'s text contained
    a variable name. `CHAPTER_AUDIO = { production: true, dev: true }` replaces
    it; the environment is unchanged and the verified upload inventory still
    decides what is advertised (`827fbf6`).
17. `vite.config.ts` held data hashing, audio publication inputs, manifest
    filtering and the worker build. They are modules in `scripts/build/`
    (`b2c941a`); the worker build keeps `configFile: false`, `publicDir: false`
    and `emptyOutDir: false`, and tests run the real plugin to prove only `sw.js`
    is added and nothing is removed. All three builds stayed byte for byte equal.
18. `scripts/lib/paths.js` is the one repository-root helper; scripts are grouped
    by workflow (`85deef8`). `scripts/cloudflare-app.mjs` and `build-study.js`
    stay as wrappers because `wrangler.json` and the shipped study notice name
    them.
19. `publishStudyPayloads` became `scripts/lib/ownership.js`, used by every
    builder (`53fec66`); it also refuses a dangling-symlink inventory, reports
    unparsable JSON clearly and refuses duplicate paths. Study inventory bytes
    and counts are unchanged. Readings, Bible and chronology publish through it
    (`1a5c361`); their inventories are local state because shipped inventories
    would change the data versions.
20. Browser tests relied on whatever `public/` an earlier build left, and
    `vite preview` marks `.json.gz` as `Content-Encoding: gzip`, unlike Cloudflare.
    `browser-build.mjs` builds explicitly and `static-server.mjs` answers like
    production; an occupied port fails the run (`f0e4d89`).
21. The deploy path stays plain JavaScript: Node before 22.18 cannot load `.ts`,
    and Workers Builds pins only "22". The hosting audit keeps its own copies of
    the study word limits, and a test asserts they equal the domain module (the
    builder imports the domain limits) (`9f90d95`, `4387642`).
22. No JS fingerprint code exists to share with Python, and the compact-JSON
    hashing is already pinned in both languages by `tests/fixtures/transcript.json`;
    no new fixture was added.

#### Milestone 4: audio, AI and study internals

23. `domain/audio/manifest.ts` (502 lines) held types, addressing, validation,
    matching and the timeline. It is `types`, `identity`, `manifest`
    (the file contract `build-audio-index.js` imports), `compatibility` and
    `timeline` (`674562c`). `audioAddress()` keeps a plan day's digits as written,
    so the validator's strict rule and the URL builder's loose rule behave as
    before (`plan:012` is still invalid yet maps to `/audio/12.json`).
24. `AudioPlayer.step` and the lock screen each computed the cue step; one
    `stepCueStart` serves both. Network Information facts were read in two
    places with different policies; one `currentConnection()` is shared and each
    policy stays (`5fc8fe3`).
25. AI request control, accounting, cooldowns and report formatting lived in the
    panel and were testable only through Playwright. `guards.ts`, `request.ts`
    and `report.ts` now carry them, with 12 unit tests driven by a fake `run.ts`
    (`2b77447`). Stop stays immediate; guards survive remounts; `run.ts` still
    loads on the first request; the `AiPanel`/`run` chunk names are unchanged
    because the Cloudflare audit matches them.
26. Study sections split canonical ids by hand; they now use `studyReference`.
    For every id the sheet can build the result is identical (the canonical data
    test checks every OT verse title); a malformed id would now throw
    `STUDY_UNAVAILABLE`, which no caller can produce (`aba3818`).
27. `PlaylistController.generation` was only ever incremented and `audioReadingKey`
    only wrapped `readingKey`; both were removed (evidence below). The replay fix
    from `02520e6`, its unit test and the mobile WebKit replay coverage are
    unchanged.

#### Milestone 3: coordination and presentation

28. `App` held about 25 states and handlers. `useReadingSession` owns them and
    returns `reader`, `plan`, `sheets` and `actions` models (a flat version cost
    about 250 B gzip in property names). The intent counter became the pure
    `createChoiceGuard`, tested without React, plus a browser test that Back
    during a pending catalog load keeps `plan:1` (verified by mutation).
29. The reader built a synthetic `BibleChapter` for chronological passages so
    `VerseStudy` could find a book. It now builds `{ usfm, passage, verse }` for
    every track (`features/reader/studyContext.ts`); a parity test over all 150
    days in plan, chronological and chapter form compares it with the former
    adaptation. `VerseStudy`'s props are `{ open, context, returnFocusTo, ... }`.
30. Navigation called reader DOM internals to jump to a passage. App now passes a
    `PassageJump` (`href`, `jump`), implemented in `features/reader/passageJump.ts`
    with the same DOM, focus and scroll calls. `useSheetController` keeps the
    deferred action in a ref and runs it from the sheet's `onAfterClose`, so
    close, focus restoration and then the action keep their order.
31. Three prefetch hooks with identical gating became `useAdjacentPrefetch` (about
    90 B saved). Feature CSS left `global.css` for its components, with a
    rule-level audit of the built CSS (same rule multiset apart from the intended
    `.error`/`.form-error` merge; no order change against a competing rule) and
    32 of 32 screenshot pairs identical (below). `.progress-track` stays global:
    two lazy features share it.
32. Shared in this milestone: backup-file restoration (`useBackupRestore`),
    verse-number markup (`VerseNumber`), and reading labels. Distinct on purpose:
    close behavior after a restore, the compact toolbar label, and per-UI label
    tables.

#### Milestone 5: offline, startup and worker

33. The early-reading script was hand-written ES5 in `index.html` duplicating the
    storage keys, versioned address rule and handoff shape. `startEarlyReading()`
    in `features/reader/earlyReading.ts` is bundled with Vite's own bundler into
    the same `<script>` in `<head>` (build and dev server), so timing and the
    single-use `window.__earlyData` handoff are unchanged. Verified by running the
    bundled script in `node:vm` (versioned hrefs per mode, failures resolve
    `undefined`, blocked storage never throws, no `import`/`export`, under 2 KiB)
    and by `loading.spec.ts` in Chromium and WebKit.
34. Offline code mixed pack enumeration, downloads and row state. `packs.ts`
    enumerates (pure for study, from the inventory; nothing hardcoded),
    `downloads.ts` saves (six at once, versioned-URL resumption, raw-response
    persistence, abort on failure) and `packStatus.ts` owns row state. The
    selection on the real inventory is identical (3,567 of 3,713 entries; 146
    lexicon shards excluded). The book check uses the Scripture catalog the
    offline chunk already imports; checking through `domain/study` would have
    split a new lazy chunk (`4bd3809`).
35. The built `sw.js` had no contract test. `service-worker.test.ts` runs it in a
    stand-in scope: shell cached per build, no `skipWaiting` except on the
    `"update"` message, older shell caches deleted, data kept while its folder
    version is unchanged, audio/AI/POST/unversioned requests untouched,
    navigation answered from the shell (`aedfd17`).

#### Milestone 7: boundaries and handoff

36. Layering rules existed only as a script outside the repository. The table of
    allowed edges is `scripts/quality/import-boundaries.mjs`, used by an ESLint
    rule (static, re-export and lazy imports, any specifier depth) and by
    `scripts/quality/layers.mjs` (`npm run layers`: graph, cycles, violations).
    Domain and `shared/lib` also reject `react`, `lucide-react`, `vite` and
    `node:` through `no-restricted-imports`. Build and tool code may import only
    domain, data, `shared/lib` and two feature files. `tests/import-boundaries.test.ts`
    proves 56 fixture cases (every rule fires, and its allowed counterpart does not),
    that the allowed edges are acyclic, and that the real tree has no cycle or violation;
    the tree lints with 0 errors (`accb236`). A regex-based `no-restricted-imports`
    per glob was rejected: it cannot see lazy imports or depth-dependent relative paths.
37. The audit found the deletions listed below (`20656d5`); everything else was
    kept for the reason given.
38. `npm run verify:all` runs `validate` in CI's environment, the Python tests,
    recursive `py_compile` and the browser tests, stopping at the first failure; it
    honors `PW_PORT`. CI keeps its separate steps for per-step reporting;
    `tests/verify-all.test.ts` pins the two to the same commands and order
    (`8b1e2c9`).

#### Independently tested fixes and hardening (not pure refactors)

These changed behavior on purpose, each with a test that failed on the old code
or a characterization written first. Everything else in the pull request is
meant to be behavior-preserving.

| Fix                                                                                                                         | Commit               | Evidence                                                                                                                                   | Visible effect                                                                             |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `savePack` missed a cancellation raised before its abort listener existed (pre-aborted signal, or abort during cache setup) | `b80f6c7`            | Two new tests failed on the old code ("Missing expected rejection"); failing run kept in `logs/m5-offline/savepack-before-fix.txt`         | A cancelled offline save now stops instead of downloading the whole pack                   |
| Stale audio manifests shipped after leaving the catalog: only catalogued, unadvertised manifests were removed               | `7f3a8bd`            | A new `build-audio-index` case failed on the old code; a test ties every `manifestOutputPath` output to the name pattern and media to none | Uncatalogued stale manifests no longer reach `dist/audio`; zero difference at the baseline |
| Study pack accepted any inventory key and an array `files`, ignored `v`, and had no signal                                  | `299e0db`, `0cd5670` | Behaviors characterized first, then rewritten to strict expectations; the real inventory yields the identical 3,567 files                  | A malformed or unsafe inventory fails the check instead of saving odd paths                |
| `build-reading-audio.py` deleted any unlisted `*.json` under `data/audio/readings` (symlinks and hand edits included)       | `5e35ab9`            | 13 ownership unit tests and an integration test that drives `main()`; inventory seeded over the 553 committed manifests                    | Only unmodified, inventory-recorded, no-longer-generated manifests are removed             |
| Chronology builder deleted `public/chronology` recursively, and the retired per-day study files by name                     | `1a5c361`            | `tests/generated-output.test.ts` on real builders (owned removal, modified-file refusal, symlinks, paths with spaces)                      | Unknown files survive a rebuild; a symlink stops the build before anything is removed      |
| Ownership accepted a dangling-symlink inventory, unparsable JSON and duplicate paths                                        | `53fec66`            | `tests/ownership.test.ts` (6 tests)                                                                                                        | Clear refusals; study inventory bytes unchanged                                            |
| Daily and chapter audio builders catalogued stray manifests                                                                 | `be2b7db`            | Python stray-manifest guard tests                                                                                                          | The build stops, and never deletes                                                         |
| Browser tests reused a listening server and a leftover `public/`                                                            | `f0e4d89`            | `build-config.test`, `static-server.test`, and a by-hand occupied-port run                                                                 | An occupied port fails the run                                                             |
| An offline row kept reporting after it closed, and its inventory request had no signal                                      | `0cd5670`            | Abort test (`AbortError`, the fetch's signal aborted)                                                                                      | Unmounting aborts the inventory request                                                    |

Smaller behavior notes, none visible to readers or in shipped bytes: the shared
USFM `clean` collapses a double space (no Van Dyck verse is affected, shown
through `plan.json`); ffmpeg calls gain `-nostdin` (output bytes unaffected);
`scheduledDay` takes its date from `App`; a malformed study id throws
`STUDY_UNAVAILABLE` where no caller can produce one; React Strict Mode in
development aborts the first mount's inventory request.

#### Deletions and what was kept

Removed, each after a whole-tree search (`git grep -w` over `src`, `tests`,
`scripts`, configuration, hosting and docs), checks for dynamic `import()` and
string references, and a clean `tsc` and build:

- `audioReadingKey`: body was `readingKey(reading)`; both consumers call
  `readingKey`.
- `PlaylistController.generation`: only ever incremented, never read; stale plays
  are rejected by `useMediaElement`'s token and the element's `ended` state.
- `useProgress().complete` and `setCompletion`: no consumer but tests, which now
  use `setReadingCompletion`; the chronology-off reader branch
  (`useReadingLocation`'s `chronological` option and its unused returns) was only
  ever called with `true`; the v1 writers `planLocation`, `withLocation` and
  `initialPreferences` (v1 is never written; the readers migration uses stay).
- `useChapterPrefetch`, `useChronologyPrefetch`: merged into one hook.
- In milestone 7: `isChronologyDefinition`, `occurrenceRef`, `ReadingMode` (no
  reference anywhere); `resumeChronologicalLocation`, `chronologicalStage` and
  `chronologicalSummary` (only their own test used them; the app resumes inline
  with `chronologicalLocationExists` and `firstChronologicalLocation`, which stay,
  and their assertions in `chronology-client.test.ts` went with them);
  `DATA` and `ARTIFACTS` in `chronos_tools/paths.py` (unreferenced in `scripts/`
  including its tests); the convenience re-export of `chips.ts` from
  `features/ai/prompt.ts` (consumers import `chips.ts`; the one test import moved).
- `dataVersionsHtml` and its placeholder, the private static server in
  `measure-startup.mjs`, and the text-parsing check of the AI env block.

Audited and kept: all runtime dependencies and devDependencies are used
(`fflate` by the lazy decoder fallback, `playwright` and `lighthouse` by
`scripts/quality/`, `@types/node` and `typescript` by the project configs); no CSS
class or custom property is unused (`scripture-superscription`, `-source-note` and
`-acrostic` are built from the block kind in `ChapterText.tsx`); source fonts and
images, provenance files, `import-study.py`, `greek.json` and `lexicon.json`;
`usfmByName` (the JavaScript half of the shared book-table fixture), `copyMedia`
(the only direct test of the unsafe-media refusal), `readerCompletion`,
`currentReader`, `AUDIO_HOST_ORIGIN` and `AUDIO_MEDIA_PREFIXES` (contract values
the hosting tests check against `_headers` and `_redirects`); the wrappers listed
in the decision table. Exports used only inside their own file keep their
`export` for tests. No temporary internal migration shim remains: there were no
re-exports during the moves, and `grep` finds no `export * from` in `src/`.

#### Deferred ideas and proposals needing the owner

- Remove the 17 Python aliases, `scripts/cloudflare-app.mjs` and `build-study.js`
  once nothing external uses the old paths. The shipped study notice
  (`data/study/LICENSE.md`, mirrored into `public/licenses/study-data.txt`) and the
  `note` in `data/audio/source-trims.json` still name old paths; changing them
  changes shipped bytes, so they need a reviewed data change.
- Add the translation (30,000) and lexicon (35,000) gzip budgets to
  `src/domain/study/limits.ts` so the builder stops owning them.
- `manifestOutputPath` could derive its paths from `identity.audioAddress`; first
  decide whether the build should accept only canonical chronology ids (its rule is
  looser than `isChronologyId`).
- Move the inline theme script in `index.html` through the early-script plugin, if
  the appearance owner wants one source for the theme keys.
- `StudyContext` could move from `features/study/context.ts` into `domain/study`.
- Put hand-written `data/study/*.md` back under Prettier (they sit inside the ignored
  `data/study/`).
- A Python quality check could reuse `chronos_tools.ownership`.

#### Known risks

- The non-shipping inventories in `artifacts/generated-output/` are local state.
  Deleting `artifacts/` makes builders forget what they own: they overwrite their
  current files and remove nothing.
- Production-like behavior of `.json.gz` depends on `static-server.mjs` matching
  Cloudflare; `vite preview` differs and is not used by the browser tests.
- The initial JavaScript is 435, 435 and 454 B gzip over the baseline, against a
  512 B allowance, because component and hook boundaries carry property names that
  minification cannot mangle. Further growth needs matching savings.

Completion record: one reviewable pull request with cohesive signed-off commits;
`npm run validate`, the Python tests, recursive `py_compile` and the full browser
suite pass (numbers above); the generated and shipped data are byte-identical to
the baseline; deletions have evidence; no temporary migration shim remains; the
repository instructions describe the final structure. Limitations are listed with
the results.
