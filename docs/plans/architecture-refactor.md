# ChronosBible architecture refactor

Status: implementation handoff; the refactor has not started.

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

- [ ] Record the latest reviewed `dev` commit and reconcile changes since
      `02520e6`. Capture baseline builds in a clean environment with explicit
      production-audio, fixture-audio, and AI-stub configurations.
- [ ] Repair `scripts/snapshot.mjs` before architectural edits. Recursively
      compare complete relative-path sets and file bytes in generated Bible,
      readings, chronology, study, and audio output. Include study `.json.gz`,
      inventory, lexicon shards, and nested audio manifests. Also capture the
      generated data actually shipped after build filtering. Use
      `fileURLToPath` and test filesystem paths containing spaces.
- [ ] Run the corrected snapshot harness against the unrefactored baseline,
      not only against its own modified build. Record initial JS/CSS gzip,
      inline startup code, lazy chunks, and startup requests. Retain the existing
      512-byte growth allowance for initial JS and CSS; record inline startup
      size separately so moving code inline cannot hide growth.
- [ ] Correct lint/format scan boundaries while covering all maintained code.
      Exclude generated/local ignored work without deleting or reformatting it.
      Record existing warnings and add only missing high-risk regression cases.

Exit: reproducible baseline and a snapshot that covers all generated content.

### 2. Establish domain, data, and persistence ownership

- [ ] Move foundational contracts before consumers. Separate all-track profile
      schemas, completion, and backups from youth-plan UI; preserve migration,
      blocked/full storage behavior, guest isolation, and cross-tab updates.
- [ ] Put reader-place contracts in reading, profile storage in profiles,
      playback-position persistence in audio, and scroll/DOM restoration in
      reader. Preserve keys and serialization formats.
- [ ] Move appearance to its own feature and shared Scripture clients to data.
      Move canonical study contracts to domain/study and its shared client and
      decoder to data/study. Pure limits can be shared with build/hosting tools;
      browser and Node decoding remain environment-specific adapters.
- [ ] Reuse `createJsonClient` parser injection, LRU bounds, pending-request
      deduplication, validation, invalidation, and error-cause behavior. Do not
      introduce a competing study cache. Use temporary internal re-exports only
      during the move, then remove them.

Exit: one owner per shared contract and no new feature dependency cycles.

### 3. Separate coordination from presentation

- [ ] Extract App's reading selection/session logic, keyboard paging,
      document-title/preload effects, and profile dialog host.
- [ ] Extract Reader's position restoration and listening-session coordination.
      Use the canonical study context instead of plan-day lookup or synthetic
      chapter objects. Preserve passage context, selected verse, and focus.
- [ ] Split Navigation into toolbar, sheet host, and sheet controller. Use
      cohesive models/actions. Preserve closing/focus restoration before a
      deferred navigation, dialog, or passage-jump action.
- [ ] Preserve chronology-selection supersession by newer choices, Back,
      navigation, or profile changes; never show old text beneath new controls.
- [ ] Move feature-specific CSS out of global styles without changing early
      layout reservations or lazy-load boundaries.

Exit: major views compose focused controllers and presentation with identical
reading/navigation behavior.

### 4. Consolidate repeated behavior and feature internals

- [ ] Share backup-file restoration, verse-number markup, reading labels,
      audio cue-step calculations, connection facts, and browser media fixtures.
      Retain distinct close behavior, compact labels, prefetch policies, and DOM
      shape where intentional.
- [ ] Split audio contracts, structural validation, reading compatibility,
      addressing, and timeline operations. Preserve all supported manifest
      versions and the fresh-load-on-replay fix from `02520e6`.
- [ ] Extract AI request/session control, accounting, cooldowns, cancellation,
      and report formatting from the panel. Keep guards across remounts,
      first-request lazy loading, and optional canonical context behavior.
- [ ] Share canonical reference access instead of repeated string splitting.
      Preserve original-language UI versus AI selection policies.
- [ ] Audit and remove confirmed redundancy: the audio reading-key wrapper,
      unread playlist generation counter, unused plan-only completion hook
      action, and obsolete chronology-disabled runtime branch. Recheck consumers
      on the implementation baseline; preserve legitimate legacy migration APIs.

Exit: abstractions have concrete consumers, and every deletion has evidence.

### 5. Refactor build, startup, and offline responsibilities

- [ ] Replace deployment's source-string detection of chapter-audio support
      with explicit policy before extracting Vite configuration. Move data
      hashing, audio publication inputs, manifest filtering, and independent
      service-worker building into focused build modules.
- [ ] Extract early-reading source into testable code bundled inline. Preserve
      its startup timing and single-use `window.__earlyData` response handoff;
      an external module script is not an equivalent replacement.
- [ ] Separate offline pack enumeration, downloads, and UI state. Study uses
      `/study/v2/inventory.json`, saving indexes, translations, and word ranges
      while excluding AI-only lexicon shards. Derive pack contents from the
      inventory rather than hardcoding current counts or chapter ranges.
- [ ] Preserve six concurrent saves, versioned URL resumption, raw-response
      persistence, and abort-all-on-failure. Keep memory resources, persistent
      Scripture, per-build shell, and browser audio caches distinct.
- [ ] Reproduce and separately fix missed cancellation before the abort
      listener is installed in `savePack`; test pre-aborted signals and abort
      during cache setup. Characterize malformed inventory/path handling and
      cancellation during inventory acquisition before changing those flows.
- [ ] Preserve strict gzip hosting admission and decoded-content auditing.
      Sharing budgets/schema must not weaken independent deployment checks.

Exit: worker/startup contracts, compression compatibility, and deployment
behavior remain stable.

### 6. Organize tooling and generated-output ownership

- [ ] Group scripts by workflow and centralize repository-root resolution.
      Preserve npm commands and documented operational Python paths through
      thin wrappers where necessary. Keep existing test locations until a move
      has a specific ownership benefit; update discovery/config/CI together.
- [ ] Make Python helpers importable. The full-study importer currently loads
      the older study importer for normalization/parser helpers; extract those
      helpers before considering deletion. Production builds remain independent
      of Python and heavyweight audio-generation dependencies.
- [ ] Share authoritative book metadata, narrow USFM cleanup/tokenization,
      ffprobe/subprocess handling, and audio fingerprint formats. Preserve
      importer-specific structure and independent verification assertions.
      Extend existing cross-language golden fixtures rather than duplicating
      transcript specifications.
- [ ] Preserve canonical study publication's existing inventory ownership:
      validate before publishing, delete only unchanged obsolete owned files,
      and reject unsafe paths, symlinks, and modified owned files. Preserve
      removal of the 450 obsolete per-day study files. Extend appropriate
      ownership safeguards to other generators, especially stale audio manifests;
      never recursively delete local media or unrelated output.
- [ ] Keep `data/study/greek.json` and `lexicon.json`: canonical generation
      consumes them and verifies pinned hashes. Audit other legacy inputs
      against importers, reproduction commands, licenses, and provenance.
- [ ] Make ordinary and AI browser builds explicit and self-contained, with
      fixture resources matching production gzip behavior. Fail on occupied
      ports rather than silently reuse stale preview servers.

Exit: repeatable generation, working operational commands, and safe stale-output
handling from a clean checkout and paths containing spaces.

### 7. Enforce boundaries and complete the handoff

- [ ] Add targeted import-boundary lint rules without an architecture framework.
- [ ] Audit remaining unused exports, CSS, dependencies, and shims using code,
      configuration, dynamic entry points, and build evidence. Direct Playwright,
      lazy fflate, source assets, and provenance are not automatically redundant.
- [ ] Update AGENTS and development/audio/study instructions to the final
      structure. Mark completed plans historical and remove contradictions from
      current instructions.
- [ ] Add `npm run verify:all` for maintained-code validation, Python checks,
      and browser tests; retain the faster existing `npm run validate` gate.
- [ ] Run final acceptance, record comparisons and limitations, and prepare the
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

| Decision                                         | Rationale                                                  | Status                              |
| ------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------- |
| Use updated dev, including PR #16 and replay fix | The original study assumptions are obsolete                | Planned baseline: `02520e6`         |
| Add shared study domain/data ownership           | UI and AI share canonical contracts and bounded clients    | Planned                             |
| Keep canonical publication ownership             | Existing inventory cleanup protects modified/unowned files | Preserve and extend where justified |
| Keep fflate and pinned legacy Greek inputs       | Required compatibility and reproducible source inputs      | Preserve                            |

Implementation baseline: pending.

Fresh verification results and artifact locations: pending.

Additional decisions and deferred ideas: pending.

Completion requires one reviewable PR with cohesive commits, all maintained-code
checks and the full test suite passing, documented data/performance comparisons,
evidence for deletions, no temporary internal migration shims, and accurate
repository instructions. This plan update itself changes documentation only.
