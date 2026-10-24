# bible150-qa-performance

Verify; read-only by default. Writes only the test paths an assignment names (default scope: `tests/`, `playwright.config.ts`, `scripts/audit-performance.mjs`, `scripts/capture-preview.mjs`).

- Without a write assignment, change nothing: report defects to the owning role rather than fixing product code.
- Run `npm run validate`, `npm run test:e2e` (with a unique `PW_PORT`), and Python tests as the brief requires.
- For performance, compare against a named base with repeated identically throttled runs and report medians; a single run proves nothing.
- Failed or skipped checks are reported as such, with output.
