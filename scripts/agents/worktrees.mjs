// Worktree lifecycle: init, create, handoff, cleanup, status. Mutations run
// under the registry lock, recheck their preconditions there, and roll back
// only what they created. Nothing here fetches, pushes, resets, prunes, or
// forces.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  AgentsError,
  branchSha,
  diffRaw,
  git,
  gitOut,
  ignoredEntries,
  isAncestor,
  listWorktrees,
  pendingOperations,
  revParse,
  statusEntries,
} from "./git.mjs";
import { findPortBlock } from "./ports.mjs";
import {
  integrationPath,
  loadProfile,
  readRegistry,
  removeIfEmptyDir,
  requireRegistry,
  taskPath,
  withLock,
  writeJsonAtomic,
} from "./state.mjs";
import {
  BASE_REF,
  INTEGRATION_BRANCH,
  PROTECTED_BRANCHES,
  UNFINISHED,
  inScope,
  pathsOverlap,
  taskIdError,
  validateBrief,
  validateReport,
} from "./validate.mjs";

const now = () => new Date().toISOString();
const short = (sha) => (sha ? sha.slice(0, 10) : "-");
const bullets = (items) => items.map((i) => `\n- ${i}`).join("");
const fail = (title, items) => new AgentsError(`${title}:${bullets(items)}`);

export const within = (root, path) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const realOrNull = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};
const lexists = (path) =>
  lstatSync(path, { throwIfNoEntry: false }) !== undefined;
const writeRegistry = (ctx, registry) =>
  writeJsonAtomic(ctx.registryPath, registry);

const findWorktree = (ctx, path) =>
  listWorktrees(ctx.primaryRoot).find(
    (w) => (realOrNull(w.path) ?? w.path) === path,
  );

/** Why a recorded checkout is not the managed worktree it claims to be. */
function checkoutProblems(ctx, record, expectedPath) {
  const problems = [];
  const { path, branch } = record;
  if (path !== expectedPath)
    problems.push(`recorded path ${path} is not ${expectedPath}`);
  const real = realOrNull(path);
  if (!real) return [...problems, `worktree missing at ${path}`];
  if (real !== path) return [...problems, `${path} resolves to ${real}`];
  const entry = findWorktree(ctx, path);
  if (!entry) return [...problems, `${path} is not a registered worktree`];
  const top = git(path, ["rev-parse", "--show-toplevel"], { allowFail: true });
  const common = git(
    path,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    {
      allowFail: true,
    },
  );
  if (
    !top.ok ||
    realOrNull(top.out.trim()) !== path ||
    !common.ok ||
    realOrNull(common.out.trim()) !== ctx.commonDir
  ) {
    problems.push(`${path} is not a checkout of this repository`);
  }
  if (entry.branch !== branch) {
    problems.push(
      `checkout is on ${entry.branch || "a detached HEAD"}, expected ${branch}`,
    );
  }
  if (entry.locked) problems.push(`worktree ${path} is locked`);
  return problems;
}

function integrationState(ctx, registry) {
  const problems = checkoutProblems(
    ctx,
    registry.integration,
    integrationPath(ctx),
  );
  const tip = branchSha(ctx.primaryRoot, INTEGRATION_BRANCH);
  if (!tip) problems.push(`branch ${INTEGRATION_BRANCH} is missing`);
  return { problems, tip };
}

function requireIntegration(ctx, registry) {
  const { problems, tip } = integrationState(ctx, registry);
  if (problems.length)
    throw fail("integration worktree is not usable", problems);
  return tip;
}

function safeAncestor(cwd, a, b) {
  try {
    return isAncestor(cwd, a, b);
  } catch {
    return false;
  }
}

/** A handed-off task whose commits are all in the integration branch. */
function isIntegrated(ctx, task, tip) {
  if (task.status === "integrated" || task.status === "archived") return true;
  const h = task.handoff;
  if (task.status !== "ready" || !h?.commits.length || !tip) return false;
  return safeAncestor(ctx.primaryRoot, h.headSha, tip);
}

function promoteIntegrated(ctx, registry, tip) {
  for (const task of Object.values(registry.tasks)) {
    if (task.status === "ready" && isIntegrated(ctx, task, tip)) {
      task.status = "integrated";
      task.updatedAt = now();
    }
  }
}

export function loadCatalog(root) {
  const path = join(root, ".agents", "catalog.json");
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new AgentsError(`catalog unreadable at ${path} (${error.message})`);
  }
  if (catalog?.version !== 1 || !Array.isArray(catalog.roles)) {
    throw new AgentsError("catalog must be {version: 1, roles: [...]}");
  }
  return catalog;
}

/** Create a worktree on a new branch; returns what was created for rollback. */
function addWorktree(ctx, path, branch, sha) {
  const created = {
    path,
    branch,
    sha,
    parentExisted: existsSync(ctx.worktreesDir),
  };
  const r = git(
    ctx.primaryRoot,
    ["worktree", "add", "--quiet", "-b", branch, path, sha],
    {
      allowFail: true,
    },
  );
  const problems = r.ok
    ? []
    : [`git worktree add failed: ${r.err.split("\n")[0]}`];
  if (r.ok) {
    const head = revParse(path, "HEAD");
    const entry = findWorktree(ctx, path);
    if (head !== sha || entry?.branch !== branch) {
      problems.push(`new checkout is not ${branch} at ${short(sha)}`);
    }
  }
  if (problems.length) {
    const notes = rollbackWorktree(ctx, created);
    throw fail("could not create worktree", [...problems, ...notes]);
  }
  return created;
}

/** Undo addWorktree: remove only that worktree and branch, never forced. */
function rollbackWorktree(ctx, created) {
  const notes = [];
  if (findWorktree(ctx, created.path)) {
    const r = git(ctx.primaryRoot, ["worktree", "remove", created.path], {
      allowFail: true,
    });
    if (!r.ok)
      notes.push(
        `rollback: remove ${created.path} by hand (${r.err.split("\n")[0]})`,
      );
  }
  if (branchSha(ctx.primaryRoot, created.branch) === created.sha) {
    // Conditional delete: only if the branch still points where we created it.
    git(
      ctx.primaryRoot,
      ["update-ref", "-d", `refs/heads/${created.branch}`, created.sha],
      {
        allowFail: true,
      },
    );
  }
  if (!created.parentExisted) removeIfEmptyDir(ctx.worktreesDir);
  return notes;
}

function assertFreshTarget(ctx, path, branch) {
  if (branchSha(ctx.primaryRoot, branch)) {
    throw new AgentsError(
      `branch ${branch} already exists; inspect it and remove or rename it yourself`,
    );
  }
  if (lexists(path)) throw new AgentsError(`${path} already exists`);
  if (listWorktrees(ctx.primaryRoot).some((w) => w.path === path)) {
    throw new AgentsError(
      `a stale worktree registration exists for ${path}; inspect it yourself`,
    );
  }
}

const leasedPorts = (registry) => [
  registry.integration.ports,
  ...Object.values(registry.tasks)
    .filter((t) => t.status !== "archived")
    .map((t) => t.ports),
];

export async function init(ctx, out) {
  const { profile } = loadProfile(ctx);
  const path = integrationPath(ctx);
  const existing = readRegistry(ctx);
  if (existing) {
    const problems = checkoutProblems(ctx, existing.integration, path);
    if (problems.length)
      throw fail("registry and integration worktree disagree", problems);
    out(`already initialized: ${INTEGRATION_BRANCH} at ${path}`);
    return;
  }
  const baseSha = revParse(ctx.primaryRoot, `refs/remotes/${BASE_REF}`);
  if (!baseSha) {
    throw new AgentsError(
      `${BASE_REF} is not available locally; fetch it yourself (the CLI never fetches)`,
    );
  }
  assertFreshTarget(ctx, path, INTEGRATION_BRANCH);
  const firstCreated = mkdirSync(ctx.stateDir, { recursive: true });
  try {
    await withLock(ctx, "init", async () => {
      if (readRegistry(ctx))
        throw new AgentsError("initialized concurrently; rerun init");
      assertFreshTarget(ctx, path, INTEGRATION_BRANCH);
      const ports = await findPortBlock(profile.playwrightPortBase, []);
      if (!ports) throw new AgentsError("no free port block");
      const created = addWorktree(ctx, path, INTEGRATION_BRANCH, baseSha);
      try {
        writeRegistry(ctx, {
          version: 1,
          integration: {
            branch: INTEGRATION_BRANCH,
            path,
            base: BASE_REF,
            baseSha,
            ports,
            createdAt: now(),
          },
          tasks: {},
        });
      } catch (error) {
        rollbackWorktree(ctx, created);
        throw error;
      }
    });
  } catch (error) {
    if (firstCreated) {
      removeIfEmptyDir(ctx.stateDir);
      if (firstCreated === ctx.agentsDir) removeIfEmptyDir(ctx.agentsDir);
    }
    throw error;
  }
  out(`initialized ${INTEGRATION_BRANCH} at ${path}`);
  out(`base ${BASE_REF} = ${baseSha}`);
}

/** Writable paths whose committed ancestors (or selves) are symlinks/gitlinks. */
function linkEscapes(cwd, tip, paths) {
  const prefixes = new Set();
  for (const p of paths) {
    const segs = p.replace(/\/$/, "").split("/");
    segs.forEach((_, i) => prefixes.add(segs.slice(0, i + 1).join("/")));
  }
  const out = git(cwd, ["ls-tree", "-z", tip, "--", ...prefixes]).out;
  const links = out
    .split("\0")
    .filter(Boolean)
    .filter((line) => /^(120000|160000) /.test(line))
    .map((line) => line.slice(line.indexOf("\t") + 1));
  return paths.filter((p) =>
    links.some((l) => p === l || p.startsWith(`${l}/`)),
  );
}

export async function create(ctx, id, { role, brief: rawBrief }, out) {
  const idError = taskIdError(id);
  if (idError) throw new AgentsError(idError);
  const roles = loadCatalog(ctx.sourceRoot).roles.map((r) => r.id);
  if (!roles.includes(role))
    throw new AgentsError(
      `unknown role ${JSON.stringify(role)}; one of: ${roles.join(", ")}`,
    );
  const { brief, errors } = validateBrief(rawBrief);
  if (errors.length) throw fail("brief rejected", errors);
  const { profile } = loadProfile(ctx);
  const branch = `agents/${id}`;
  const path = taskPath(ctx, id);

  const task = await withLock(ctx, `create ${id}`, async () => {
    const registry = requireRegistry(ctx);
    const tip = requireIntegration(ctx, registry);
    promoteIntegrated(ctx, registry, tip);
    if (registry.tasks[id])
      throw new AgentsError(
        `task ${id} already exists (${registry.tasks[id].status})`,
      );
    assertFreshTarget(ctx, path, branch);

    const problems = [];
    for (const dep of brief.dependencies) {
      const status = registry.tasks[dep]?.status;
      if (!status) problems.push(`dependency ${dep} does not exist`);
      else if (status !== "integrated" && status !== "archived") {
        problems.push(`dependency ${dep} is ${status}, not integrated`);
      }
    }
    const active = Object.values(registry.tasks).filter((t) =>
      UNFINISHED.includes(t.status),
    );
    if (active.length >= profile.maxImplementationAgents) {
      problems.push(
        `${active.length} unfinished tasks (${active.map((t) => t.id).join(", ")}); limit is ${profile.maxImplementationAgents}`,
      );
    }
    for (const t of active) {
      for (const a of t.brief.writablePaths) {
        for (const b of brief.writablePaths) {
          if (pathsOverlap(a, b))
            problems.push(`${b} overlaps ${a} claimed by ${t.id}`);
        }
      }
    }
    for (const p of linkEscapes(ctx.primaryRoot, tip, brief.writablePaths)) {
      problems.push(`${p} passes through a symlink or submodule`);
    }
    if (problems.length) throw fail(`cannot create ${id}`, problems);

    const ports = await findPortBlock(
      profile.playwrightPortBase,
      leasedPorts(registry),
    );
    if (!ports) throw new AgentsError("no free port block");
    const created = addWorktree(ctx, path, branch, tip);
    try {
      if (process.env.AGENTS_FAULT === "create:after-worktree") {
        throw new AgentsError("injected fault after worktree add");
      }
      const at = now();
      registry.tasks[id] = {
        id,
        role,
        branch,
        path,
        baseSha: tip,
        status: "assigned",
        brief,
        ports,
        createdAt: at,
        updatedAt: at,
        handoff: null,
      };
      writeRegistry(ctx, registry);
      return registry.tasks[id];
    } catch (error) {
      const notes = rollbackWorktree(ctx, created);
      throw notes.length ? fail(error.message, notes) : error;
    }
  });

  out(`created ${id} (${role}) at ${path}`);
  out(`branch ${branch} from ${INTEGRATION_BRANCH} ${short(task.baseSha)}`);
  out(`ports ${task.ports.join(", ")}: use PW_PORT=${task.ports[0]}`);
  const model = profile.models?.[role] ?? profile.models?.default;
  if (typeof model === "string") out(`advisory model: ${model}`);
  out(`next: cd ${JSON.stringify(path)} && npm ci --ignore-scripts`);
}

const KIND = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type changed",
};

/** Read-only checks of a task checkout against its brief. */
function inspectTask(ctx, task) {
  const problems = checkoutProblems(ctx, task, taskPath(ctx, task.id));
  if (problems.length) return { problems };
  const head = revParse(task.path, "HEAD");
  if (!head || !safeAncestor(task.path, task.baseSha, head)) {
    return {
      problems: [
        `HEAD does not descend from the recorded base ${short(task.baseSha)}`,
      ],
    };
  }
  const scope = task.brief.writablePaths;
  for (const op of pendingOperations(task.path))
    problems.push(`operation in progress: ${op}`);
  for (const { xy, path } of statusEntries(task.path)) {
    const what =
      xy === "??"
        ? "untracked"
        : /U|AA|DD/.test(xy)
          ? "unmerged"
          : "uncommitted";
    problems.push(
      `${what}: ${path}${inScope(path, scope) ? "" : " (outside writablePaths)"}`,
    );
  }
  const changed = new Set();
  for (const e of diffRaw(task.path, task.baseSha, head)) {
    const paths =
      e.kind === "C" ? [e.path] : [e.oldPath, e.path].filter(Boolean);
    for (const p of paths) {
      changed.add(p);
      if (!inScope(p, scope))
        problems.push(
          `outside writablePaths: ${p} (${KIND[e.kind] ?? e.kind})`,
        );
    }
    if (e.newMode === "120000") problems.push(`symlink committed: ${e.path}`);
    if (e.newMode === "160000") problems.push(`submodule committed: ${e.path}`);
  }
  const commits = gitOut(task.path, [
    "log",
    "--reverse",
    "--format=%H%x1f%s",
    `${task.baseSha}..${head}`,
  ])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split("\x1f");
      return { sha, subject };
    });
  return { problems, head, commits, changedPaths: [...changed].sort() };
}

export async function handoff(ctx, id, rawReport, out) {
  const { report, errors } = validateReport(rawReport);
  if (errors.length) throw fail("report rejected", errors);
  const task = await withLock(ctx, `handoff ${id}`, async () => {
    const registry = requireRegistry(ctx);
    const task = registry.tasks[id];
    if (!task) throw new AgentsError(`unknown task ${id}`);
    if (task.status === "archived")
      throw new AgentsError(`task ${id} is archived`);
    const found = inspectTask(ctx, task);
    if (found.problems.length)
      throw fail(`handoff of ${id} rejected`, found.problems);
    const at = now();
    task.handoff = {
      at,
      headSha: found.head,
      commits: found.commits,
      changedPaths: found.changedPaths,
      ...report,
    };
    task.status = report.remainingWork.length ? "assigned" : "ready";
    task.updatedAt = at;
    promoteIntegrated(ctx, registry, integrationState(ctx, registry).tip);
    writeRegistry(ctx, registry);
    return task;
  });
  const h = task.handoff;
  out(
    `handoff recorded for ${id}: ${h.commits.length} commit(s), ${h.changedPaths.length} path(s), status ${task.status}`,
  );
  if (!h.commits.length)
    out("note: no commits beyond the base; cleanup will stay blocked");
  if (h.remainingWork.length)
    out(
      `remaining work (${h.remainingWork.length}) keeps the task assigned and blocks cleanup`,
    );
}

// Ignored entries `--discard-generated` may delete: rebuildable output only.
const GENERATED_DIRS = [
  "node_modules/",
  "dist/",
  "dist-ai/",
  "public/readings/",
  "public/study/",
  "public/bible/",
  "public/chronology/",
  "test-results/",
  "playwright-report/",
];
const GENERATED_FILE_RE =
  /(?:^|\/)(?:\.DS_Store|[^/]+\.tsbuildinfo|[^/]+\.pyc)$/;

/** Null when `entry` is a vetted generated path that is safe to delete. */
function generatedProblem(root, entry) {
  const isDir = entry.endsWith("/");
  const rel = isDir ? entry.slice(0, -1) : entry;
  const vetted = isDir
    ? GENERATED_DIRS.includes(entry) || basename(rel) === "__pycache__"
    : GENERATED_FILE_RE.test(entry);
  if (!vetted) return "unrecognized";
  let cur = root;
  let st;
  for (const seg of rel.split("/")) {
    cur = join(cur, seg);
    st = lstatSync(cur, { throwIfNoEntry: false });
    if (!st) return "missing";
    if (st.isSymbolicLink()) return "symlink";
  }
  if (isDir ? !st.isDirectory() : !st.isFile()) return "unexpected file type";
  return within(root, realpathSync(cur)) ? null : "outside the worktree";
}

function planCleanup(ctx, registry, id, { discardGenerated }) {
  const task = registry.tasks[id];
  if (!task) throw new AgentsError(`unknown task ${id}`);
  if (task.status === "archived")
    throw new AgentsError(`task ${id} is already archived`);
  const blockers = [];
  const expected = taskPath(ctx, id);
  if (
    task.branch !== `agents/${id}` ||
    PROTECTED_BRANCHES.includes(task.branch)
  ) {
    blockers.push(`branch ${task.branch} is protected or unexpected`);
  }
  if (
    task.path !== expected ||
    [integrationPath(ctx), ctx.primaryRoot].includes(task.path)
  ) {
    blockers.push(
      `recorded path ${task.path} is not the managed path ${expected}`,
    );
  }
  const integ = integrationState(ctx, registry);
  blockers.push(...integ.problems.map((p) => `integration: ${p}`));
  if (within(task.path, ctx.cwd))
    blockers.push("run cleanup from outside the task worktree");

  const plan = {
    task,
    blockers,
    generated: [],
    removeWorktree: false,
    deleteBranch: false,
  };
  const registered = findWorktree(ctx, task.path);
  if (lexists(task.path) || registered) {
    plan.removeWorktree = true;
    blockers.push(...checkoutProblems(ctx, task, expected));
    for (const w of listWorktrees(ctx.primaryRoot)) {
      if (w.path !== task.path && within(task.path, w.path))
        blockers.push(`foreign worktree inside: ${w.path}`);
    }
    if (!blockers.length) {
      for (const op of pendingOperations(task.path))
        blockers.push(`operation in progress: ${op}`);
      for (const { xy, path } of statusEntries(task.path)) {
        blockers.push(
          `${xy === "??" ? "untracked" : /U|AA|DD/.test(xy) ? "unmerged" : "uncommitted"}: ${path}`,
        );
      }
      for (const entry of ignoredEntries(task.path)) {
        const problem = generatedProblem(task.path, entry);
        if (problem)
          blockers.push(`ignored file blocks removal (${problem}): ${entry}`);
        else plan.generated.push(entry);
      }
      if (plan.generated.length && !discardGenerated) {
        blockers.push(
          "generated files present; rerun with --discard-generated to delete them",
        );
      }
    }
  }

  const h = task.handoff;
  if (!h) blockers.push("no handoff recorded");
  else if (h.remainingWork.length)
    blockers.push(
      `handoff lists ${h.remainingWork.length} remaining work item(s)`,
    );
  const tip = branchSha(ctx.primaryRoot, task.branch);
  if (tip) {
    plan.deleteBranch = true;
    if (h && tip !== h.headSha)
      blockers.push("branch moved since the handoff; rerun handoff");
    if (safeAncestor(ctx.primaryRoot, tip, task.baseSha)) {
      blockers.push("branch has no commits beyond its base");
    } else if (!integ.tip || !safeAncestor(ctx.primaryRoot, tip, integ.tip)) {
      blockers.push(`branch is not merged into ${INTEGRATION_BRANCH}`);
    }
  }
  for (const artifact of h?.artifacts ?? []) {
    const abs = resolve(ctx.primaryRoot, artifact);
    const real = realOrNull(abs);
    if (!real) blockers.push(`artifact missing: ${artifact}`);
    else if (within(task.path, abs) || within(task.path, real)) {
      blockers.push(
        `artifact inside the task worktree: ${artifact}; copy it out first`,
      );
    }
  }
  return plan;
}

function describePlan(plan, out) {
  const { task } = plan;
  if (plan.removeWorktree) out(`worktree: ${task.path}`);
  if (plan.deleteBranch) out(`branch:   ${task.branch} (git branch -d)`);
  for (const g of plan.generated) out(`generated: ${g}`);
  for (const b of plan.blockers) out(`blocked: ${b}`);
}

export async function cleanup(ctx, id, opts, out) {
  if (id === "integration")
    throw new AgentsError("the integration worktree is protected");
  const idError = taskIdError(id);
  if (idError) throw new AgentsError(idError);
  if (!opts.apply) {
    const plan = planCleanup(ctx, requireRegistry(ctx), id, opts);
    out(`cleanup ${id} (dry run; nothing changed)`);
    describePlan(plan, out);
    out(
      plan.blockers.length
        ? "result: blocked"
        : "result: ready; rerun with --apply",
    );
    return plan.blockers.length ? 1 : 0;
  }
  await withLock(ctx, `cleanup ${id}`, async () => {
    const registry = requireRegistry(ctx);
    const plan = planCleanup(ctx, registry, id, opts);
    if (plan.blockers.length)
      throw fail(`cleanup of ${id} blocked`, plan.blockers);
    const { task } = plan;
    for (const entry of plan.generated) {
      if (generatedProblem(task.path, entry))
        throw new AgentsError(`${entry} changed; rerun cleanup`);
      rmSync(join(task.path, entry), { recursive: true });
      out(`discarded ${entry}`);
    }
    if (plan.removeWorktree) {
      git(ctx.primaryRoot, ["worktree", "remove", task.path]);
      out(`removed worktree ${task.path}`);
    }
    if (plan.deleteBranch) {
      // Run in the integration checkout so -d checks merge state against it.
      const r = git(integrationPath(ctx), ["branch", "-d", task.branch], {
        allowFail: true,
      });
      if (!r.ok) {
        task.updatedAt = now();
        writeRegistry(ctx, registry);
        throw new AgentsError(
          `kept branch ${task.branch}: ${r.err.split("\n")[0]}; rerun cleanup`,
        );
      }
      out(`deleted branch ${task.branch}`);
    }
    task.status = "archived";
    task.archivedAt = task.updatedAt = now();
    writeRegistry(ctx, registry);
  });
  out(`archived ${id}`);
  return 0;
}

/** Worktrees Git knows about that the registry does not manage. */
export function unmanagedWorktrees(ctx, registry) {
  const managed = new Set([
    integrationPath(ctx),
    ...Object.values(registry?.tasks ?? {})
      .filter((t) => t.status !== "archived")
      .map((t) => t.path),
  ]);
  return listWorktrees(ctx.primaryRoot)
    .filter(
      (w) =>
        w.path !== ctx.primaryRoot &&
        !managed.has(realOrNull(w.path) ?? w.path),
    )
    .map((w) => ({
      path: w.path,
      branch: w.branch || null,
      prunable: Boolean(w.prunable),
      underAgents: within(ctx.agentsDir, w.path),
    }));
}

function taskSummary(ctx, task, tip) {
  const s = {
    id: task.id,
    role: task.role,
    status: task.status,
    branch: task.branch,
    path: task.path,
    ports: task.ports,
    writablePaths: task.brief.writablePaths,
  };
  if (task.status === "archived") return s;
  const head = branchSha(ctx.primaryRoot, task.branch);
  s.head = head;
  s.commits = head
    ? Number(
        gitOut(ctx.primaryRoot, [
          "rev-list",
          "--count",
          `${task.baseSha}..${head}`,
        ]),
      )
    : null;
  s.worktree = existsSync(task.path) ? "present" : "missing";
  if (s.worktree === "present" && findWorktree(ctx, task.path)) {
    s.dirty = statusEntries(task.path).length;
  }
  s.integrated = isIntegrated(ctx, task, tip);
  if (task.handoff) {
    const { at, commits, remainingWork, session } = task.handoff;
    s.handoff = {
      at,
      commits: commits.length,
      remainingWork: remainingWork.length,
    };
    if (session) s.session = session;
  }
  return s;
}

/** Read-only overview; never creates or rewrites files. */
export function status(ctx, opts, out) {
  const { json, id } = opts;
  const registry = readRegistry(ctx);
  const unmanaged = unmanagedWorktrees(ctx, registry);
  if (!registry) {
    if (json) out(JSON.stringify({ initialized: false, unmanaged }, null, 2));
    else {
      out("not initialized (run `init`)");
      for (const w of unmanaged)
        out(`unmanaged: ${w.path}${w.prunable ? " (prunable)" : ""}`);
    }
    return;
  }
  const integ = integrationState(ctx, registry);
  if (id) {
    const task = registry.tasks[id];
    if (!task) throw new AgentsError(`unknown task ${id}`);
    out(
      JSON.stringify(
        { ...task, summary: taskSummary(ctx, task, integ.tip) },
        null,
        2,
      ),
    );
    return;
  }
  const tasks = Object.values(registry.tasks).map((t) =>
    taskSummary(ctx, t, integ.tip),
  );
  const result = {
    initialized: true,
    integration: {
      ...registry.integration,
      tip: integ.tip,
      problems: integ.problems,
    },
    tasks,
    unmanaged,
  };
  if (json) {
    out(JSON.stringify(result, null, 2));
    return;
  }
  const i = result.integration;
  out(
    `integration ${i.branch} ${short(i.tip)} (base ${short(i.baseSha)}) ports ${i.ports.join(",")}`,
  );
  for (const p of i.problems) out(`  problem: ${p}`);
  for (const t of tasks) {
    const bits = [
      t.status + (t.integrated && t.status === "ready" ? " (integrated)" : ""),
      t.role,
    ];
    if (t.status !== "archived") {
      bits.push(`${t.commits ?? "?"} commit(s)`, `ports ${t.ports.join(",")}`);
      if (t.worktree === "missing") bits.push("worktree missing");
      if (t.dirty) bits.push(`${t.dirty} uncommitted`);
      if (t.handoff?.remainingWork)
        bits.push(`${t.handoff.remainingWork} remaining`);
      if (t.session?.watchPath) bits.push(`watch ${t.session.watchPath}`);
    }
    out(`${t.id}: ${bits.join(", ")}`);
  }
  for (const w of unmanaged)
    out(`unmanaged: ${w.path}${w.prunable ? " (prunable)" : ""}`);
}
