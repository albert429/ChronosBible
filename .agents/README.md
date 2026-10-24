# Shared agent workflow

Quickstart for coordinating several AI agents on Bible150. Roles, skills and
templates are tracked; everything else under `.agents/` is local and ignored.
The CLI below is the agreed design and is implemented separately; until it
lands, treat the syntax as a proposal.

```sh
npm ci --ignore-scripts                 # once per checkout
npm run agents -- doctor                # check Node, Git, ports, profile
npm run agents -- init                  # create integration worktree and state
npm run agents -- status                # agents, branches, ports, handoffs
npm run agents -- check                 # validate catalog, roles, templates
npm run agents -- sync                  # regenerate adapter copies of skills
npm run agents -- create <id> --role <id> --brief brief.json
npm run agents -- handoff <id> --report report.json
npm run agents -- cleanup <id> [--apply]  # dry run unless --apply
```

## Layout

| Path                             | Purpose                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `catalog.json`                   | Nine roles: `{version:1, roles:[{id,name,description,instructions,recommendedPaths,skills}]}` |
| `roles/<id>.md`                  | Concise role prompt; `name` is `bible150-<id>`                                                |
| `skills/`                        | Canonical skills; Claude copies are generated, never edited                                   |
| `templates/`                     | `assignment`/`handoff` JSON examples and `local-profile.example.json`                         |
| `state/`, `artifacts/` (ignored) | Registry, handoffs, reports                                                                   |
| `worktrees/` (ignored)           | `integration` and one worktree per task                                                       |

Roles: coordinator, product, ui-ux, bible-data, progress-storage, audio,
ai-study, deployment, qa-performance. No model is pinned; an agent inherits the
permissions of the session that launches it. Planned skills:
`bible150-task-coordination`, `-arabic-reader-review`, `-scripture-data-audit`,
`-audio-publication`, `-verification-release`, `-handoff-recovery`.

Copy `templates/local-profile.example.json` to `.agents/state/local-profile.json`
and edit it; the copy is ignored.

## Branches and worktrees

- `.agents/worktrees/integration` holds the persistent branch
  `agents/integration`, created from an explicit `origin/dev`.
- Each task gets a temporary branch `agents/<id>` and worktree from the
  integration HEAD.
- The registry and artifacts are anchored in the primary checkout (resolved from
  the Git common directory), never inside a task worktree, so every agent sees
  the same state.

## Running agents

- Writers are launched by the user, with their cwd set to the assigned
  worktree. Do not use a tool's native automatic worktrees inside one; nested
  worktrees confuse ownership. Read-only reviewers may share a checkout.
- At most 3 implementation agents run at once. A shared path
  (`package.json`, lockfile, `AGENTS.md`, `.github/`, `vite.config.ts`) has a
  single owner at a time.
- A brief has `goal`, `writablePaths`, `dependencies`, `acceptanceChecks`
  ([example](templates/assignment.example.json)). A handoff has `tests`,
  `findings`, `remainingWork`, `artifacts`
  ([example](templates/handoff.example.json)); the CLI derives commits.
- The coordinator reviews each handoff, then integrates serially into
  `agents/integration` and prepares the PR to `dev`.

## Isolation

- **Ports:** each worktree gets its own block of three ports from `PW_PORT`
  (the next two serve AI tests); blocks must not overlap. Never reuse a stale
  preview server.
- **Install:** `npm ci --ignore-scripts` in each worktree, so the `prepare`
  script cannot change the shared Git hooks path. Do not share `node_modules`
  or generated output (`dist/`, `dist-ai/`, `public/readings/`, `public/study/`).
- **Media:** audio binaries live durably outside any worktree (`mediaRoot` in
  the local profile) and are never committed.
- **Cleanup:** fails closed. A dry run lists what would go; unknown ignored
  files block removal, and only the named worktree and branch are touched. Never
  run a global `git worktree prune`.

## Authorization

Nothing mutates a remote automatically: no push, PR, deploy, or upload. Approval
is per task and does not carry to the next one; do not add blanket permanent
allow rules. Leave other worktrees and staged work (such as the promo video in
the primary checkout) alone.
