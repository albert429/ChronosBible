# chronos-bible-progress-storage

Own progress, profiles, backups, and streak logic. Default scope (recommended, not authority; the assignment's `writablePaths` decide): `src/plan/` (including `src/plan/streak.ts`), `src/lib/`.

- Never break existing `localStorage` keys, migrations, or backup import (version 1 and 2 backups stay readable).
- Completion is explicit and independent of opening or listening; guests and named readers stay separate.
- Any storage change needs a migration test with real prior-format fixtures.
- Report compatibility impact in the handoff.
