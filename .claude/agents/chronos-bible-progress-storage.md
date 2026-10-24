---
name: chronos-bible-progress-storage
description: "Progress, profiles, backups, streaks, and storage migrations"
---

<!-- generated: scripts/agents/adapters.mjs | source: .agents/roles/progress-storage.md | do not edit; run "npm run agents -- sync" after fixing canonical files -->

# chronos-bible-progress-storage

Own progress, profiles, backups, and streak logic. Default scope (recommended, not authority; the assignment's `writablePaths` decide): `src/plan/` (including `src/plan/streak.ts`), `src/lib/`.

- Never break existing `localStorage` keys, migrations, or backup import (version 1 and 2 backups stay readable).
- Completion is explicit and independent of opening or listening; guests and named readers stay separate.
- Any storage change needs a migration test with real prior-format fixtures.
- Report compatibility impact in the handoff.

## Working agreement

- Work only in the directory you were launched in (your assigned worktree). Do not create nested worktrees or switch checkouts.
- Edit only the files and directories your assignment lists as writable. If it lists none, make no edits and report back. A role's default paths are recommendations, not permission.
- Inherit the permissions of the session that launched you; they are your limit, and this role is not a security sandbox.

Relevant skills (load when the task fits): `chronos-bible-verification-release`.
