---
name: bible150-handoff-recovery
description: Write a Bible150 handoff report, or reconstruct one from a worktree when an agent stopped, crashed, or left work unreported. Use at the end of an assignment or when recovering abandoned agent work.
---

<!-- generated: scripts/agents/adapters.mjs | source: .agents/skills/bible150-handoff-recovery/ | files: SKILL.md | do not edit; run "npm run agents -- sync" after fixing canonical files -->

# Handoff and recovery

## Writing a handoff

Follow `.agents/templates/handoff.example.json`: `tests`, `findings`, `remainingWork`, `artifacts`.

- `tests`: each command exactly as run, with `passed`, `failed`, or `not run: <reason>`. Never report an unrun check as passed; include the failing output for a failure.
- `findings`: facts the coordinator cannot see in the diff (compatibility impact, surprises, decisions made).
- `remainingWork`: concrete unfinished items and blockers.
- `artifacts`: paths under the shared `.agents/artifacts/` of the primary checkout, which every agent can read. Do not leave evidence only inside a task worktree, which is removed at cleanup.
- Commits are derived from the branch; do not hand-list hashes.

## Recovering unreported work

From the task worktree, gather facts before judging anything:

1. `git status --short` and `git log --oneline <base>..HEAD` for the branch's state; `git diff --stat <base>` for scope. The base is the integration commit named in the assignment.
2. Compare changed paths with the brief's `writablePaths`; list anything outside as a finding, not as something to revert silently.
3. Re-run the brief's `acceptanceChecks` yourself and record true results.
4. Check for uncommitted or untracked files and for running servers on the task's ports.

Then write the handoff from what you verified, mark gaps as `remainingWork`, and say plainly that it was reconstructed. Do not delete, reset, or clean the worktree to tidy up; cleanup is a separate dry-run-first step after the coordinator accepts the work.
