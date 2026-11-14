# Shared code review workflow

This is the authoritative workflow for the Codex skill and Claude subagent.
Paths below are relative to the repository root. Read `AGENTS.md` and applicable
nested instructions first. Current code, contracts, and the requested change take
precedence over this map; `docs/plans/` records historical proposals, not a list
of requirements to impose on every PR.

## Establish the review target

1. Inspect `git status --short --branch`, `git worktree list`, the current commit,
   and the user's requested scope. Keep staged, unstaged, untracked, and committed
   changes distinct. Do not reset, clean, stash, or switch the author's checkout.
2. For a PR, obtain its actual base branch, base/head SHAs, description, and check
   results through available read-only GitHub tools or `gh pr view`. `dev` is the
   usual integration branch; a release PR targets `main`. Never substitute the
   current `dev` tip for a PR's recorded head, especially after a merge.
3. Compare the merge base to the head for a branch/PR review. Honor an explicit
   commit range. For an unspecified local review, use uncommitted changes if
   present; otherwise compare the task branch with `origin/dev`. If there is no
   identifiable change (for example, a clean `dev` checkout), ask for a target
   rather than silently reviewing an arbitrary commit or the whole repository.
   State when remote refs could not be refreshed.
4. Record the exact comparison and working-tree status. Use rename-aware diffs
   (`git diff --find-renames --stat` and the corresponding full diff). A move is
   not a behavioral change: inspect its old revision, changed imports, callers,
   build entry points, and tests. Include new untracked files in a local review.

## Investigate the change

- Read `docs/development.md` for architecture, then only the relevant sections of
  [the repository map](repository-map.md) and its source documents. Use `rg` and
  bounded reads; do not dump complete Scripture corpora, manifests, or lockfiles.
- Trace each changed contract across producers and consumers. Check runtime,
  generators, storage/backup readers, deployment output, and tests when they
  share a type or format. Verify user-visible behavior across all affected tracks.
- For asynchronous code, walk success, rejection, cancellation, retry, unmount,
  profile change, and rapid navigation. Check which operation owns the result,
  whether obsolete results can commit, and whether cleanup stops the right work.
- For an apparent defect, establish a concrete input or sequence, the changed
  code responsible, the violated contract, and the observable impact. Read the
  base revision to distinguish an introduced regression from a pre-existing
  issue. A small repro or relevant regression test is stronger than speculation.
- Review tests critically: do they exercise the failure and assert the contract,
  or simply mirror implementation details? Passing unit tests alone do not prove
  mobile playback, browser focus, data fidelity, or the production bundle.
- Look for abstraction mistakes as well as duplication. Share logic when the
  contract is actually shared; do not merge intentionally different validation,
  browser, network, or source-import policies just because their code looks alike.
  Check CLI/docs/CI and dynamic imports before declaring code or a dependency dead.
- New refactoring ideas are welcome when they solve a concrete maintenance
  problem. Label optional suggestions separately; do not turn taste, broad
  redesigns, or an unimplemented historical plan into blocking findings.
- If delegation is authorized and supported, assign bounded independent areas
  and provide the exact comparison SHAs. Independently verify and deduplicate
  returned findings. Delegation is optional; this workflow works in one agent.

## Verify proportionately

Use Node 22 and the lockfile (`npm ci` when installation is needed). Select checks
from the repository map and inspect scripts before running commands that replace
build outputs. Run commands in the checkout actually containing the reviewed code.

| Scope                                      | Useful verification                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Formatting or repository instructions      | `git diff --check`; focused `npx prettier --check <files>`                             |
| TypeScript, imports, or feature boundaries | `npm run lint`, `npm run typecheck`, `npm run layers`; relevant Node tests             |
| Focused Node regression                    | `node --experimental-strip-types --test src/features/profiles/tests/progress.test.ts`  |
| Python importers/audio/ownership           | `npm run test:python`                                                                  |
| App/data/build behavior                    | `npm run build` (includes data generation); relevant generated-output tests            |
| Broad cross-cutting change                 | `npm run validate`; `npm run verify:all` when full CI-equivalent coverage is warranted |
| Browser behavior                           | Focused Playwright specs in the affected projects; see the setup below                 |

For a focused browser run, export `AUDIO_TEST_FIXTURES=1`,
`VITE_AUDIO_BASE_URL=https://audio.example.test`, and
`VITE_AUDIO_CHAPTERS_ENABLED=true`; run
`node scripts/build/browser-build.mjs app`, then
`npx playwright test --config config/playwright.config.ts tests/browser/<name>.spec.ts --project=chromium`.
Use `mobile-webkit` for WebKit behavior and `ai-chromium` for `ai.spec.ts`.
`npm run test:e2e` builds fixtures and runs the full browser suite. Set `PW_PORT`
to an unused port in concurrent worktrees; reserve its next two ports too. Let
Playwright start its configured servers; it rejects occupied ports.

Preserve the workspace while verifying:

- Use ignored `artifacts/` for scratch repros. For another revision or destructive
  reference builds, use a disposable checkout/worktree under `.agents/` at the
  recorded SHA. Tool-created worktrees can start from `origin/main`; confirm the
  intended revision before testing. Never repurpose another contributor's tree.
- `scripts/build/build-config.mjs build ...` cleans generated `public/` trees and
  output directories. Do not run it in the author's checkout with local media or
  work. Ordinary builds also replace outputs; avoid racing a running preview or
  another agent's build. Never delete `.env*` or media to make a preflight pass.
- A bare `vite build` skips data generation. Compare refactor artifacts under the
  same explicit environment, using `scripts/quality/snapshot.mjs` and the current
  build configurations. Include generated paths/bytes, initial JS/CSS, and inline
  startup code where relevant; do not infer equivalence from chunk names alone.
- Read CI results for the reviewed SHA and identify whether they ran on the head
  or a merge commit. Report them separately from commands actually run locally.
  Recheck the head before finalizing; disclose subsequent changes not reviewed.
- After checks pass, repeat or broaden only to address new changes or unresolved
  risks. If a check is unavailable, state why and its practical coverage gap.

## Report findings

Lead with findings in descending severity. Each finding should contain:

- **`[P1] Short actionable title`** (use the appropriate priority).
- A path and tight, one-based line range at the reviewed revision, preferably
  touching the diff; use a clickable file link when the client supports it.
- The triggering input/state/sequence and what fails, in a concise paragraph.
- The evidence or repro and a useful correction direction, without a speculative
  patch. Clearly identify any assumption essential to reproducing the failure.

Priorities: **P0** is an unconditional release blocker or widespread catastrophic
failure; **P1** needs prompt correction for a serious reachable defect;
**P2** is a normal actionable bug; **P3** is a minor concrete defect. Judge impact
and reachability, not how dramatic a hypothetical failure sounds.

Do not manufacture a minimum number of findings, repeat the same root cause,
report pure style preferences, or label an existing problem as introduced. For a
requested repository audit, existing defects are in scope: label them clearly
instead of pretending they belong to a PR. Keep optional architecture ideas apart
from defects and omit them when the user asks for bugs only.

After findings, state the comparison reviewed, checks run and outcomes, and
material gaps. If none qualify, write **“No actionable findings.”** Then give the
same scope/validation information; do not promise the change is bug-free.
Honor any structured output format requested by the caller.

Review does not authorize implementation, commits, pushes, deployment, approval,
or posting GitHub comments. Deliver the review to the caller. Tests can write
their usual ignored artifacts, but do not rewrite tracked files to make tests pass.
If the user explicitly requests fixes, follow that expanded task scope (or return
the findings to the implementing parent agent when running as a review subagent).
