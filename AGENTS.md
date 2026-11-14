# Repository Guidelines

## Project Structure & Module Organization

ChronosBible uses feature ownership with a shared pure foundation:

- `src/core/scripture/` and `src/core/reading/` hold shared Scripture and reading
  contracts. Core imports only core and pure `shared/lib` helpers.
- `src/features/<name>/` owns its UI, hooks, adjacent CSS, `domain/` pure logic,
  `data/` network clients, and `tests/`. Feature domain modules import only
  their own domain, core and pure shared helpers. Clients import contracts,
  other clients and `shared/network` transport; never feature UI.
- `src/shared/` holds generic UI, hooks, browser adapters, network transport,
  styles and pure helpers. It never imports features or app code.
- `src/app/` composes features; only `src/main.tsx` imports it.
- `worker/` owns the server runtime and `worker/tests/`. It consumes pure
  contracts, never browser implementation. Browser code never imports Worker code.
- `config/typescript/` contains supporting compiler projects;
  `config/playwright.config.ts` configures browser tests from the repository root.
- `tests/integration/` holds cross-owner contracts, `tests/browser/` holds browser
  workflows, and `tests/fixtures/` holds shared fixtures. Unit tests live beside
  their owner under `tests/`; script Python tests follow the same convention.

The boundary table in `scripts/quality/import-boundaries.mjs` is enforced by
ESLint and `npm run layers`. Its graph separates pure domain, data and UI roles
inside each feature and excludes tests. Physical ownership is checked before
roles, so shared modules cannot import feature contracts or clients. Pure core,
feature domain and shared/lib modules receive browser state and the current
time as inputs; ESLint rejects browser effects and wall-clock reads there.
Deterministic date, URL, text encoding and hashing operations remain allowed.
Cross-feature UI edges are explicit.
Navigation owns the toolbar and sheet coordination; Bible, chronology and plan
own their picker panels. Preserve lazy imports and use direct module imports
without barrels. Node-executed imports use explicit `.ts` extensions.

One reader serves four tracks: the 150-day youth plan (Cairo dates), the full
Bible, and Old/New Testament chronology. The place lives in the query string
(`?day=N`, `?mode=bible&book=GEN&chapter=1`,
`?mode=chronological&testament=OT&reading=<id>`), parsed in
`src/core/reading/location.ts`; there is no path routing. `vite.config.ts` validates
`VITE_*` settings and inlines them as build constants (`__AUDIO_BASE_URL__`,
`__AI_ENABLED__`, …); app code never reads `import.meta.env`, and disabled
features are absent from the bundle.

`data/` holds source data; `scripts/` is grouped by workflow (`build/`, `data/`,
`audio/`, `hosting/`, `assets/`, `quality/`, shared `lib/`) and builds static
JSON into `public/` (`scripts/data/build-data.js` runs in `predev`/`prebuild`; a
bare `vite build` skips it). A few old script paths stay as thin wrappers. Runtime assets live in `src/assets/`; documentation
images belong in `docs/assets/`. See `docs/development.md` for the full
architecture and `docs/audio.md` for the audio pipeline.

## Build, Test, and Development Commands

Use Node.js 22 and `npm ci` for locked dependencies.

- `npm run dev`: generate data and start Vite on port 5173.
- `npm run build`: generate data, type-check, and build `dist/`.
- `npm start`: preview the production build on port 4173.
- `npm run validate`: check formatting, lint, types, unit tests, and build.
- `npm run verify:all`: `validate` in the CI environment, Python tests,
  recursive `py_compile` and the browser tests; honors `PW_PORT`.
- `npm run test:e2e`: build audio fixtures and run Playwright workflows.
- `npm run test:python`: test Python utilities.
- One unit test: `node --experimental-strip-types --test src/features/profiles/tests/progress.test.ts`
  (use the owner’s `tests/` path; `--test-name-pattern` filters).
- One browser spec: export `AUDIO_TEST_FIXTURES=1`,
  `VITE_AUDIO_BASE_URL=https://audio.example.test` and
  `VITE_AUDIO_CHAPTERS_ENABLED=true`, build with
  `node scripts/build/browser-build.mjs app` (what `test:e2e` runs), then
  `npx playwright test --config config/playwright.config.ts tests/browser/<name>.spec.ts --project=chromium`
  (projects: `chromium`, `mobile-webkit`, `ai-chromium`).

Install browser binaries with `npx playwright install chromium webkit`.
Use `PW_PORT=4400 npm run test:e2e` in concurrent worktrees; the next two ports
serve AI tests. Playwright never reuses a server: an occupied port fails the run.

## Coding Style & Naming Conventions

Use strict TypeScript, ES modules, two-space indentation, double quotes, and
semicolons. Prettier enforces 80-column formatting and trailing commas;
`npm run format` applies it. ESLint checks TypeScript and React hooks.
Name components `PascalCase.tsx`, hooks `useSomething.ts`, and helper modules
`camelCase.ts`.

## Testing Guidelines

`npm test` discovers colocated `*.test.ts` suites and central integration tests.
Playwright specs live in `tests/browser/*.spec.ts`, covering Chromium, mobile
WebKit, and axe accessibility checks. Add regression coverage for changed
behavior and preserve exact Scripture-data checks. Storage changes must keep
the `bible-reader-state-v2` migration and backup import tests passing
(`tests/integration/reader-contracts.test.ts`, `src/features/profiles/tests/progress.test.ts`). For UI changes,
verify 320–430px widths, both themes, large Arabic text, focus, and reduced
motion.

## Commit & Pull Request Guidelines

Use concise imperative subjects, following history: “Split the audio player
into focused hooks and controls.” Keep commits focused and sign them off
(`git commit -s`, Developer Certificate of Origin); contributions are licensed
AGPL-3.0-or-later. Follow `.github/pull_request_template.md`: explain the
user-facing change and validation; include mobile screenshots for visual
changes and link relevant issues.

`dev` is the integration branch and `main` is production. Open pull requests
against `dev`. A release is a `dev` → `main` pull request merged with a merge
commit, never squash, so `main` stays an ancestor of `dev`. Rulesets require the
`verify` check and code-owner approval, and block force-pushes and deletion of
both branches.

## Deployment & Hosting

Every push deploys. Cloudflare Workers Builds publishes `main` to
chronosbible.com and `dev` to dev.chronosbible.com; Vercel publishes `main` to
sfk-bible-reading.vercel.app plus branch previews. Both Workers serve static
assets directly, with `/api/ai/*` handled by `worker/` (`wrangler.json`). `hosting/cloudflare-app/_headers` and
`_redirects` are copied into `dist/` for Cloudflare only, while Vercel reads
`vercel.json`; keep caching and redirects in step.

Never run a bare `wrangler deploy`: without the right config, Wrangler
reconfigures the project and uploads whatever is in `dist/`, including local
media and `.env.local` values. Deploy only through `scripts/cloudflare-app.mjs`
(`npm run app:host:build`, `app:host:deploy`, and their `:dev` variants), which
refuses dirty checkouts, task branches, `.env*` files, and media in assets.
Production AI is guarded by an explicit release gate, initially closed until
dev acceptance. Only the enabled flag and Turnstile site key are public;
credentials belong in Worker runtime secrets. Follow `docs/ai-worker.md`.

Recordings are immutable, content-hashed files in the R2 bucket
`chronosbible-audio`, served at `https://audio.chronosbible.com`. A build
advertises only media that `data/audio/publication.json` lists as verified.
Publish with `npm run audio:host:prepare`, `npm run audio:host:upload`, then
`scripts/hosting/verify-audio-host.py https://audio.chronosbible.com --publish`, and
commit the updated inventory.

## Data & Configuration Safeguards

Preserve Scripture wording, passage order, attribution, and progress/backup
compatibility. Regenerate data through documented importers; do not hand-edit
`public/readings/`, `public/study/`, or `public/audio/`.
Never commit credentials, private backups, audio binaries, or generated reports.
Treat `VITE_*` values as public. Keep working artifacts in ignored `artifacts/`
and concurrent worktrees in `.agents/`; leave other contributors' checkouts
intact. Tool-created worktrees start from `origin/main`, so reset them to the
intended base (usually `origin/dev`) first. Playwright MCP writes
`.playwright-mcp/` in the repository root; remove it after use.
