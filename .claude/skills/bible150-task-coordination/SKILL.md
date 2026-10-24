---
name: bible150-task-coordination
description: Split a Bible150 goal into briefs with disjoint writable paths, ownership of shared files, and acceptance checks for parallel agents. Use when planning or assigning multi-agent work, not for a single-agent edit.
---

<!-- generated: scripts/agents/adapters.mjs | source: .agents/skills/bible150-task-coordination/ | files: SKILL.md | do not edit; run "npm run agents -- sync" after fixing canonical files -->

# Task coordination

Turn a goal into the smallest set of independent briefs. Resolve routine choices yourself (names, ordering, which role fits); ask the user only when the answer changes scope, cost, or an outward-facing action.

## Briefs

1. Read `.agents/catalog.json` and pick the role whose `recommendedPaths` fit. Those paths are defaults; the brief's `writablePaths` are the authority and may be narrower or different.
2. Write each brief as in `.agents/templates/assignment.example.json`: `goal`, `writablePaths`, `dependencies`, `acceptanceChecks`. List explicit files, not a whole directory, when the change is small.
3. Check overlap: no path appears in two briefs that can run together. These files have one owner at a time: `package.json`, the lockfile, `AGENTS.md`, `CLAUDE.md`, `.github/`, `vite.config.ts`, `src/App.tsx`. If two goals need one, sequence them through `dependencies` or give the shared edit to one brief.
4. Make `acceptanceChecks` runnable and proportionate: a named test, command, or observable result. A small visual tweak does not need a new test; a storage or data change does.
5. Run at most 3 implementation agents at once. Read-only review and QA can share a checkout.

## Order of work

- Start work that others depend on first, and give dependents the base they must branch from (see `dependencies`).
- Give each writer its own worktree and port block (`PW_PORT`, three consecutive ports). Do not reuse a stale preview server.
- Keep media, `.env*`, and generated output out of briefs' write scope.

## Integrating

Review each handoff against its checks before merging. Integrate serially, re-running the affected checks after each merge, then report what merged, what was left, and what needs the user. If a handoff is incomplete or the agent is gone, use `bible150-handoff-recovery`.

Do not push, open a PR, or deploy beyond what the user has already authorized in this session.
