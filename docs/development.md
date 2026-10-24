# Development guide

## Structure

| Path                                               | Responsibility                                                                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`, `src/App.tsx`                      | React bootstrap; app shell wiring reader, plan, navigation, and dialogs                                                    |
| `src/appInfo.ts`                                   | App credits, contact links, and Scripture source                                                                           |
| `src/lib/`                                         | Shared helpers: `jsonClient` (cache, deduplication, timeout), `useResource`, `network`, `format`, `useNotice`, `useToday`  |
| `src/bible/`                                       | Verse and reference parsing shared by reader, study, and audio                                                             |
| `src/plan/`                                        | Plan state: `readings` loading, `progress` profiles, `useProgress`, `schedule`, `backup`, `labels`, `PlanView`, `Calendar` |
| `src/plan/dialogs/`                                | Join, Invite, Settings, and restore dialogs, loaded on demand                                                              |
| `src/reader/`                                      | Reader, Scripture rendering, verse tap handling, completion bar, listen button, adjacent-day prefetch                      |
| `src/navigation/`                                  | Toolbar, menu, day details, appearance panel and preferences, share, About                                                 |
| `src/components/`                                  | Shared UI: native-dialog `Sheet` (`useModalDialog`), `Feedback`, `PassageReference`, `ReactIcon`, form styles              |
| `src/audio/`                                       | Audio player and controls, manifest loading, media element, Media Session, verse highlighting, delivery contract           |
| `src/study/`                                       | Lazy verse study sheet: translations, Greek key words, and AI explanations panel                                           |
| `src/ai/`                                          | AI explanation pipeline: config, prompt, provider chain (`providers/openrouter.ts`), SSE parsing, cache, answer formatting |
| `src/styles/`                                      | Design `tokens.css`, `base.css`, and `global.css`; component CSS sits beside its component                                 |
| `data/`                                            | Canonical Scripture plan, extracted source table, `books.json` (66 books: USFM, OSIS, STEPBible codes with Arabic names)   |
| `data/study/`                                      | Imported study data (CC BY / CC BY-SA; see `data/study/LICENSE.md`)                                                        |
| `data/audio/`                                      | Verse timing alignments and audio sources (see `data/audio/SOURCES.md`)                                                    |
| `scripts/build-data.js`                            | Runs the three builders below into `public/` (`predev`/`prebuild`)                                                         |
| `scripts/build-{readings,study,audio-index}.js`    | Split plan, study data, and audio manifests into static JSON, with budgets; `scripts/lib/books.js` is shared               |
| `scripts/import*.py`, `extract-plan.py`, `usfm.py` | Source extraction and importers, with coverage gates                                                                       |
| `scripts/{align,build}-audio.py`, `audio_text.py`  | Audio alignment and build; `scripts/tests/` holds Python tests for `audio_text.py`                                         |
| `scripts/{prepare,verify}-audio-host.*`            | Prepare and verify the static audio host                                                                                   |
| `scripts/snapshot.mjs`                             | Build-output snapshot and compare tool (`npm run snapshot`)                                                                |
| `scripts/`                                         | Also: asset regeneration, AI model check, SSE stub, visual and performance checks                                          |
| `tests/`                                           | Unit/data checks; `tests/browser/` holds mobile browser workflows                                                          |
| `docs/assets/`                                     | README artwork and actual app screenshot; never shipped in the app                                                         |

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
| `npm run audio:host:prepare`                       | Build the Cloudflare Pages audio bundle in `artifacts/pages-audio`                       |
| `npm run audio:host:deploy`                        | Prepare, then deploy that bundle with wrangler                                           |
| `npm run app:host:deploy`                          | Build, then deploy the app to Cloudflare Workers with wrangler                           |
| `npm run validate`                                 | Formatting, lint, type-check, unit/data checks, and build                                |
| `python3 -I -m unittest discover -s scripts/tests` | Python audio hash tests (standard library only; CI also runs `py_compile`)               |
| `npm run test:visual`                              | Save preview screenshots under `artifacts/`                                              |
| `npm run audit:performance`                        | Save repeatable mobile Lighthouse reports under `artifacts/`                             |

`tsconfig.json` only references `tsconfig.app.json` (`src/`), `tsconfig.node.json` (`vite.config.ts`, `playwright.config.ts`, the unit tests in `tests/*.test.ts` and `tests/browser/`, strict) and `tsconfig.scripts.json` (`scripts/` and `hosting/` JavaScript, checked but not strict). `build` checks only the app, so tests and scripts cannot block a deploy.

`npm install` sets `core.hooksPath` to `.githooks/`. `pre-commit` runs Prettier and ESLint on the staged files, then `npm run typecheck`; `pre-push` runs `npm test`. Skip them in an emergency with `--no-verify`.

`npm run test:e2e` builds with `AUDIO_TEST_FIXTURES=1` and `VITE_AUDIO_BASE_URL=https://audio.example.test`, then runs Playwright with the same variables; without them the audio specs fail on a fresh clone. Playwright starts the production preview itself, and the build generates `public/readings/` and `public/study/`, which the separate AI test build (`dist-ai/`, see below) reuses. Outside CI it reuses servers already listening on ports 4173, 4174 and the stub's, so stop a stale `npm start` (or any server serving an old `dist/`) first or the specs run against the old build. Install their browsers with `npx playwright install chromium webkit` (`--with-deps` on Linux). `CHROMIUM_PATH` optionally selects an existing Chromium executable; WebKit uses its own installed browser.

Visual and performance scripts expect a running `npm start`. `BASELINE_URL` optionally adds a baseline site. Compare builds using the same server, throttling, and environment. Reports and traces are ignored by Git.

## State and privacy

`nt-reading-progress-v1` stores profiles, the active reader, personal start dates, and completed days in localStorage. Backup imports create a separate profile. `word-font` and `word-dark` preserve appearance settings. Clearing site data or moving to another browser/domain requires restoring a saved backup to retain progress.

Schedules use Cairo dates. Catch-up and advance reading do not move a reader's start date. Daily JSON is cached in memory during the browser session, with concurrent requests deduplicated; failed requests can be retried. This is not a persistent offline/PWA implementation.

While reading, adjacent days are prepared 500ms after the selected day and its fonts settle. Save-Data and reported slow-2g, 2g, or 3g connections suppress this background work; browsers without connection information allow it. Navigation cancels queued work, while already-started requests remain shared with foreground loading. Speculative failures are silent and do not prevent a later retry.

Tapping a verse opens its study sheet; a text selection, a press longer than 500ms, or a movement over 10px does not. The verse number is a button for keyboard and screen-reader users. The first press on the reading warms the study code chunk (skipped under Save-Data or slow connections); opening a verse fetches that day's `{day}.json`. The sheet shows the verse above two collapsed cards, in this order: «ترجمات أخرى» and «الكلمات اليونانية» (and a third, «اسأل الذكاء الاصطناعي», when the optional AI explanations are enabled). Each card is a heading button with a short hint and, where useful, a count; its content mounts the first time it opens, loading `{day}.tr.json` (New Arabic Version and KJV) for translations, and the sheet scrolls just enough to show it. The study sheet stays mounted after first use.

The Greek list shows key words only: nouns, verbs, adjectives and interjections, each Greek word once per verse, as Arabic ← Greek with transliteration and gloss. Articles, pronouns, prepositions, conjunctions, particles and adverbs stay in the data but are not listed.

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

`StudyPanel.tsx` imports the card only when `__AI_ENABLED__` is true; otherwise Rollup drops it. The `AiPanel-*` chunk (interface, chip labels, cache, formatting) loads when the card first opens. The `run-*` chunk (prompt, streaming, the provider and the key) loads on the first request that the on-device cache cannot answer. That request also loads the day's `{day}.tr.json`, plus `{day}.lex.json` for «معاني الكلمات» and typed questions, through the same cache as the study cards. «إيقاف» takes effect at once, even while these are still loading, and a daily attempt counts only once the request is actually sent. The main `index-*` chunk is the same either way.

### What is sent

Each request is one POST to `/chat/completions`. It carries:

- a fixed system prompt;
- the reference and section heading;
- the verse and up to three verses either side, in Van Dyck without diacritics;
- the verse in كتاب الحياة and the KJV;
- the key Greek words with their lexicon meanings, for «معاني الكلمات» and typed questions, plus lexicon definitions (references removed) for «معاني الكلمات» only;
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
     -H "HTTP-Referer: https://sfk-bible-reading.vercel.app/" -H "X-OpenRouter-Title: Bible150" \
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

`wrangler.json` hosts the same build on Cloudflare Workers static assets at `chronosbible.com`. Deploy with `npm run app:host:deploy`; wrangler runs `VITE_AUDIO_BASE_URL=/ npm run build`, copies `hosting/cloudflare-app/_headers` into `dist/` and uploads it. The build sets `VITE_AUDIO_BASE_URL=/` because the worker provides the same-origin media route; other `VITE_*` values (AI) come from the environment, or from Workers Builds build variables. Run `npm run app:host:deploy` from a clean checkout, because a local build reads `.env.local` and copies any media in `public/audio/`. `_headers` exists only in the Cloudflare build, so Vercel never serves it. It marks `/assets/*` immutable; assets are otherwise revalidated by default, as on Vercel.

Static files are served without running code. Only `/audio/days/*`, `/audio/chapters/assets/*` and `/audio/clips/*` run `hosting/cloudflare-app/worker.js`, which forwards GET and HEAD (with `Range` and conditional headers) to the `bible-reading-audio` Pages project and returns its answer unchanged; other methods get 405. `tests/app-host.test.ts` keeps the routes and origin in step with `vercel.json` and `src/audio/contract.ts`. The Workers URL and preview URLs are off, so there is one origin.

Reader progress is stored per origin. To move a reader from the vercel.app address to `chronosbible.com`, use backup and restore.

For Git auto-deploys, connect the repository in Workers Builds with an empty build command and the deploy command `npx wrangler deploy`; wrangler then runs the build itself.

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

Download the sources into a new, empty directory outside the repository and run the importer with isolated Python (standard library only):

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

The optional AI explanations leave the default build's sizes unchanged: `index` 82.0KB and `StudyPanel` 3.7KB gzipped, with no AI chunks or text. In an AI build, `StudyPanel` grows by 0.5KB. The card's own chunk (`AiPanel`, 6.2KB plus 0.65KB CSS) loads when the card first opens, and the request chunk (`run`, 5.2KB) loads on the first request. Lighthouse was not re-run, because nothing that loads before a reader opens a verse changed.
