import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  pathsOverlap,
  validateBrief,
  validateReport,
  writablePathError,
} from "../scripts/agents/validate.mjs";

const CLI = fileURLToPath(
  new URL("../scripts/agents/cli.mjs", import.meta.url),
);
const GITIGNORE = readFileSync(
  new URL("../.gitignore", import.meta.url),
  "utf8",
);
const temps: string[] = [];
after(() => temps.forEach((t) => rmSync(t, { recursive: true, force: true })));

type Result = { code: number; stdout: string; stderr: string };

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.test",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.test",
    AGENTS_LOCK_TIMEOUT_MS: "10000",
    ...extra,
  };
  for (const k of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "INIT_CWD",
    "AGENTS_FAULT",
  ]) {
    if (!(k in extra)) delete e[k];
  }
  return e;
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, env: env(), encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function cli(
  cwd: string,
  args: string[],
  extra: Record<string, string> = {},
): Result {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: env(extra),
    encoding: "utf8",
  });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function cliAsync(cwd: string, args: string[]): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: env() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function ok(r: Result): Result {
  assert.equal(r.code, 0, `expected success:\n${r.stdout}\n${r.stderr}`);
  return r;
}

function write(root: string, rel: string, text = `${rel}\n`): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

const brief = (writablePaths: string[], dependencies: string[] = []) =>
  JSON.stringify({
    goal: "Test goal",
    writablePaths,
    dependencies,
    acceptanceChecks: ["npm test"],
  });

const report = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    tests: [{ command: "npm test", result: "passed" }],
    findings: [],
    remainingWork: [],
    artifacts: [],
    ...extra,
  });

let nextBase = 20000 + Math.floor(Math.random() * 300) * 100;

/** A primary checkout (path with spaces) with origin/dev and a local profile. */
function makeRepo(
  profile: Record<string, unknown> = {},
  setup?: (repo: string) => void,
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "agents wf ")));
  temps.push(root);
  const repo = join(root, "primary repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  write(repo, ".gitignore", GITIGNORE);
  write(
    repo,
    ".agents/catalog.json",
    JSON.stringify({
      version: 1,
      roles: ["ui-ux", "qa-performance"].map((id) => ({
        id,
        instructions: `.agents/roles/${id}.md`,
      })),
    }),
  );
  write(repo, ".agents/roles/ui-ux.md");
  write(repo, ".agents/roles/qa-performance.md");
  for (const f of ["src/plan/a.ts", "src/other/b.ts", "src/c.ts", "README.md"])
    write(repo, f);
  setup?.(repo);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  git(repo, "update-ref", "refs/remotes/origin/dev", "HEAD");
  const base = (nextBase += 100);
  write(
    repo,
    ".agents/state/local-profile.json",
    JSON.stringify({ playwrightPortBase: base, ...profile }),
  );
  const wt = (id: string) => join(repo, ".agents", "worktrees", id);
  const registry = () =>
    JSON.parse(readFileSync(join(repo, ".agents/state/registry.json"), "utf8"));
  return { root, repo, base, wt, registry };
}

/** Initialized repo plus a task with one in-scope commit and a ready handoff. */
function readyTask(id = "t1", paths = ["src/plan/"]) {
  const r = makeRepo();
  ok(cli(r.repo, ["init"]));
  ok(cli(r.repo, ["create", id, "--role", "ui-ux", "--brief", brief(paths)]));
  write(r.wt(id), "src/plan/new.ts");
  git(r.wt(id), "add", "-A");
  git(r.wt(id), "commit", "-qm", "work");
  ok(cli(r.repo, ["handoff", id, "--report", report()]));
  return r;
}

const integrate = (r: ReturnType<typeof makeRepo>, id: string) =>
  git(
    r.wt("integration"),
    "merge",
    "-q",
    "--no-ff",
    "-m",
    `merge ${id}`,
    `agents/${id}`,
  );

function listen(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}

/** Paths, sizes and mtimes under `dir` (for read-only assertions). */
function snapshot(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .sort()
    .map((p) => {
      const st = statSync(join(dir, p));
      return `${p}:${st.size}:${st.mtimeMs}`;
    });
}

test("validators reject unsafe paths and malformed briefs and reports", () => {
  for (const bad of [
    "/etc/passwd",
    "../x",
    "src/../x",
    "src/*.ts",
    "a//b",
    ".git/config",
    "src/.GIT/x",
    "a\\b",
    "./a",
    ":(top)x",
  ]) {
    assert.ok(writablePathError(bad), bad);
  }
  for (const good of ["src/plan/", "tests/plan.test.ts", ".agents/README.md"]) {
    assert.equal(writablePathError(good), null, good);
  }
  assert.ok(pathsOverlap("src/plan/", "src/plan/a.ts"));
  assert.ok(pathsOverlap("src/plan", "src/plan/"));
  assert.ok(!pathsOverlap("src/plan/", "src/planner.ts"));
  assert.ok(
    validateBrief({ writablePaths: ["a"], acceptanceChecks: ["x"] }).errors
      .length,
  );
  assert.ok(
    validateBrief({ goal: "g", acceptanceChecks: ["x"] }).errors.length,
  );
  assert.ok(
    validateBrief({ goal: "g", writablePaths: ["a"], acceptanceChecks: [] })
      .errors.length,
  );
  assert.ok(
    validateBrief({
      goal: "g",
      writablePaths: ["a"],
      acceptanceChecks: ["x"],
      extra: 1,
    }).errors.length,
  );
  assert.deepEqual(validateBrief(JSON.parse(brief(["src/"]))).errors, []);
  const secret = validateReport({
    ...JSON.parse(report()),
    session: { tool: "x", apiKey: "k" },
  });
  assert.match(secret.errors.join(), /credential fields/);
  const token = validateReport({
    ...JSON.parse(report()),
    findings: ["used sk-abcdefghijklmnopqrstuv"],
  });
  assert.match(
    token.errors.join(),
    /report.findings\[0\] looks like a credential/,
  );
  assert.doesNotMatch(token.errors.join(), /sk-abc/);
});

test("init records origin/dev, is idempotent, and refuses conflicts without residue", () => {
  const r = makeRepo();
  const dev = git(r.repo, "rev-parse", "origin/dev");
  git(r.repo, "commit", "-q", "--allow-empty", "-m", "main moves on");
  ok(cli(r.repo, ["init"]));
  assert.equal(git(r.wt("integration"), "rev-parse", "HEAD"), dev);
  assert.equal(
    git(r.wt("integration"), "branch", "--show-current"),
    "agents/integration",
  );
  assert.equal(r.registry().integration.baseSha, dev);
  assert.match(ok(cli(r.repo, ["init"])).stdout, /already initialized/);

  const taken = makeRepo();
  git(taken.repo, "branch", "agents/integration");
  rmSync(join(taken.repo, ".agents/state"), { recursive: true });
  const res = cli(taken.repo, ["init"]);
  assert.equal(res.code, 1);
  assert.match(res.stderr, /already exists/);
  assert.ok(!existsSync(join(taken.repo, ".agents/state")));

  const noDev = makeRepo();
  git(noDev.repo, "update-ref", "-d", "refs/remotes/origin/dev");
  assert.match(cli(noDev.repo, ["init"]).stderr, /never fetches/);
  assert.ok(!existsSync(noDev.wt("integration")));
});

test("the registry is shared by every linked worktree", () => {
  const r = makeRepo();
  ok(cli(r.repo, ["init"]));
  // Create from inside the integration worktree; state lands in the primary.
  ok(
    cli(r.wt("integration"), [
      "create",
      "t1",
      "--role",
      "ui-ux",
      "--brief",
      brief(["src/plan/"]),
    ]),
  );
  assert.ok(existsSync(r.wt("t1")));
  assert.ok(!existsSync(join(r.wt("integration"), ".agents/state")));
  const fromTask = JSON.parse(ok(cli(r.wt("t1"), ["status", "--json"])).stdout);
  const fromPrimary = JSON.parse(ok(cli(r.repo, ["status", "--json"])).stdout);
  assert.deepEqual(fromTask, fromPrimary);
  assert.equal(fromTask.tasks[0].id, "t1");
  assert.equal(git(r.wt("t1"), "branch", "--show-current"), "agents/t1");
});

test("create checks roles, dependencies, path claims, symlinks and the limit", () => {
  const r = makeRepo({ maxImplementationAgents: 2 }, (repo) => {
    symlinkSync("../outside", join(repo, "link"));
  });
  ok(cli(r.repo, ["init"]));
  const create = (
    id: string,
    paths: string[],
    deps: string[] = [],
    role = "ui-ux",
  ) =>
    cli(r.repo, ["create", id, "--role", role, "--brief", brief(paths, deps)]);
  assert.match(create("x", ["src/c.ts"], [], "nope").stderr, /unknown role/);
  assert.match(
    create("x", ["src/c.ts"], ["ghost"]).stderr,
    /dependency ghost does not exist/,
  );
  assert.match(create("x", ["link/inside.ts"]).stderr, /symlink/);
  assert.match(create("Bad_Id", ["src/c.ts"]).stderr, /task id/);
  ok(create("t1", ["src/plan/"]));
  assert.match(
    create("t2", ["src/plan/a.ts"]).stderr,
    /overlaps src\/plan\/ claimed by t1/,
  );
  assert.match(
    create("t2", ["src/c.ts"], ["t1"]).stderr,
    /dependency t1 is assigned/,
  );
  ok(create("t2", ["src/other/"]));
  assert.match(create("t3", ["src/c.ts"]).stderr, /limit is 2/);
  const branches = git(
    r.repo,
    "branch",
    "--list",
    "agents/*",
    "--format=%(refname:short)",
  );
  assert.deepEqual(branches.split("\n").sort(), [
    "agents/integration",
    "agents/t1",
    "agents/t2",
  ]);
  assert.deepEqual(readdirSync(join(r.repo, ".agents/worktrees")).sort(), [
    "integration",
    "t1",
    "t2",
  ]);
});

test("concurrent creates are serialized by the lock and capped at three", async () => {
  const r = makeRepo();
  ok(cli(r.repo, ["init"]));
  const results = await Promise.all(
    ["a", "b", "c", "d", "e"].map((id) =>
      cliAsync(r.repo, [
        "create",
        id,
        "--role",
        "ui-ux",
        "--brief",
        brief([`src/${id}/`]),
      ]),
    ),
  );
  assert.equal(results.filter((x) => x.code === 0).length, 3);
  for (const x of results.filter((x) => x.code !== 0))
    assert.match(x.stderr, /limit is 3/);
  const reg = r.registry();
  const blocks = [
    reg.integration.ports,
    ...Object.values<{ ports: number[] }>(reg.tasks).map((t) => t.ports),
  ];
  assert.equal(new Set(blocks.flat()).size, 12);
  assert.ok(!existsSync(join(r.repo, ".agents/state/registry.lock")));
});

test("a held lock times out and is never reclaimed", () => {
  const r = makeRepo();
  ok(cli(r.repo, ["init"]));
  const lock = join(r.repo, ".agents/state/registry.lock");
  mkdirSync(lock);
  writeFileSync(
    join(lock, "owner.json"),
    JSON.stringify({
      pid: 999999,
      host: "h",
      command: "create z",
      startedAt: "then",
    }),
  );
  const res = cli(
    r.repo,
    ["create", "t1", "--role", "ui-ux", "--brief", brief(["src/"])],
    {
      AGENTS_LOCK_TIMEOUT_MS: "200",
    },
  );
  assert.equal(res.code, 1);
  assert.match(res.stderr, /locked \(pid 999999.*by hand/);
  assert.ok(existsSync(join(lock, "owner.json")));
  assert.match(
    ok(cli(r.repo, ["doctor"])).stdout,
    /registry lock held by pid 999999/,
  );
});

test("port blocks skip leased and busy ports", async () => {
  const r = makeRepo();
  const busy = await listen(r.base + 4);
  try {
    ok(cli(r.repo, ["init"]));
    assert.deepEqual(r.registry().integration.ports, [
      r.base,
      r.base + 1,
      r.base + 2,
    ]);
    ok(
      cli(r.repo, [
        "create",
        "t1",
        "--role",
        "ui-ux",
        "--brief",
        brief(["src/"]),
      ]),
    );
    assert.deepEqual(r.registry().tasks.t1.ports, [
      r.base + 6,
      r.base + 7,
      r.base + 8,
    ]);
    assert.match(ok(cli(r.repo, ["doctor"])).stdout, /ok +t1 ports/);
  } finally {
    busy.close();
  }
});

test("create rolls back only what it created", () => {
  const r = makeRepo();
  ok(cli(r.repo, ["init"]));
  const res = cli(
    r.repo,
    ["create", "t1", "--role", "ui-ux", "--brief", brief(["src/"])],
    {
      AGENTS_FAULT: "create:after-worktree",
    },
  );
  assert.match(res.stderr, /injected fault/);
  assert.ok(!existsSync(r.wt("t1")));
  assert.equal(git(r.repo, "branch", "--list", "agents/t1"), "");
  assert.deepEqual(r.registry().tasks, {});
  // A pre-existing branch with the task's name is left exactly as it was.
  git(r.repo, "branch", "agents/t2", "HEAD");
  const before = git(r.repo, "rev-parse", "agents/t2");
  assert.match(
    cli(r.repo, ["create", "t2", "--role", "ui-ux", "--brief", brief(["src/"])])
      .stderr,
    /already exists/,
  );
  assert.equal(git(r.repo, "rev-parse", "agents/t2"), before);
  assert.ok(!existsSync(r.wt("t2")));
});

test("handoff checks scope, renames, deletions, symlinks, dirt, branch and base", () => {
  const r = makeRepo();
  ok(cli(r.repo, ["init"]));
  ok(
    cli(r.repo, [
      "create",
      "t1",
      "--role",
      "ui-ux",
      "--brief",
      brief(["src/plan/"]),
    ]),
  );
  const w = r.wt("t1");
  const handoff = (extra = {}) =>
    cli(r.repo, ["handoff", "t1", "--report", report(extra)]);
  const commit = (msg: string) => (
    git(w, "add", "-A"),
    git(w, "commit", "-qm", msg)
  );
  const undo = () => git(w, "reset", "-q", "--hard", "HEAD~1");

  write(w, "src/plan/a.ts", "changed\n");
  commit("in scope");
  write(w, "notes.txt");
  assert.match(
    handoff().stderr,
    /untracked: notes.txt \(outside writablePaths\)/,
  );
  rmSync(join(w, "notes.txt"));
  write(w, "src/plan/a.ts", "dirty\n");
  assert.match(handoff().stderr, /uncommitted: src\/plan\/a.ts/);
  git(w, "checkout", "--", "src/plan/a.ts");

  git(w, "mv", "src/other/b.ts", "src/plan/b.ts");
  commit("rename in");
  assert.match(
    handoff().stderr,
    /outside writablePaths: src\/other\/b.ts \(renamed\)/,
  );
  undo();
  git(w, "rm", "-q", "src/c.ts");
  commit("delete outside");
  assert.match(
    handoff().stderr,
    /outside writablePaths: src\/c.ts \(deleted\)/,
  );
  undo();
  symlinkSync("../../README.md", join(w, "src/plan/link.ts"));
  commit("symlink");
  assert.match(handoff().stderr, /symlink committed: src\/plan\/link.ts/);
  undo();

  assert.match(
    handoff({ session: { tool: "t", token: "x" } }).stderr,
    /credential fields/,
  );
  git(w, "switch", "-q", "-c", "elsewhere");
  assert.match(handoff().stderr, /expected agents\/t1/);
  git(w, "switch", "-q", "agents/t1");

  const remaining = ok(
    handoff({
      remainingWork: ["screenshots"],
      session: { tool: "cli", watchPath: "/tmp/s.log" },
    }),
  );
  assert.match(remaining.stdout, /status assigned/);
  const done = ok(handoff());
  assert.match(done.stdout, /1 commit\(s\), 1 path\(s\), status ready/);
  const h = r.registry().tasks.t1.handoff;
  assert.equal(h.commits[0].subject, "in scope");
  assert.equal(h.headSha, git(w, "rev-parse", "HEAD"));

  const orphan = git(
    w,
    "commit-tree",
    "-m",
    "orphan",
    git(w, "rev-parse", "HEAD^{tree}"),
  );
  git(w, "reset", "-q", "--hard", orphan);
  assert.match(
    cli(r.repo, ["handoff", "t1", "--report", report()]).stderr,
    /does not descend/,
  );
});

test("cleanup previews by default, blocks unsafe state, and applies after integration", () => {
  const r = readyTask();
  const w = r.wt("t1");
  const registryBytes = readFileSync(
    join(r.repo, ".agents/state/registry.json"),
    "utf8",
  );
  const dry = cli(r.repo, ["cleanup", "t1"]);
  assert.equal(dry.code, 1);
  assert.match(
    dry.stdout,
    /dry run[\s\S]*blocked: handoff head \w+ is not merged into agents\/integration/,
  );
  integrate(r, "t1");

  write(w, "stray.txt");
  assert.match(
    cli(r.repo, ["cleanup", "t1"]).stdout,
    /blocked: untracked: stray.txt/,
  );
  rmSync(join(w, "stray.txt"));
  write(w, "README.md", "edited\n");
  assert.match(
    cli(r.repo, ["cleanup", "t1"]).stdout,
    /blocked: uncommitted: README.md/,
  );
  git(w, "checkout", "--", "README.md");

  write(w, "public/audio/day1.mp3", "media");
  const media = cli(r.repo, [
    "cleanup",
    "t1",
    "--apply",
    "--discard-generated",
  ]);
  assert.match(
    media.stderr,
    /ignored file blocks removal \(unrecognized\): public\/audio\//,
  );
  assert.ok(existsSync(join(w, "public/audio/day1.mp3")));
  rmSync(join(w, "public"), { recursive: true });

  mkdirSync(join(r.root, "shared_modules"));
  symlinkSync(join(r.root, "shared_modules"), join(w, "node_modules"));
  assert.match(
    cli(r.repo, ["cleanup", "t1", "--discard-generated"]).stdout,
    /untracked: node_modules/,
  );
  rmSync(join(w, "node_modules"));
  symlinkSync(join(r.root, "shared_modules"), join(w, "cache.tsbuildinfo"));
  assert.match(
    cli(r.repo, ["cleanup", "t1", "--discard-generated"]).stdout,
    /\(symlink\): cache.tsbuildinfo/,
  );
  rmSync(join(w, "cache.tsbuildinfo"));

  write(w, "dist/index.html");
  write(w, ".DS_Store");
  const preview = cli(r.repo, ["cleanup", "t1"]);
  assert.match(
    preview.stdout,
    /generated: dist\/[\s\S]*rerun with --discard-generated/,
  );
  assert.equal(cli(r.repo, ["cleanup", "t1", "--apply"]).code, 1);
  assert.equal(
    readFileSync(join(r.repo, ".agents/state/registry.json"), "utf8"),
    registryBytes,
  );

  assert.match(
    ok(cli(r.repo, ["cleanup", "t1", "--discard-generated"])).stdout,
    /result: ready/,
  );
  const applied = ok(
    cli(r.repo, ["cleanup", "t1", "--apply", "--discard-generated"]),
  );
  assert.match(
    applied.stdout,
    /discarded dist\/[\s\S]*deleted branch agents\/t1[\s\S]*archived t1/,
  );
  assert.ok(!existsSync(w));
  assert.ok(existsSync(join(r.root, "shared_modules")));
  assert.equal(git(r.repo, "branch", "--list", "agents/t1"), "");
  assert.equal(r.registry().tasks.t1.status, "archived");
  assert.equal(
    git(r.wt("integration"), "branch", "--show-current"),
    "agents/integration",
  );
  assert.match(cli(r.repo, ["cleanup", "t1"]).stderr, /already archived/);
  // Archived dependencies count as integrated.
  ok(
    cli(r.repo, [
      "create",
      "t2",
      "--role",
      "ui-ux",
      "--brief",
      brief(["src/plan/"], ["t1"]),
    ]),
  );
});

test("cleanup protects integration, foreign paths, unfinished and unintegrated work", () => {
  const r = readyTask();
  assert.match(
    cli(r.repo, ["cleanup", "integration", "--apply"]).stderr,
    /protected/,
  );
  integrate(r, "t1");

  // A ready task merged into integration satisfies dependencies.
  ok(
    cli(r.repo, [
      "create",
      "dep",
      "--role",
      "ui-ux",
      "--brief",
      brief(["docs/"], ["t1"]),
    ]),
  );
  assert.equal(r.registry().tasks.t1.status, "integrated");
  ok(
    cli(r.repo, [
      "handoff",
      "t1",
      "--report",
      report({ remainingWork: ["more"] }),
    ]),
  );
  assert.match(cli(r.repo, ["cleanup", "t1"]).stdout, /1 remaining work item/);
  ok(
    cli(r.repo, [
      "handoff",
      "t1",
      "--report",
      report({ artifacts: ["artifacts/shot.png"] }),
    ]),
  );
  assert.match(
    cli(r.repo, ["cleanup", "t1"]).stdout,
    /artifact missing: artifacts\/shot.png/,
  );
  write(r.repo, "artifacts/shot.png");
  assert.match(ok(cli(r.repo, ["cleanup", "t1"])).stdout, /result: ready/);
  assert.match(
    cli(r.wt("t1"), ["cleanup", "t1"]).stdout,
    /outside the task worktree/,
  );

  const regPath = join(r.repo, ".agents/state/registry.json");
  const reg = r.registry();
  reg.tasks.t1.path = r.wt("integration");
  writeFileSync(regPath, JSON.stringify(reg));
  const foreign = cli(r.repo, ["cleanup", "t1", "--apply"]);
  assert.match(foreign.stderr, /not the managed path/);
  assert.ok(existsSync(r.wt("integration")));
  reg.tasks.t1.path = r.wt("t1");
  writeFileSync(regPath, JSON.stringify(reg));

  // A task without its own commits is never "integrated" by ancestry alone.
  ok(
    cli(r.repo, [
      "create",
      "t2",
      "--role",
      "qa-performance",
      "--brief",
      brief(["tests/"]),
    ]),
  );
  ok(cli(r.repo, ["handoff", "t2", "--report", report()]));
  assert.match(
    cli(r.repo, ["cleanup", "t2"]).stdout,
    /no commits beyond its base/,
  );

  // Unmerged state blocks too.
  ok(
    cli(r.repo, [
      "create",
      "t3",
      "--role",
      "ui-ux",
      "--brief",
      brief(["src/c.ts"]),
    ]),
  );
  const w3 = r.wt("t3");
  write(w3, "src/c.ts", "ours\n");
  git(w3, "commit", "-qam", "ours");
  git(w3, "switch", "-q", "-c", "side", "HEAD~1");
  write(w3, "src/c.ts", "theirs\n");
  git(w3, "commit", "-qam", "theirs");
  git(w3, "switch", "-q", "agents/t3");
  spawnSync("git", ["merge", "-q", "side"], { cwd: w3, env: env() });
  assert.match(
    cli(r.repo, ["handoff", "t3", "--report", report()]).stderr,
    /unmerged: src\/c.ts/,
  );
  const conflicted = cli(r.repo, ["cleanup", "t3"]).stdout;
  assert.match(conflicted, /operation in progress: MERGE_HEAD/);
  assert.match(conflicted, /unmerged: src\/c.ts/);
});

test("a drifted handoff keeps its claims until a fresh handoff", () => {
  const r = readyTask("t1", ["src/"]);
  const w = r.wt("t1");
  integrate(r, "t1");
  const claim = (id: string, path: string, deps: string[] = []) =>
    cli(r.repo, [
      "create",
      id,
      "--role",
      "ui-ux",
      "--brief",
      brief([path], deps),
    ]);
  const commit = (rel: string) => {
    write(w, rel);
    git(w, "add", "-A");
    git(w, "commit", "-qm", rel);
  };

  // Committed after the merged handoff: neither integrated nor released.
  commit("src/late.ts");
  assert.match(claim("t2", "src/plan/").stderr, /overlaps src\/ claimed by t1/);
  assert.match(
    claim("t2", "docs/", ["t1"]).stderr,
    /dependency t1 is assigned/,
  );
  assert.equal(r.registry().tasks.t1.status, "ready");
  assert.match(
    ok(cli(r.repo, ["status"])).stdout,
    /t1: ready.*now assigned.*stale handoff: branch moved since the handoff/,
  );
  git(w, "reset", "-q", "--hard", "HEAD~1");
  ok(claim("t2", "src/plan/"));
  assert.equal(r.registry().tasks.t1.status, "integrated");

  // An integrated task that gets dirty or advances takes its claims back.
  write(w, "src/dirty.ts");
  assert.match(
    claim("t3", "src/other/").stderr,
    /overlaps src\/ claimed by t1/,
  );
  rmSync(join(w, "src/dirty.ts"));
  commit("src/later.ts");
  assert.match(
    claim("t3", "src/other/").stderr,
    /overlaps src\/ claimed by t1/,
  );
  assert.match(
    cli(r.repo, ["cleanup", "t1"]).stdout,
    /branch moved since the handoff/,
  );
  ok(cli(r.repo, ["handoff", "t1", "--report", report()]));
  assert.equal(r.registry().tasks.t1.status, "ready");
  assert.match(claim("t3", "src/other/").stderr, /claimed by t1/);
  integrate(r, "t1");
  ok(claim("t3", "src/other/"));
});

test("cleanup never archives work it cannot prove integrated", () => {
  const r = readyTask();
  git(r.repo, "worktree", "remove", r.wt("t1"));
  git(r.repo, "branch", "-q", "-D", "agents/t1");
  const res = cli(r.repo, ["cleanup", "t1", "--apply"]);
  assert.equal(res.code, 1);
  assert.match(
    res.stderr,
    /not merged into agents\/integration[\s\S]*branch agents\/t1 is missing; the registry entry is kept/,
  );
  assert.equal(r.registry().tasks.t1.status, "ready");
  const t2 = brief(["src/plan/x.ts"]);
  assert.match(
    cli(r.repo, ["create", "t2", "--role", "ui-ux", "--brief", t2]).stderr,
    /claimed by t1/,
  );

  // Without a handoff nothing can be proven either.
  ok(
    cli(r.repo, [
      "create",
      "t3",
      "--role",
      "ui-ux",
      "--brief",
      brief(["docs/"]),
    ]),
  );
  git(r.repo, "worktree", "remove", r.wt("t3"));
  git(r.repo, "branch", "-q", "-D", "agents/t3");
  assert.match(
    cli(r.repo, ["cleanup", "t3", "--apply"]).stderr,
    /no handoff recorded, so integration cannot be proven/,
  );
  assert.equal(r.registry().tasks.t3.status, "assigned");

  // A merged handoff whose branch is already gone is provably integrated.
  const m = readyTask();
  integrate(m, "t1");
  git(m.repo, "worktree", "remove", m.wt("t1"));
  git(m.wt("integration"), "branch", "-q", "-d", "agents/t1");
  ok(cli(m.repo, ["cleanup", "t1", "--apply"]));
  assert.equal(m.registry().tasks.t1.status, "archived");
});

test("a failed create keeps a checkout it cannot remove, and its branch", () => {
  const r = makeRepo();
  ok(cli(r.repo, ["init"]));
  writeFileSync(
    join(r.repo, ".git/hooks/post-checkout"),
    "#!/bin/sh\necho hook output > hook-file.txt\n",
    { mode: 0o755 },
  );
  const create = (id: string, extra: Record<string, string> = {}) =>
    cli(
      r.repo,
      ["create", id, "--role", "ui-ux", "--brief", brief(["src/plan/"])],
      extra,
    );
  const res = create("t1", { AGENTS_FAULT: "create:after-worktree" });
  assert.equal(res.code, 1);
  assert.match(
    res.stderr,
    /injected fault[\s\S]*kept .*t1[\s\S]*kept branch agents\/t1[\s\S]*recorded t1 for recovery/,
  );
  const w = r.wt("t1");
  assert.equal(readFileSync(join(w, "hook-file.txt"), "utf8"), "hook output\n");
  const tip = git(r.repo, "rev-parse", "refs/heads/agents/t1");
  assert.equal(git(w, "rev-parse", "HEAD"), tip);
  assert.equal(git(w, "branch", "--show-current"), "agents/t1");
  assert.match(r.registry().tasks.t1.recovery.error, /injected fault/);
  assert.match(
    ok(cli(r.repo, ["status"])).stdout,
    /t1: assigned.*needs recovery/,
  );
  assert.doesNotMatch(ok(cli(r.repo, ["doctor"])).stdout, /unmanaged worktree/);
  assert.match(create("t2").stderr, /claimed by t1/);

  assert.match(
    cli(r.repo, ["cleanup", "t1"]).stdout,
    /untracked: hook-file.txt/,
  );
  rmSync(join(w, "hook-file.txt"));
  ok(cli(r.repo, ["cleanup", "t1", "--apply"]));
  assert.equal(r.registry().tasks.t1.status, "archived");
  assert.equal(git(r.repo, "branch", "--list", "agents/t1"), "");
});

test("doctor and status never create or modify files", () => {
  const fresh = makeRepo();
  rmSync(join(fresh.repo, ".agents/state"), { recursive: true });
  const doc = ok(cli(fresh.repo, ["doctor"]));
  assert.match(doc.stdout, /no local profile[\s\S]*doctor: ok/);
  assert.match(ok(cli(fresh.repo, ["status"])).stdout, /not initialized/);
  assert.ok(!existsSync(join(fresh.repo, ".agents/state")));

  const r = readyTask();
  write(r.wt("t1"), "dirty.txt");
  const state = join(r.repo, ".agents/state");
  const gitWorktrees = join(r.repo, ".git/worktrees");
  const before = [snapshot(state), snapshot(gitWorktrees)];
  ok(cli(r.repo, ["doctor"]));
  ok(cli(r.wt("t1"), ["status"]));
  const one = JSON.parse(ok(cli(r.repo, ["status", "t1"])).stdout);
  assert.equal(one.summary.dirty, 1);
  cli(r.repo, ["cleanup", "t1"]);
  assert.deepEqual([snapshot(state), snapshot(gitWorktrees)], before);

  // Stale registrations are reported, never pruned.
  git(
    r.repo,
    "worktree",
    "add",
    "-q",
    "--detach",
    join(r.repo, ".agents/legacy"),
  );
  rmSync(join(r.repo, ".agents/legacy"), { recursive: true });
  assert.match(
    ok(cli(r.repo, ["doctor"])).stdout,
    /stale registration: .*legacy/,
  );
  assert.match(git(r.repo, "worktree", "list", "--porcelain"), /legacy/);
});
