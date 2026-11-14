# Contributing

Use Node.js 22 and install the locked dependencies with `npm ci`. Run `npm run dev` to work locally. The default reader needs no secrets or backend services. Optional AI uses the Worker runtime described in [docs/ai-worker.md](docs/ai-worker.md).

`npm install` enables the Git hooks in `.githooks/`: `pre-commit` runs Prettier, ESLint and the type-check, and `pre-push` runs the unit tests. `npm run validate` runs formatting, `lint`, `typecheck`, unit tests and build; `npm run verify:all` runs the complete CI gate.

Before opening a pull request:

```sh
npm run format
npm run validate
npx playwright install chromium webkit
npm run verify:all
```

`npm run verify:all` runs what CI runs: `validate` (in CI's environment), Worker integration tests, import-layer checks, the Python tests, a recursive `py_compile` of `scripts/` and the browser tests (`npm run test:e2e` alone repeats only the last). `app/src/` separates core contracts, feature domain/data/UI, generic shared code and app composition. `npm run lint` rejects imports that break these boundaries; see [Structure and dependencies](docs/development.md#structure-and-dependencies).

`npm run test:e2e` first makes the explicit audio-fixture build (`scripts/build/browser-build.mjs app`: every `VITE_*` value set, none inherited from your shell or `.env` files), then runs the Playwright suite with the fixture variables (`AUDIO_TEST_FIXTURES=1`, `VITE_AUDIO_BASE_URL=https://audio.example.test`). Audio suites require the fixture variables and matching build. Playwright serves the builds with a production-like static server and never reuses a server: if ports 4173–4175 (or your `PW_PORT` and the next two) are taken, it stops with an error, so stop any `npm start` or preview first.

Set `PW_PORT` (default 4173; the AI preview uses +1 and the SSE stub +2) to run the suite on other ports, for example from several worktrees at once: `PW_PORT=5173 npm run test:e2e`.

For a focused app browser test, follow the [focused commands](docs/development.md#commands); AI tests have a separate command with their artifact prerequisite documented there. Python suites support `npm run test:python -- audio` or a file such as `npm run test:python -- scripts/audio/tests/test_audio_text.py`; `-- --help` lists the syntax. Omitting the selector runs all Python suites.

Explain the user-facing change and include relevant validation. For UI changes, include a mobile screenshot and check narrow widths, both themes, large Arabic text, keyboard focus, and reduced motion. Keep reading uncluttered and put secondary actions in sheets.

Preserve Scripture wording, section headings, passage order, and existing progress/backup formats. Do not edit generated `app/public/readings/` or `app/public/study/` files, and regenerate study sources through the documented import workflow in `data/study/CANONICAL.md` and verify the data tests. Edit attribution in `data/study/LICENSE.md`; the data builder publishes its exact bytes to `app/public/licenses/study-data.txt`. Avoid changing the reading plan without checking the original table.

Keep names, saved progress, backups, credentials, and generated test reports out of commits. Never commit a `.env*` file other than `.env.example`, or any real API key. Only `VITE_AI_ENABLED` and the public `VITE_TURNSTILE_SITE_KEY` enter AI browser builds. Credentials belong in Worker runtime secrets; local Worker secrets use ignored `.dev.vars.dev` as described in [the AI guide](docs/ai-worker.md). Never put credentials in `VITE_*` or hosting build variables. Generated reports belong in ignored `artifacts/`. Documentation images belong in `docs/assets/`, not the runtime bundle.

See [docs/development.md](docs/development.md) for architecture and data regeneration.

Open pull requests against `dev`; `main` is production and only receives reviewed release merges from `dev`. Contributions are licensed under AGPL-3.0-or-later (inbound = outbound), and every commit must be signed off with `git commit -s` under the [Developer Certificate of Origin](https://developercertificate.org/).

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md), report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), and use the issue forms for bugs, feature requests and Scripture text corrections.
