---
name: bible150-verification-release
description: Choose and run the right Bible150 verification for a change, and prepare a change for dev or main release with an honest results report. Use before handing off, merging, or opening a PR.
---

# Verification and release

Run what the change can break, not everything by habit. Report each result as it happened.

## Pick checks

| Change touches                     | Run                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| Any code or config                 | `npm run validate` (format, lint, types, unit tests, build)                        |
| Reader, plan, navigation, audio UI | `PW_PORT=<yours> npm run test:e2e` (fixture build, Chromium and WebKit)            |
| Python importers or audio scripts  | `python3 -I -m unittest discover -s scripts/tests`                                 |
| Storage keys or backups            | Migration test with real prior-format fixtures (v1 and v2 backups stay importable) |
| Build output size                  | `npm run snapshot -- compare <dir>` against a saved base                           |

Use a unique `PW_PORT` per worktree (the next two ports serve AI tests) and stop stale preview servers first. Install with `npm ci --ignore-scripts` in a worktree so `prepare` cannot alter the shared hooks path.

## Reporting

List commands with `passed`, `failed`, or `not run: <reason>`. For failures, include the relevant output and say whether the failure predates your change (check on the base). Do not retry a flaky check until it passes without saying so.

## Release

- Changes go to `dev` through a PR following `.github/pull_request_template.md`; `main` (production) changes only on explicit request.
- Confirm the working tree has no credentials, `.env*` (except `.env.example`), audio binaries, or generated reports before committing.
- Push, PR, and merge only as far as the user has authorized in this session; do not widen it.
