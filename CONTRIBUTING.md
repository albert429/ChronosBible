# Contributing

Use Node.js 22 and install the locked dependencies with `npm ci`. Run `npm run dev` to work locally. No secrets or backend services are needed.

`npm install` enables the Git hooks in `.githooks/`: `pre-commit` runs Prettier, ESLint and the type-check, and `pre-push` runs the unit tests. `npm run validate` runs the same checks as CI (formatting, `lint`, `typecheck`, unit tests and build).

Before opening a pull request:

```sh
npm run format
npm run validate
npx playwright install chromium webkit
npm run test:e2e
```

`npm run test:e2e` first builds with the audio test fixtures (`AUDIO_TEST_FIXTURES=1` and `VITE_AUDIO_BASE_URL=https://audio.example.test`), then runs the Playwright suite with the same variables. A plain `playwright test` against an ordinary build fails every audio spec. Outside CI, Playwright reuses a server already running on ports 4173 or 4174, so stop any `npm start` or preview first; otherwise the suite runs against a stale `dist/`.

Set `PW_PORT` (default 4173; the AI preview uses +1 and the SSE stub +2) to run the suite on other ports, for example from several worktrees at once: `PW_PORT=5173 npm run test:e2e`.

Explain the user-facing change and include relevant validation. For UI changes, include a mobile screenshot and check narrow widths, both themes, large Arabic text, keyboard focus, and reduced motion. Keep reading uncluttered and put secondary actions in sheets.

Preserve Scripture wording, section headings, passage order, and existing progress/backup formats. Do not edit generated `public/readings/` or `public/study/` files, and change `data/study/` only through `scripts/import-study.py`; change the canonical sources through the documented import workflow and verify the data tests. Avoid changing the reading plan without checking the original table.

Keep names, saved progress, backups, credentials, and generated test reports out of commits. Never commit a `.env*` file other than `.env.example`, or any real API key: the AI build compiles its key into public JavaScript, so keys belong only in an ignored `.env.development.local` or in the host's environment settings. Generated reports belong in ignored `artifacts/`. Documentation images belong in `docs/assets/`, not the runtime bundle.

See [docs/development.md](docs/development.md) for architecture and data regeneration.

Open pull requests against `dev`; `main` is production and only receives reviewed release merges from `dev`. Contributions are licensed under AGPL-3.0-or-later (inbound = outbound), and every commit must be signed off with `git commit -s` under the [Developer Certificate of Origin](https://developercertificate.org/).

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md), report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), and use the issue forms for bugs, feature requests and Scripture text corrections.
