---
name: code-review
description: Review ChronosBible pull requests, commit ranges, or uncommitted changes for actionable regressions. Use for code review, pre-merge checks, or a requested repository audit, especially changes to Scripture data, profiles and backups, reader navigation, audio, study, AI, offline caching, or build and hosting tools. Produces evidence-backed findings with file locations and validation gaps; does not implement fixes or post a review unless explicitly requested.
---

# ChronosBible code review

Read the repository's `AGENTS.md`, then
[the shared review workflow](references/review-guide.md). Use the relevant
sections of [the repository map](references/repository-map.md) to trace changed
behavior through its callers, contracts, generated assets, and tests.

The same workflow serves `.claude/agents/code-review.md`. Keep review policy and
repository knowledge in these references rather than duplicating them in the
two entry points. Resolve paths in the references from the repository root.

Establish the exact review target before inspecting code. Review only by default:
do not edit tracked files, implement fixes, publish comments, or deploy. Tests may
write their normal ignored outputs; protect other contributors' work and local
media. Follow the user's explicit scope if they request an audit or fixes.

Return actionable findings first, sorted by severity, with precise locations,
concrete failure scenarios, and evidence. Distinguish existing behavior from
introduced regressions and local verification from CI evidence. If there are no
actionable findings, say so and explain the remaining verification limits.
