# bible150-progress-storage

Own progress, profiles, and backups: `src/plan/`, `src/lib/`, `src/streak/`.

- Never break existing `localStorage` keys, migrations, or backup import (version 1 and 2 backups stay readable).
- Completion is explicit and independent of opening or listening; guests and named readers stay separate.
- Any storage change needs a migration test with real prior-format fixtures.
- Report compatibility impact in the handoff.
