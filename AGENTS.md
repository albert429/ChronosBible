# Repository Guidelines

## Project Structure & Module Organization

chronosBible is a static React/TypeScript Arabic Bible reader built with Vite.
`src/reader/` renders Scripture; `src/plan/` manages schedules, profiles, and
backups; `src/navigation/` holds the toolbar and sheets. Audio, study, and
optional AI use `src/audio/`, `src/study/`, and `src/ai/`. Shared helpers go in
`src/lib/` and `src/bible/`, reusable UI in `src/components/`, tokens in
`src/styles/`. `data/` holds sources; `scripts/` builds static JSON into
`public/`. See `docs/development.md` for architecture.

## Build, Test, and Development Commands

Use Node.js 22 and `npm ci`.

- `npm run dev`: generate data, start Vite on port 5173.
- `npm run build`: generate data, type-check, build `dist/`.
- `npm start`: preview the build on port 4173.
- `npm run validate`: format, lint, types, unit tests, build.
- `npm run test:e2e`: build audio fixtures, run Playwright.
- `python3 -I -m unittest discover -s scripts/tests`: Python utilities.

Install browsers with `npx playwright install chromium webkit`. In concurrent
worktrees use `PW_PORT=4400 npm run test:e2e` (the next two ports serve AI
tests) and avoid stale preview servers.

## Style, Testing, and Commits

Strict TypeScript, ES modules, two-space indentation, double quotes,
semicolons; `npm run format` applies Prettier. Tests: `tests/*.test.ts` via
`npm test`, Playwright in `tests/browser/`. Add regression coverage for behaviour and data changes,
keeping exact Scripture-data checks; a tiny cosmetic UI tweak needs no new test.
For visible UI, check 320–430px, both themes, large Arabic text, focus, and
reduced motion. Use concise imperative commit subjects and
follow `.github/pull_request_template.md`.

## Data & Configuration Safeguards

Preserve Scripture wording, passage order, attribution, and progress/backup
compatibility. Regenerate data through documented importers; never hand-edit
`public/readings/`, `public/study/`, or `public/audio/`. Never commit
credentials, private backups, audio binaries, or generated reports. Treat
`VITE_*` as public. Keep working artifacts in ignored `artifacts/`; leave other
contributors' checkouts and staged work intact.

## Multi-Agent Workflow

Parallel agent work follows `.agents/README.md` (quickstart, roles, branches,
isolation). Writers use assigned worktrees, share no `node_modules` or builds,
and install with `npm ci --ignore-scripts`. Honor the authorization the user has
already given in this session for pushes, PRs, and deploys without asking again
for each one, and do not go beyond it. Generated copies under `.claude/` and
`.codex/` come from `.agents/`; edit the source, then run `npm run agents -- sync`.
