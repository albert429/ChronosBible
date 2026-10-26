# Development guide

## Structure

| Path                                                            | Responsibility                                                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`, `src/App.tsx`                                   | React bootstrap; app shell wiring reader, plan, navigation, and dialogs                                                    |
| `src/appInfo.ts`                                                | App credits, contact links, and Scripture source                                                                           |
| `src/lib/`                                                      | Shared helpers: `jsonClient` (cache, deduplication, timeout), `useResource`, `network`, `format`, `useNotice`, `useToday`  |
| `src/bible/`                                                    | Verse and reference parsing; canonical catalog, chapter client, reading identity (`plan:N`, `bible:USFM:N`), navigation    |
| `src/plan/`                                                     | Plan state: `readings` loading, `progress` profiles, `useProgress`, `schedule`, `backup`, `labels`, `PlanView`, `Calendar` |
| `src/plan/dialogs/`                                             | Join, Invite, Settings, and restore dialogs, loaded on demand                                                              |
| `src/reader/`                                                   | Reader, Scripture and chapter rendering, remembered places and links, verse taps, completion bar, listen button, prefetch  |
| `src/navigation/`                                               | Toolbar, menu, day details, appearance panel and preferences, share, About                                                 |
| `src/components/`                                               | Shared UI: native-dialog `Sheet` (`useModalDialog`), `Feedback`, `PassageReference`, `ReactIcon`, form styles              |
| `src/audio/`                                                    | Player and controls, manifests (v1 days, v2 days/chapters), media element, Media Session, highlighting, contract, flags    |
| `src/study/`                                                    | Lazy full-Bible study: translations, Greek/Hebrew/Aramaic words, and optional AI explanations                              |
| `src/ai/`                                                       | AI explanation pipeline: config, prompt, provider chain (`providers/openrouter.ts`), SSE parsing, cache, answer formatting |
| `src/styles/`                                                   | Design `tokens.css`, `base.css`, and `global.css`; component CSS sits beside its component                                 |
| `data/`                                                         | Canonical Scripture plan, extracted source table, `books.json` (66 books: USFM, OSIS, STEPBible codes with Arabic names)   |
| `data/bible/`                                                   | Full Van Dyck source (66 books, structure), catalog and provenance (see `data/bible/SOURCES.md`)                           |
| `data/study/`                                                   | Imported study data (CC BY / CC BY-SA; see `data/study/LICENSE.md`)                                                        |
| `data/audio/`                                                   | Verse timing alignments and audio sources (see `data/audio/SOURCES.md`)                                                    |
| `scripts/build-data.js`                                         | Runs the static-data builders below into `public/` (`predev`/`prebuild`)                                                   |
| `scripts/build-{readings,bible,study,audio-index}.js`           | Split plan, 1,189 chapters, study data, and audio manifests into static JSON, with budgets; `scripts/lib/books.js` shared  |
| `scripts/import*.py`, `extract-plan.py`, `usfm.py`              | Source extraction and importers, with coverage gates                                                                       |
| `scripts/{align,build}-audio.py`, `audio_*.py`                  | Alignment (NT/OT), daily build with optional spoken references; `scripts/tests/` holds the Python tests                    |
| `scripts/{build,verify}-canonical-audio.py`                     | Encode and verify the 1,189 chapter recordings; `import-bible.py` imports the full text                                    |
| `scripts/{prepare,upload}-audio-r2.mjs`, `verify-audio-host.py` | Stage, upload and verify the R2 audio host                                                                                 |
| `scripts/{build,review}-*audio*.py`                             | Chronological playlists and clips; alignment review. Evidence limits and publication gate: `docs/audio.md`                 |
| `scripts/snapshot.mjs`                                          | Build-output snapshot and compare tool (`npm run snapshot`)                                                                |
| `scripts/`                                                      | Also: asset regeneration, AI model check, SSE stub, visual and performance checks                                          |
| `tests/`                                                        | Unit/data checks; `tests/browser/` holds mobile browser workflows                                                          |
| `docs/assets/`                                                  | README artwork and actual app screenshot; never shipped in the app                                                         |

## Commands

| Command                                            | Purpose                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run dev`                                      | Development server, port 5173; generates static data first                               |
| `npm run build`                                    | Generate static data, type-check the app, and build `dist/`                              |
| `npm start`                                        | Preview `dist/`, port 4173                                                               |
| `npm test`                                         | Progress, dates, loading, and exact static-data fidelity                                 |
| `npm run test:e2e`                                 | Fixture build, then Chromium and WebKit workflows, layout and axe                        |
| `npm run test:browser`                             | Playwright against the current `dist/` without rebuilding (set the same env as test:e2e) |
| `npm run ai:models`                                | Check that the configured AI models still exist and are free                             |
| `npm run format` / `format:check`                  | Apply / verify repository formatting                                                     |
| `npm run lint`                                     | ESLint (TypeScript, React hooks) over the whole repository                               |
| `npm run typecheck`                                | Type-check the app, configs, browser specs and scripts                                   |
| `npm run snapshot -- save <dir>`                   | Record hashes of generated data and sizes of `dist/assets/`                              |
| `npm run snapshot -- compare <dir>`                | Fail on any data change or initial JS/CSS growth over 0.5KB                              |
| `npm run audio:host:prepare`                       | Stage recordings in `artifacts/r2-audio` and write the R2 upload batches                 |
| `npm run audio:host:upload`                        | Put each batch into the R2 bucket `chronosbible-audio` with wrangler                     |
| `npm run app:host:deploy`                          | Build, then deploy the app to Cloudflare Workers with wrangler                           |
| `npm run validate`                                 | Formatting, lint, type-check, unit/data checks, and build                                |
| `python3 -I -m unittest discover -s scripts/tests` | Python audio hash tests (standard library only; CI also runs `py_compile`)               |
| `npm run test:visual`                              | Save preview screenshots under `artifacts/`                                              |
| `npm run audit:performance`                        | Save repeatable mobile Lighthouse reports under `artifacts/`                             |

`tsconfig.json` only references `tsconfig.app.json` (`src/`), `tsconfig.node.json` (`vite.config.ts`, `playwright.config.ts`, the unit tests in `tests/*.test.ts` and `tests/browser/`, strict) and `tsconfig.scripts.json` (`scripts/` and `hosting/` JavaScript, checked but not strict). `build` checks only the app, so tests and scripts cannot block a deploy.

`npm install` sets `core.hooksPath` to `.githooks/`. `pre-commit` runs Prettier and ESLint on the staged files, then `npm run typecheck`; `pre-push` runs `npm test`. Skip them in an emergency with `--no-verify`.

`npm run test:e2e` builds with `AUDIO_TEST_FIXTURES=1`, `VITE_AUDIO_BASE_URL=https://audio.example.test` and `VITE_AUDIO_CHAPTERS_ENABLED=true`, then runs Playwright with the same variables; without them the audio specs fail on a fresh clone. Playwright starts the production preview itself, and the build generates `public/readings/` and `public/study/`, which the separate AI test build (`dist-ai/`, see below) reuses. Outside CI it reuses servers already listening on ports 4173, 4174 and the stub's, so stop a stale `npm start` (or any server serving an old `dist/`) first or the specs run against the old build. Install their browsers with `npx playwright install chromium webkit` (`--with-deps` on Linux). `CHROMIUM_PATH` optionally selects an existing Chromium executable; WebKit uses its own installed browser. The Bible audio specs (`tests/browser/bible-audio.spec.ts`) run only in the fixture build: they serve accelerated copies of the committed chapter manifests with synthetic WAV media and abort, then fail on, any request that leaves 127.0.0.1.

Visual and performance scripts expect a running `npm start`. `BASELINE_URL` optionally adds a baseline site. Compare builds using the same server, throttling, and environment. Reports and traces are ignored by Git.

## State and privacy

`bible-reader-state-v2` stores independent places and explicit completion for the guest and each named reader across Bible, youth plan, Old Testament chronology and New Testament chronology. It migrates `nt-reading-progress-v1` and `bible-reader-location-v1`; new backups use version 2 and version 1 youth-plan backups remain importable as separate profiles. `bible-reader-audio-position-v1` retains listening positions by immutable media path. `word-font` and `word-dark` preserve appearance settings. Clearing site data or moving browsers/domains requires restoring a saved backup.

Beside `completion`, each reader (and the guest) has an optional `readOn` map: `track|entry` (`plan|12`, `bible|GEN:1`, `chrono:OT|<id>`) to the Cairo date the reading was marked done. Undoing a reading removes its date. Only still-completed readings with valid dates are kept, invalid entries are dropped rather than rejected, and the field is written only when non-empty. Backups carry it and import accepts it; older backups and v1 data import without it. Readings completed before dates were recorded have none, so streaks start with the next reading.

Streaks (`src/plan/streak.ts`) count consecutive dates with at least one completed reading in any track. Today counts once read and is otherwise still pending. One missed date is forgiven as a rest day when no other rest day falls within a week of it; two missed dates in a row end the streak. The best streak, whether today is still due and a seven-day strip are derived the same way. The streak UI (`src/streak/`) is one lazy chunk shown in the menu's reader section, the plan's day menu, the plan calendar and under a completed reading. Milestone cards appear only when the day's first reading is marked done there (3, 7, 14, 30, 50, 100 and 150 days, and each quarter of the plan). Animations use transform and opacity, run once and stop under reduced motion.

The plan's day menu («تفاصيل اليوم») lists every plan day in five ranges of thirty (`src/navigation/DayJumper.tsx`, lazy, warmed when the day button is pressed). Completed, today's, overdue and open days differ by shape as well as colour.

A fresh reader opens Genesis 1; explicit URLs override saved places. Legacy `?day=N` and `?mode=bible&book=GEN&chapter=1&verse=1` links remain supported alongside chronology links. Navigation supports Back/Forward without marking a reading complete.

`src/chronology/` loads reference-only reading definitions and slices canonical chapter text through the shared chapter cache. The reviewed output contains 412 Old Testament and 141 New Testament readings; source order, repetitions, the documented 1 Timothy 6:22 exception, and nearest natural chapter/section breaks are described in [chronology.md](chronology.md). `scripts/build-chronology.js` runs through the data build; keep that guide authoritative for regeneration and audit details.

Schedules use Cairo dates. Catch-up and advance reading do not move a reader's start date. Daily JSON is cached in memory during the browser session, with concurrent requests deduplicated; failed requests can be retried. This is not a persistent offline/PWA implementation.

While reading, adjacent days are prepared 500ms after the selected day and its fonts settle. Save-Data and reported slow-2g, 2g, or 3g connections suppress this background work; browsers without connection information allow it. Navigation cancels queued work, while already-started requests remain shared with foreground loading. Speculative failures are silent and do not prevent a later retry.

Tapping a verse opens its study sheet in all four reading modes; a text selection, a press longer than 500ms, or a movement over 10px does not. The verse number is a button for keyboard and screen-reader users. The first press on the reading warms the study code chunk (skipped under Save-Data or slow connections). The sheet shows the verse above collapsed sections: «ترجمات أخرى», the optional «اسأل الذكاء الاصطناعي», and the original-language words, whose title reflects Greek, Hebrew, Aramaic, or mixed Hebrew/Aramaic. Each section is a heading button with a short hint and, where useful, a count. Its content mounts the first time it opens, and the sheet scrolls just enough to show it. Opening the sheet fetches no study data until a section needs it.

Study uses canonical `BOOK.CHAPTER.VERSE` identities in every mode. `src/study/canonicalClient.ts` first loads `/study/v2/BOOK/CHAPTER/index.json`, then the bounded verse range containing the requested verse. Translations (`RANGE.tr.json`) and words (`RANGE.words.json.gz`) load independently; shared lexicon shards (`/study/v2/lex/Gxx.json` or `Hxx.json`) load only when AI word context needs them. Requests are deduplicated and cached by chapter, range, and shard, with limits of 24 chapter indexes and 12 entries for each other cache. Failed requests remain retryable. Legacy per-day files are still generated for compatibility but are not the current reader's study path.

Word resources are limited to 30,000 compressed bytes and 256 KiB decoded; translation ranges have a 30,000-byte gzip budget and lexicon shards a 35,000-byte gzip budget. The decoder checks the gzip signature because hosting may already have decoded the response. Compressed responses use the browser's native `DecompressionStream("gzip")`, with bounded reads before and after decompression. For compressed responses, browsers without it show an update-browser message for words while translations remain available. [Canonical study data](../data/study/CANONICAL.md) documents source pins, regeneration, exact coverage, reviewed exceptions, and publication budgets.

The Greek list shows key words only: nouns, verbs, adjectives and interjections, each Greek word once per verse, as Arabic ← Greek with transliteration and gloss. Articles, pronouns, prepositions, conjunctions, particles and adverbs stay in the data but are not listed. Hebrew/Aramaic lists retain all meaningful source elements, including prefixes and suffixes. Consecutive elements sharing a verified Arabic span are grouped; words without a verified span still display their original form and gloss without an invented Arabic mapping. Original words have their own language and text direction.

Closed sheets keep only their native dialog shell mounted. Their content mounts on opening and stays mounted through the exit animation. Opening takes 150ms and closing takes 100ms, with animation completion and a CSS-duration fallback coordinating queued actions. Reduced motion closes immediately. Scripture and font-size changes are not animated.

## AI explanations (optional)

Off by default. With `VITE_AI_PROVIDERS` unset, the build contains no AI code or text. When it is set, the study sheet gets a last collapsed card, «اسأل الذكاء الاصطناعي». The reader chooses «اشرح الآية», «معاني الكلمات» or «الخلفية والسياق», or types a question (3–200 characters). A free model on [OpenRouter](https://openrouter.ai/) then streams a short Arabic answer straight to the browser. There is no backend, and nothing is generated in advance.

### Configuration

| Variable                   | Meaning                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_AI_PROVIDERS`        | `openrouter` enables the card; empty disables it                                                                                                           |
| `VITE_OPENROUTER_API_KEY`  | The key. It is compiled into public JavaScript                                                                                                             |
| `VITE_OPENROUTER_MODELS`   | Up to two `:free` models, comma-separated. Default: `google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free`. `openrouter/free` is always appended last |
| `VITE_AI_DAILY_CAP`        | Answers per device per Cairo day, 1–100 (default 10). Requests, including failed ones, are capped at twice this                                            |
| `VITE_OPENROUTER_BASE_URL` | Optional `https://` endpoint with OpenRouter's API, for a future proxy                                                                                     |

`vite.config.ts` validates these through `src/ai/config.ts` and inlines the result as build constants. An invalid value fails the build, and the app never reads `import.meta.env`. Only zero-priced `:free` models are accepted. `VITE_AI_ALLOW_LOCAL=1` exists only so the browser tests can reach the local stub over `http://127.0.0.1`; never set it in Vercel.

For local testing, put the values in `.env.development.local`. `npm run dev` reads that file, Git ignores it, and `npm run build` does not read it. Never commit a `.env*` file other than `.env.example`.

### Loading

`StudyPanel.tsx` imports the card only when `__AI_ENABLED__` is true; otherwise Rollup drops it. The `AiPanel-*` chunk (interface, chip labels, cache, formatting) loads when the card first opens. The `run-*` chunk (prompt, streaming, the provider and the key) loads on the first request that the on-device cache cannot answer. That request also loads the canonical translation range and, for «معاني الكلمات» and typed questions, the word range and shared lexicon shards, through the same caches as the study sections. Study context is optional: a failed resource does not prevent a request using the remaining material. «إيقاف» takes effect at once, even while these are still loading, and a daily attempt counts only once the request is actually sent. The main `index-*` chunk is the same either way.

### What is sent

Each request is one POST to `/chat/completions`. It carries:

- a fixed system prompt;
- the reference and section heading;
- the verse and up to three verses either side, in Van Dyck without diacritics;
- the verse in كتاب الحياة and the KJV;
- the original Greek, Hebrew, or Aramaic words with their glosses, for «معاني الكلمات» and typed questions, plus available Greek lexicon definitions (references removed) for «معاني الكلمات» only; TBESH definitions are excluded from the data;
- the task, or the reader's question.

It never carries the reader's name, plan day, dates or progress. The headers are the key, `HTTP-Referer` (the site origin), `X-OpenRouter-Title: Bible150` and `X-OpenRouter-App-Visibility: hidden`, and the request sends no cookies.

OpenRouter sees the reader's IP address. Free-model providers may keep prompts and train on them. Readers accept a one-time notice before their first request.

### Limits and on-device data

- **The free allowance belongs to the OpenRouter account, so every reader shares it.** It is 20 requests a minute and 50 a day, rising to 1,000 a day after a one-time purchase of at least $10. It resets at 00:00 UTC. A group that taps the card together, for example during a meeting, can hit the per-minute limit. Those readers see «الخدمة مشغولة الآن» and can retry after 30 seconds to about a minute (OpenRouter's reset time, bounded in case the phone's clock is wrong). When the daily allowance runs out, everyone sees «انتهت حصة الخدمة المشتركة اليوم».
- **The key is public and cannot be restricted to this site.** Anyone who copies it can use up the shared allowance until the key is rotated. Only a server could prevent this. The checklist below keeps spending at $0 and the models free.
- **Each device has its own daily caps:** 10 answers and 20 requests by default. Chip answers are cached on the device (`nt-ai-cache-v1`, at most 60 answers); typed questions are not cached. Usage is stored in `nt-ai-usage-v1`. The feature is on by default; its notes, data-sharing details and remaining count sit behind the card's «التفاصيل والإعدادات» link. «إيقاف الميزة ومسح بياناتها» there removes the cache and sets `nt-ai-off-v1` until the reader taps «تشغيل الميزة». None of these keys are part of progress backups. If the browser blocks storage, counts and the off switch last until the page reloads, so the caps still apply.
- **Errors use fixed Arabic messages.** Server error text is never shown.

When the prompt, chips or models change, bump `PROMPT_VERSION` in `src/ai/chips.ts` so cached answers are dropped. When what is sent, or who receives it, changes, update the details text in `src/study/AiPanel.tsx` and the About page.

### Owner checklist

1. **Create a dedicated OpenRouter account** for the app: no BYOK, auto top-up off, no saved card. Never put a management key in the app.
2. **Set the privacy settings.** Allow free endpoints that may train on inputs; otherwise the free models are filtered out. Keep prompt publishing and OpenRouter's own input logging off.
3. **Create a key named `bible150-web`:**
   - a credit limit of **$0**. If $0 also blocks free models, use $0.01 with a daily reset;
   - an expiry about 12 months out, with a reminder two weeks before;
   - a guardrail that allows only the configured models and `openrouter/free`.
4. **Check the key from a terminal**, never in a chat or a commit. Use the app's exact request body:

   ```sh
   read -rs KEY   # paste the key; it is not echoed or saved in history
   curl -sSN https://openrouter.ai/api/v1/chat/completions \
     -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     -H "HTTP-Referer: https://chronosbible.com/" -H "X-OpenRouter-Title: ChronosBible" \
     -H "X-OpenRouter-App-Visibility: hidden" \
     -d '{"models":["google/gemma-4-31b-it:free","google/gemma-4-26b-a4b-it:free","openrouter/free"],"messages":[{"role":"user","content":"اشرح يوحنا 3:16 في جملتين."}],"stream":true,"max_tokens":2000,"temperature":0.3,"reasoning":{"exclude":true}}'
   curl -sS https://openrouter.ai/api/v1/key -H "Authorization: Bearer $KEY"
   ```

   Keep all three attribution headers on every manual request: the first request with the site's `HTTP-Referer` creates the app's OpenRouter entry, and its visibility is set then. The stream should name a `"model"` in each chunk. Also confirm that:
   - `"models":["openrouter/free"]` on its own answers;
   - a paid model returns 402;
   - a free model outside the guardrail returns 403.

   The `/key` response shows the limit and `free_model_daily_requests`.

5. **Optionally buy $10 of credit once**, which raises the daily allowance to 1,000, then remove the card.
6. **Try the feature locally.** With the key in `.env.development.local`, run `npm run dev` and try about ten verses with each chip and a few questions. Ask church leadership to review sample answers, and run `npm run ai:models`. It reads the same variables as the build, from the production env files, then the development ones; values that exist only in Vercel can be passed in the shell, e.g. `VITE_OPENROUTER_MODELS=a:free,b:free npm run ai:models`. It never needs or sends the key.
7. **Turn it on in Vercel.** In Project → Settings → Environment Variables, set `VITE_AI_PROVIDERS=openrouter` and `VITE_OPENROUTER_API_KEY` for **Production only**, then redeploy. The variables are read at build time.
8. **Test on a real phone.** The next day, check `/api/v1/key` again to confirm the key is still active.
9. **Every week,** review the activity page and run `npm run ai:models`. Free models are renamed and retired.

**Rotate the key:** create a new key, update the Vercel variable, redeploy, then delete the old key.

**Kill switch:** remove `VITE_AI_PROVIDERS` in Vercel and redeploy. The card disappears.

**Cloudflare:** production never enables AI. The dev Worker (dev.chronosbible.com) can, through its Workers Builds build variables; see [AI on the dev Worker](#ai-on-the-dev-worker).

### Tests

`tests/ai-*.test.ts` cover:

- the configuration rules;
- SSE parsing;
- the provider's requests and errors;
- the fallback chain and its timeouts;
- the prompt;
- answer formatting;
- the cache, including the session fallback when storage is blocked;
- the request path in `run.ts` (which study files load, stopping before anything is sent);
- static rules: no `import.meta.env`, no HTML injection, and the key confined to `run.ts`.

The `ai-chromium` Playwright project builds `dist-ai/` with a dummy key and serves it on port 4174. It runs `tests/browser/ai.spec.ts` against `scripts/sse-stub.mjs`, a scriptable local stand-in for the streaming API on port 4175. No test reaches OpenRouter, and CI needs no secrets.

## Static hosting

On Vercel, import the repository, use the **Vite** preset, build with **`npm run build`**, and publish **`dist`**. `vercel.json` records these settings. Pushes to the connected production branch redeploy automatically. There are no `/api` routes or database environment variables; the optional AI explanations use only the build-time variables described above.

### Cloudflare

Cloudflare serves two independent Workers from the same explicit `wrangler.json`:

| Git branch | Worker             | Custom domain          | Deploy command                |
| ---------- | ------------------ | ---------------------- | ----------------------------- |
| `main`     | `chronosbible`     | `chronosbible.com`     | `npm run app:host:deploy`     |
| `dev`      | `chronosbible-dev` | `dev.chronosbible.com` | `npm run app:host:deploy:dev` |

Both environments build the same way from their own branch, using that
branch's full-Bible content and audio publication inventory. The chapter-audio
flag is enabled whenever the branch's Vite configuration supports it. These
hosting scripts do not copy content between branches. Vercel continues using
`npm run build` and its existing configuration.

Use Node 22 and install the locked app dependencies with `npm ci --ignore-scripts`.
Run from the repository root of a clean checkout on the target branch. A detached
checkout is accepted only at the exact `origin/main` or `origin/dev` commit for
that environment. Task branches and dirty checkouts fail before building or
uploading. Workers Builds branch and commit metadata must also match when set.
Workers Builds checks out the pushed commit detached without remote branches, so
the wrapper also accepts it when `WORKERS_CI_BRANCH` and `WORKERS_CI_COMMIT_SHA`
name the environment's branch and that exact commit.
For a local check, use `node scripts/cloudflare-app.mjs preflight production`
(or `dev`); `npm run app:host:build` and `npm run app:host:build:dev` build and audit
without uploading.

Provision Wrangler separately without changing the app lockfile, for example:

```sh
CF_CLI_DIR="$(mktemp -d)"
npm install --prefix "$CF_CLI_DIR" --no-save --package-lock=false --ignore-scripts wrangler@4.149.0
export CLOUDFLARE_APP_WRANGLER="$CF_CLI_DIR/node_modules/.bin/wrangler"
```

The wrapper
uses `node_modules/.bin/wrangler`, or the absolute executable path provided in
`CLOUDFLARE_APP_WRANGLER`. It never installs a CLI. Every deploy supplies an absolute
`--config` path and an explicit `--env` (empty for production, `dev` for development),
so Wrangler cannot discover another project or generate hosting configuration.
Do not replace these commands with a bare `wrangler deploy`.

The safe build rejects local `.env*` files except the committed `.env.example`,
and rejects `.dev.vars*` files, even when Git ignores them. Vite's configuration
calls `loadEnv(mode, process.cwd(), "VITE_")`: production builds normally read
`.env`, `.env.local`, `.env.production` and `.env.production.local`, and shell
`VITE_*` values take priority. Therefore the Cloudflare build also uses a small
environment allowlist and supplies its public settings explicitly:
`VITE_AUDIO_BASE_URL=https://audio.chronosbible.com`, AI disabled, no API key, and the branch-specific audio
flag. Do not add other private `VITE_*` values to Cloudflare build settings.
AI is always disabled on the production Worker, whatever the shell sets. The
**dev Worker only** may enable it; see [AI on the dev Worker](#ai-on-the-dev-worker).

#### AI on the dev Worker

To try the AI explanations on dev.chronosbible.com, set these **build
variables** on the `chronosbible-dev` Worker in Workers Builds (Settings →
Builds → Variables and secrets), then redeploy:

| Variable                  | Notes                                                                |
| ------------------------- | -------------------------------------------------------------------- |
| `VITE_AI_PROVIDERS`       | `openrouter` turns AI on; empty or unset keeps it off                |
| `VITE_OPENROUTER_API_KEY` | Add it as a **secret**. Use the dedicated key with a $0 credit limit |
| `VITE_OPENROUTER_MODELS`  | Optional, up to two `:free` models                                   |
| `VITE_AI_DAILY_CAP`       | Optional, 1-100                                                      |

The build wrapper passes only these four values through, and only for `dev`
when `VITE_AI_PROVIDERS` is set. It never passes `VITE_OPENROUTER_BASE_URL` or
`VITE_AI_ALLOW_LOCAL`, which exist for tests. The asset audit then allows AI
chunks and that exact key value; any other `sk-or-v1-...` string, private key
or secret-looking environment value still fails the build. The build ends with
`Cloudflare dev: assets verified; AI enabled (openrouter).` or `...; AI disabled.`
Production keeps failing on AI chunks and on any key.

Only free models are accepted (see [AI explanations](#ai-explanations-optional)), and the
key must be a dedicated OpenRouter key with a $0 credit limit. It is compiled
into the dev site's public JavaScript by design, so anyone can read it.

**Kill switch:** remove `VITE_AI_PROVIDERS` from the dev Worker's build
variables and redeploy. The next build contains no AI code.

Before building, the wrapper scans both `public/` and any existing `dist/` for
media binaries, symlinks, environment files, private-key files and credentials.
Only ordinary web asset extensions are accepted, and `audio/` accepts JSON
manifests only. Budgets are 8 MiB per file, 64 MiB total and 10,000 files, allowing
the full Bible while rejecting accidental bulk uploads.
It removes only this checkout's `dist/`, runs the normal data-generation and Vite
build, copies `hosting/cloudflare-app/_headers`, and audits the output again.
Unexpected media or credentials fail with redacted messages; local recordings
are never deleted. An existing contaminated `dist/` must be investigated and
removed explicitly before retrying. The build environment excludes fixture
switches and arbitrary inherited `VITE_*` values.

For Git auto-deploys with [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/),
connect **each Worker separately** to the repository. Set its production branch
to the corresponding table entry (`main` for `chronosbible`, `dev` for
`chronosbible-dev`), root directory to `/` (the repository root), and disable
preview builds. Set the build environment variable `NODE_VERSION` to `22`.
Preview builds are configured on each Worker's **Settings → Builds → Previews
Base** tab; leave **Disable builds** on the **Production** tab off. If
`chronosbible` still builds other branches, every `dev` commit gets a failing
"Workers Builds: chronosbible" check: the wrapper refuses to deploy production
from `dev`, so nothing ships, but the check stays red.

Use this **build command** for both Workers to provision the pinned CLI outside
the checkout without changing its dependencies or lockfile:

```sh
npm install --prefix /tmp/chronos-cli --no-save --package-lock=false wrangler@4.149.0
```

For `chronosbible`, use this **deploy command**:

```sh
CLOUDFLARE_APP_WRANGLER=/tmp/chronos-cli/node_modules/.bin/wrangler npm run app:host:deploy
```

For `chronosbible-dev`, use this **deploy command**:

```sh
CLOUDFLARE_APP_WRANGLER=/tmp/chronos-cli/node_modules/.bin/wrangler npm run app:host:deploy:dev
```

Wrangler runs the selected environment's safe app build before uploading.
Pushes to `main` update the production domain, and pushes to `dev` update the
development domain.
See [build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
for dependency installation and build-variable settings. Connecting these builds
and assigning the custom domains is a one-time Cloudflare account setup step.

The app is assets-only: no Worker code runs, and `wrangler.json` has neither
`main` nor an asset binding. `_headers` and `_redirects` exist only in the
Cloudflare build; `_headers` makes `/assets/*` immutable, and `_redirects` sends
old `/audio/days/*`, `/audio/chapters/assets/*` and `/audio/clips/*` URLs to the
same paths on `https://audio.chronosbible.com` with a `301` (`vercel.json` does
the same on Vercel). The safe build refuses a `_redirects` that differs from
the committed file. Workers URLs and preview URLs are off.

Cloudflare builds load audio from that origin: the R2 bucket `chronosbible-audio`,
served read-only on a public custom domain with a Cache Rule for that hostname.
R2 is the only audio host; the `bible-reading-audio` Pages project is retired.
Publishing recordings is described in `docs/audio.md`.

Reader progress is stored per origin, so the production, development and Vercel
sites have independent progress. Use backup and restore when moving between them.

Study data is generated the same way into `public/study/` and served with the same revalidating cache header. Nothing under `/study/` loads until a reader opens a verse.

If the app shows **تعذر تحميل القراءة**, verify that `/readings/plan.json` and `/readings/1.json` return JSON. The build must run `npm run build`, which invokes `prebuild` (`scripts/build-data.js`); running `vite build` directly skips the data generation step.

## Source regeneration

The supplied `New_Testament_150_Day_Arabic.docx` controls passage order. The original table is retained in `data/source-plan.json`; the importer normalizes the document's reversed RTL reference notation.

```sh
python3 scripts/extract-plan.py /path/to/New_Testament_150_Day_Arabic.docx
curl -L --fail https://ebible.org/Scriptures/arb-vd_usfm.zip -o /tmp/arb-vd.zip
python3 scripts/import.py /tmp/arb-vd.zip
npm run validate
```

Expected coverage: **150 days, 537 passages, 7,966 verse occurrences, 7,959 unique verses, all 27 New Testament books and 260 chapters**. Seven repeated verses in the original plan are intentional. Never remove repeats or reorder passages merely to simplify data.

### Study data regeneration

For full-Bible study, follow [Canonical study data](../data/study/CANONICAL.md): the pinned importer adds OT word tags, Hebrew/Aramaic lemma/gloss metadata, and full-Bible translations to the existing NT inputs. Ordinary builds verify committed source and Bible checksums and publish bounded canonical ranges and shared lexicon shards without source downloads or Python. TBESH definitions are excluded.

The following procedure regenerates the legacy NT inputs and daily resources, which remain compatibility outputs. Download the sources into a new, empty directory outside the repository and run the importer with isolated Python (standard library only):

```sh
S=/path/to/empty/sources
STEP=https://raw.githubusercontent.com/STEPBible/STEPBible-Data/1f3423d42400f59f1f30fe08f74e38fcd3bbf7bc
curl -L --fail https://ebible.org/Scriptures/arb-vd_usfm.zip -o "$S/arb-vd.zip"
curl -L --fail https://ebible.org/Scriptures/arbnav_usfm.zip -o "$S/arbnav.zip"
curl -L --fail https://ebible.org/Scriptures/eng-kjv_usfm.zip -o "$S/eng-kjv.zip"
curl -L --fail "$STEP/Tagged-Bibles/Arabic%20Bibles/TTAraSVD%20-%20Translation%20Tags%20for%20Arabic%20SVD%20-%20STEPBible.org%20CC%20BY-SA_NT_4_0_1.txt" -o "$S/ttarasvd-nt.txt"
curl -L --fail "$STEP/Lexicons/TBESG%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Greek%20-%20STEPBible.org%20CC%20BY.txt" -o "$S/tbesg.txt"
python3 -I scripts/import-study.py --vd "$S/arb-vd.zip" --nav "$S/arbnav.zip" --kjv "$S/eng-kjv.zip" --tbesg "$S/tbesg.txt" --ttarasvd "$S/ttarasvd-nt.txt"
npm run validate
```

The importer fails unless at least 99.5% of NT verses have Textus Receptus Greek, 97% align to Van Dyck word positions, at most 0.5% of tokens miss the lexicon, NAV covers 98% and the KJV 99.5% of verses, and every book code is known. Expected coverage line:

> 7959 NT verses; 7959 with Greek (100.00%); 140993 TR tokens; aligned 99.56%; lexicon 5675 entries (0 token misses); NAV 99.97%; KJV 99.97%

`build-study.js` shortens per-day lexicon definitions to **160** characters so the busiest day stays within gzip budgets of 30KB (core), 30KB (translations) and 35KB (lexicon); full 400-character definitions did not fit.

To regenerate committed font and logo assets, install Python packages `fonttools brotli pillow` and run `python3 scripts/optimize-assets.py`. Production deployment does not require Python. Original fonts and logo sources are preserved; license texts are bundled under `public/fonts/`.

The Bible favicon is drawn in `src/assets/favicon.svg`. Edit that vector source and run `npm run icons:build` to export its 32px PNG fallback (requires the installed Playwright Chromium browser). The church logo regeneration script handles only the church artwork.

## Verification baseline

The mobile redesign was checked at 320, 360, 390, and 430px, landscape, dark/light themes, 38px text, and narrow reflow. At 390×844 the first verse starts at approximately **162px**. Browser coverage uses Chromium and mobile WebKit emulation; it is not a claim of physical-device testing.

Three identically throttled mobile Lighthouse runs before/after the redesign produced median performance scores **82 → 87**, LCP **3,754 → 3,693ms**, and CLS **0.154 → 0.082**, with accessibility **100**. These are local measurements rather than guaranteed scores on every device. Re-run the audit when changes affect initial rendering or assets.

The subsequent repository refactor and About addition were compared against release `e5204db` with three runs per build under identical throttling: median performance **87 → 87**, accessibility **100 → 100**, LCP **3,680 → 3,678ms**, and CLS **0.08646 → 0.08646**. Initial transfer increased by about 0.3KB. The README images are documentation-only and do not load in the app.

The focused responsiveness pass was compared against `781e060`, with three runs per build under the same mobile Lighthouse throttling: median performance **87 → 88**, accessibility **100 → 100**, LCP **3,678 → 3,604ms**, CLS **0.08646 → 0.08646**, and total transfer **525.2 → 501.8KB**, including speculative reading requests. The hidden 192px menu logo no longer loads before opening the menu. In three separate Chromium mobile runs with 150ms network latency and 200,000 bytes/s download throughput, tapping Next after a 1.5s settling period took a median **183.6 → 7.5ms** to paint the next reading. The prefetched reading showed no loading placeholder. These are controlled local measurements, not guarantees for every connection or device.

The verse study panel was compared against `81c73c4` with six runs per build (two rounds of three) under the same mobile Lighthouse throttling: median performance **91.5 → 91**, accessibility **100 → 100**, LCP **3,080 → 3,154ms**, CLS **0.08742 → 0.08742**, and total transfer **490.8 → 491.6KB**. Simulated LCP took only two values in both builds, about 3,005 or 3,155ms (one round trip apart); the baseline landed on the higher value in 3 of 6 runs and the new build in 5 of 6. Initial JavaScript grew by **0.72KB** and CSS by **0.09KB** gzipped; study code (3.4KB) and styles (0.7KB) load only after a reader first presses the text. The first verse still starts at about **162px** at 390×844.

At the original NT study release, optional AI explanations left the default build's sizes unchanged: `index` 82.0KB and `StudyPanel` 3.7KB gzipped, with no AI chunks or text. In an AI build, `StudyPanel` grows by 0.5KB. The card's own chunk (`AiPanel`, 6.2KB plus 0.65KB CSS) loads when the card first opens, and the request chunk (`run`, 5.2KB) loads on the first request. Lighthouse was not re-run, because nothing that loads before a reader opens a verse changed.

Reading streaks and the plan day grid were compared against `dev` (`3d0b296`) with nine runs per build (three rounds of three) under the same mobile Lighthouse throttling: median performance **92 → 92**, accessibility **100 → 100**, LCP **3,154 → 3,155ms**, CLS **0.00105 → 0.00105**, and total transfer **505.9 → 506.4KB**. Simulated LCP again took about 3,005, 3,155 or 3,680–3,760ms; the baseline landed on the slow values in 3 of 9 runs and the new build in 4 of 9. Initial JavaScript grew by **0.49KB** and CSS by **0.06KB** gzipped, within the snapshot budget with about 20 bytes to spare. The streak UI (2.5KB plus 1.1KB CSS) and day grid (0.9KB plus 0.6KB CSS) load on demand.
