# Review brief: smoother reading, listening and an installable offline app

> **Self-contained handoff.** It is written for the agent (or person) that reviews branch `feature/reading-listening-offline` on a Mac before it is merged into `dev`, with no access to the conversation that produced it. Pull request: [#15](https://github.com/albert429/ChronosBible/pull/15) (it replaces #14, whose branch `ccr-fa653d74-es5uyj` holds an older copy of the first two commits and can be deleted). Repo rules in `AGENTS.md` and `CONTRIBUTING.md` apply.

## 1. What changed

Focused commits on top of `dev` (`aa4f366`), each with its tests and documentation:

| Commit                                                                                           | User-facing change                                                                                                                                                                                                                                                                                                                                                                    | Main files                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0cb6667` **A** Page through readings by swipe, keys and a next button, and resume places        | Arrow keys (left = next, as the toolbar), a quick horizontal swipe over the text (rightward = next), «التالي: …» under every reading (primary once done; never completes anything). Readings reopen at the verse they were left at (launch, Back/Forward, reader and mode switches). Page title names the reading; linked verses are marked; copy/share a verse from its study sheet. | `src/navigation/adjacent.ts`, `src/reader/{Reader,CompletionBar,useSwipePaging,useReadingLocation,scriptureDom,location}.ts(x)`, `src/study/{VerseStudy,VerseActions}.tsx`, `tests/browser/reading-flow.spec.ts`  |
| `a07b743` **B** Follow the device theme and scale verse numbers with the reading text            | «تلقائي» theme following the device live (default unless a reader chose dark before); verse numbers, headings and titles scale with text size; 24×24px verse-number targets; study sheet follows text size and diacritics; toast above the player; no desktop layout shift under dialogs; day-count plurals and backup hint fixed.                                                    | `src/navigation/{appearance.ts,AppearancePanel.tsx}`, `index.html` (pre-paint theme), `src/reader/Scripture.css`, `src/lib/format.ts`, `tests/browser/layout.spec.ts`                                             |
| `0950739` **C** Cache Scripture data for good and fetch the first reading with the page          | Data files carry their folder's content hash (`?v=`) and are served `immutable` (Cloudflare `_headers`, `vercel.json`); the next launch preloads the open reading from `index.html` alongside the JS; lazy day/picker/settings sheets; less render and storage work.                                                                                                                  | `vite.config.ts` (`dataVersions`), `src/lib/dataVersion.ts`, `src/reader/preload.ts`, `src/navigation/Navigation.tsx`, `src/plan/progress.ts`, hosting files, `tests/browser/loading.spec.ts`                     |
| `0d21ea2` **D** Let listeners choose what follows a recording, seek, and keep reading            | «عند الانتهاء» in the player: stop / continue to the next day, chapter or chronological reading / repeat. Seek slider with times, saved speed in Arabic digits, close button. Reading settings and study sheets no longer pause audio. «هل أتممت هذه القراءة؟» after a recording ends with stop. Autoplay-blocked hint, lock-screen ±10 s, hand-scroll pause of follow-along.         | `src/audio/{endAction,AudioControls,AudioPlayer,useMediaElement,useVerseHighlight,usePauseOnDialog,useMediaSession,speed}.ts(x)`, `docs/audio.md`, audio specs                                                    |
| `0930a74` **E** Install the app and keep Scripture for reading offline                           | Web manifest and icons; a service worker (`/sw.js`) that opens the app offline and keeps every reading opened; the menu's «القراءة دون اتصال وتثبيت التطبيق» saves all text (1,895 files) or study notes (450 files), offers the install prompt (iOS: instructions), and shows storage use; «تحديث جديد متاح» for new builds.                                                         | `src/pwa/*`, `vite.config.ts` (`serviceWorker` plugin), `public/manifest.json`, `public/icons/`, `scripts/export-favicon.mjs`, `playwright.config.ts`, `tests/browser/offline.spec.ts`, `tests/pwa-rules.test.ts` |
| `12c456b` **F** Keep the new features out of the first download                                  | No visible change: the study sheet, the end-of-recording choice, the preload memory, worker registration and its update notice, and two label helpers load only when needed.                                                                                                                                                                                                          | `src/study/load.ts`, `src/audio/clock.ts`, `src/lib/days.ts`, `src/pwa/UpdateNotice.tsx`, `src/main.tsx`                                                                                                          |
| `fbd1745`, `e54e22e` **G** Keep worker registration and the preload list out of the first screen | No visible change: both wait until the page has settled, so the first screen's requests match `aa4f366` again (Lighthouse had counted them into LCP). The preload list records whatever is shown when it runs; registration tolerates browsers that block workers.                                                                                                                    | `src/lib/afterStartup.ts`, `src/main.tsx`, `src/App.tsx`, `src/pwa/register.ts`                                                                                                                                   |

Final decisions (agreed with the owner; do not reopen them in review): completion stays explicit; the progress/backup schema is unchanged (new state lives in its own keys: `bible-reader-scroll-v1`, `bible-reader-preload-v1`, `bible-reader-audio-rate-v1`, `bible-reader-audio-repeat-v1`, `word-theme`); Amiri Bold stays; offline covers text and study notes, not audio.

## 2. Deliberate deviations from the original plan

- **Re-choosing the open reading** replaces its history entry but still restarts it and stops playback: `bible-audio.spec.ts` requires a manual re-selection to stop audio.
- **«مشاركة التطبيق»** still shares the bare app address (a tested contract in `tests/share.test.ts`); sharing a place is done per verse instead.
- **Live regions and paging focus** were left as they were: many specs use strict `getByRole("status")`, so permanently mounted status regions would break them. Toolbar paging still moves focus to `<main>`.
- **Calendar and day-grid labels** were kept; their wording is contextual.
- **The menu sheet stays in the main bundle** so it opens complete from the keyboard (the day, Bible-picker and settings sheets are lazy, warmed on idle, press and focus).
- **The seek slider** replaced the planned ±15 s buttons for chapter-timed recordings.
- **The dialog observer** in `usePauseOnDialog` was kept, filtered to dialogs without `data-keeps-audio`.
- **Follow-along** resumes on any seek, so the existing "tracking stays on after scrolling, then seeking" spec still holds.

## 3. Verified in the cloud session

- `npm run validate` steps: Prettier, ESLint (0 errors), `tsc -b`, `npm test` (270 unit tests), `npm run build`.
- Chromium Playwright suite (112 tests) on the fixture build (`AUDIO_TEST_FIXTURES=1 VITE_AUDIO_BASE_URL=https://audio.example.test VITE_AUDIO_CHAPTERS_ENABLED=true`), all passing after each commit, including the new `reading-flow`, `offline`, appearance, preload and listening tests.
- The Cloudflare asset audit (`scanAssets` from `scripts/cloudflare-app.mjs`) on the built `dist/` with `_headers` and `_redirects`: passed (about 4,300 files, 46 MB).
- Bundle and Lighthouse numbers against `aa4f366`: see §6.

**Not verified there:** mobile WebKit (not installed), physical devices, real CDN headers, and screenshots for the PR.

## 4. Handoff tasks on the Mac

Work in a fresh checkout (`git fetch origin && git switch feature/reading-listening-offline`) with Node 22. Record each result in the PR (a short checklist comment), attaching screenshots where asked.

1. **Full local checks.** `npm ci`, then `npm run validate`. Pass: no errors.
2. **Both browser projects.** `npx playwright install chromium webkit`, then `PW_PORT=4400 npm run test:e2e`. Pass: Chromium and **mobile WebKit** green (WebKit was never run in the cloud; if a WebKit-only failure appears, check swipe (`useSwipePaging`), the seek slider and the auto theme first). `offline.spec.ts` skips WebKit by design.
3. **iPhone, Safari** (LAN: `npm run build && npm start -- --host`, or the dev preview after deploying):
   - swipe left/right over the text turns pages; an edge swipe still goes Back; selecting text and pinch-zoomed panning never turn pages;
   - leave a long chapter (Psalm 119) mid-way, kill the tab, reopen: same verse at the top;
   - Settings → «تلقائي», then switch the phone between light and dark: the app follows;
   - tap a verse → «نسخ الآية» / «مشاركة» work;
   - listening: «عند الانتهاء» repeat and «متابعة» across two plan days with the screen locked; lock-screen ±10 s; the «اضغط زر التشغيل» hint when Safari blocks autoplay;
   - Share → Add to Home Screen; open it in airplane mode after one online launch: the app and already-opened readings load.
4. **Android, Chrome:** «تثبيت التطبيق» shows the install dialog; save «نص الكتاب المقدس» and «ملاحظات الدراسة» (progress, cancel, resume), then airplane mode: any chapter, plan day and chronology reading opens, and verse study works. Deploy a trivial change to the dev preview: «تحديث جديد متاح» appears and «تحديث» reloads into it.
5. **Desktop Safari and Chrome:** arrow keys page; opening any sheet does not shift the page sideways.
6. **Visual pass and PR screenshots:** 320, 360, 390 and 430 px; light, dark and auto; 38 px text; reduced motion. Check the two-row player, the completion bar's «التالي» and the offline section. Use `npm run test:visual` (`scripts/capture-preview.mjs`) or device screenshots, and attach phone screenshots to the PR (the template requires them for visual changes).
7. **Performance:** build `aa4f366` into a separate folder and serve both builds (`npx vite preview --outDir <baseline> --port 4600`, `npm start`), then `BASELINE_URL=http://127.0.0.1:4600 npm run audit:performance`. Pass: median performance and LCP no worse than the baseline, CLS unchanged, accessibility 100. Update §6 and `docs/development.md` if the numbers differ materially.
8. **Hosting smoke test** on `dev.chronosbible.com` after `npm run app:host:deploy:dev` from `dev` (or a Workers preview): `curl -sI` a `/bible/GEN/1.json?v=…` URL shows `Cache-Control: public, max-age=31536000, immutable`; `/`, `/index.html` and `/sw.js` show `max-age=0, must-revalidate`; `/manifest.json` is served as JSON.

## 5. Merge checklist

- Everything in §4 passes, or each exception is explained in the PR.
- The owner ticks the DCO/licensing box in the PR description (commits are signed off as `albert429`).
- Mark the PR ready for review and merge it into **`dev`**, never `main`.
- Delete the superseded branch `ccr-fa653d74-es5uyj`.

## 6. Measurements and known risks

Measurements in the cloud session (local `vite preview` builds of `aa4f366` and this branch; details in `docs/development.md`, "Verification baseline"):

| Measure                                                                 | `aa4f366`     | This branch                      |
| ----------------------------------------------------------------------- | ------------- | -------------------------------- |
| Lighthouse mobile performance (median of 9)                             | 89            | 88                               |
| Lighthouse simulated LCP (median of 9)                                  | 3,606 ms      | 3,679 ms (3,606 without preload) |
| Lighthouse CLS / accessibility                                          | 0.00105 / 100 | 0.00106 / 100                    |
| Measured LCP, first visit (7 fresh loads, 150 ms RTT, 1.6 Mbps, 4× CPU) | 2,312 ms      | 2,148–2,220 ms                   |
| Measured LCP, return visit                                              | 736 ms        | 352 ms (from the worker)         |
| Initial JS / CSS gzip                                                   | 96.9 / 4.5 KB | 98.1 / 4.2 KB                    |

The simulated LCP and the measured LCP disagree about the inline first-reading preload (`index.html`): Lighthouse's model charges it for sharing bandwidth with the script, while applied throttling shows the text arriving about 100–170 ms sooner. It was kept. Re-check on a real phone (§4.7); if a physical device agrees with the simulation, removing that one inline script restores 3,606 ms without affecting anything else.

Risks to keep an eye on:

- **Stale data after a deploy** is prevented by `?v=` versions; the only window is an old tab or an old installed build fetching new files under its old version, which is harmless (newer content).
- **Safari evicts** service-worker storage under pressure or after weeks without use; `navigator.storage.persist()` is requested, and opening the app online refills what it reads.
- **Readers who stored the old light default** (`word-dark=false`, written for everyone) now follow the device; anyone who chose dark keeps it.
- **The service worker hides requests from `page.route`**, so Playwright blocks it everywhere except `offline.spec.ts`; new specs that need it must opt in the same way.
