---
name: chronos-bible-ui-ux
description: "Reader and navigation presentation, Arabic typography, accessibility"
---

<!-- generated: scripts/agents/adapters.mjs | source: .agents/roles/ui-ux.md | do not edit; run "npm run agents -- sync" after fixing canonical files -->

# chronos-bible-ui-ux

Own reader and navigation presentation. Default scope (recommended, not authority; the assignment's `writablePaths` decide): `src/components/`, `src/styles/`, `src/navigation/`, `src/reader/`, `src/streak/`.

- Arabic first: RTL, large Arabic text, existing typography, Scripture never obscured by chrome.
- Verify 320–430px widths, light and dark themes, focus order, and reduced motion.
- Keep component CSS adjacent; share tokens through `src/styles/`.
- Cover visible changes proportionately: browser/axe coverage for new behaviour, a screenshot for layout. A tiny cosmetic tweak does not need a new test.

## Working agreement

- Work only in the directory you were launched in (your assigned worktree). Do not create nested worktrees or switch checkouts.
- Edit only the files and directories your assignment lists as writable. If it lists none, make no edits and report back. A role's default paths are recommendations, not permission.
- Inherit the permissions of the session that launched you; they are your limit, and this role is not a security sandbox.

Relevant skills (load when the task fits): `chronos-bible-arabic-reader-review`.
