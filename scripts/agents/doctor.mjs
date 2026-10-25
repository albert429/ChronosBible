// Environment and state diagnosis. Strictly read-only: no mkdir, no writes,
// no lock, no fetch; it only reads files, runs read-only Git commands and
// probes ports. Works in a fresh clone without node_modules or credentials.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { git, gitEnv, gitOut, revParse } from "./git.mjs";
import { blockOf, busyPorts } from "./ports.mjs";
import {
  integrationPath,
  loadProfile,
  readRegistry,
  resolveContext,
} from "./state.mjs";
import { BASE_REF } from "./validate.mjs";
import { loadCatalog, unmanagedWorktrees } from "./worktrees.mjs";

const MIN_GIT = [2, 36];

function toolVersion(cmd, args = ["--version"]) {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: gitEnv() });
  return r.status === 0 ? r.stdout.trim().split("\n")[0] : null;
}

export async function doctor(cwd, out, { json = false } = {}) {
  const checks = [];
  const add = (level, message) => checks.push({ level, message });

  const node = process.versions.node;
  add(node.startsWith("22.") ? "ok" : "warn", `node ${node} (engines: 22.x)`);
  const gitVersion = toolVersion("git");
  const [major, minor] = (gitVersion?.match(/(\d+)\.(\d+)/) ?? [])
    .slice(1)
    .map(Number);
  if (!gitVersion) add("error", "git not found");
  else if (major < MIN_GIT[0] || (major === MIN_GIT[0] && minor < MIN_GIT[1])) {
    add("error", `${gitVersion}: need >= ${MIN_GIT.join(".")}`);
  } else add("ok", gitVersion);
  for (const tool of ["npm", "python3"]) {
    const v = toolVersion(tool);
    add(v ? "ok" : "warn", v ? `${tool} ${v}` : `${tool} not found`);
  }

  let ctx;
  try {
    ctx = resolveContext(cwd);
  } catch (error) {
    add("error", error.message);
    return report(checks, out, json);
  }
  add("ok", `primary checkout ${ctx.primaryRoot}`);
  if (ctx.sourceRoot !== ctx.primaryRoot)
    add("ok", `invoked from linked worktree ${ctx.sourceRoot}`);

  try {
    const catalog = loadCatalog(ctx.sourceRoot);
    const missing = catalog.roles.filter(
      (r) => !existsSync(join(ctx.sourceRoot, r.instructions ?? "")),
    );
    if (missing.length)
      add(
        "error",
        `role instructions missing: ${missing.map((r) => r.id).join(", ")}`,
      );
    else add("ok", `catalog: ${catalog.roles.length} roles`);
  } catch (error) {
    add("error", error.message);
  }
  if (!existsSync(join(ctx.sourceRoot, "node_modules"))) {
    add("warn", "node_modules missing: run npm ci --ignore-scripts");
  }
  const adapters = join(
    fileURLToPath(new URL(".", import.meta.url)),
    "adapters.mjs",
  );
  if (!existsSync(adapters))
    add("warn", "adapters module missing: sync/check unavailable");

  // Runtime state must be ignored; shared definitions must stay tracked.
  // `source:line:pattern` of the rule ignoring `p`, or null.
  const ignoredBy = (p) => {
    // Quiet mode distinguishes ignored paths from matching negations; verbose
    // mode exits successfully for both and is only used to explain a real ignore.
    const ignored = git(
      ctx.sourceRoot,
      ["check-ignore", "-q", "--no-index", p],
      {
        allowFail: true,
      },
    );
    if (ignored.status !== 0) return null;
    const r = git(ctx.sourceRoot, ["check-ignore", "-v", "--no-index", p], {
      allowFail: true,
    });
    return r.status === 0
      ? r.out.split("\t")[0].replace(`${ctx.primaryRoot}/`, "")
      : null;
  };
  const before = checks.length;
  for (const p of [
    ".agents/state/registry.json",
    ".agents/worktrees/x/f",
    ".agents/artifacts/x",
  ]) {
    if (!ignoredBy(p)) add("error", `ignore conflict: ${p} is not ignored`);
  }
  const hidden = new Map();
  for (const p of [
    ".agents/catalog.json",
    ".agents/README.md",
    ".agents/roles/x.md",
    ".agents/skills/x.md",
    ".agents/templates/x.json",
  ]) {
    const rule = ignoredBy(p);
    if (rule) hidden.set(rule, [...(hidden.get(rule) ?? []), p]);
  }
  for (const [rule, paths] of hidden) {
    add(
      "warn",
      `ignore conflict: ${rule} hides shared definitions (${paths.join(", ")})`,
    );
  }
  const tracked = gitOut(ctx.sourceRoot, [
    "ls-files",
    "--",
    ".agents/state",
    ".agents/worktrees",
    ".agents/artifacts",
  ]);
  if (tracked) add("error", "runtime files under .agents/ are tracked");
  if (checks.length === before)
    add("ok", "ignore rules keep runtime state local");

  let profile;
  try {
    const loaded = loadProfile(ctx);
    profile = loaded.profile;
    loaded.warnings.forEach((w) => add("warn", w));
    add(
      "ok",
      loaded.present ? "local profile valid" : "no local profile (defaults)",
    );
    if (profile.mediaRoot && !existsSync(profile.mediaRoot))
      add("warn", "mediaRoot does not exist");
  } catch (error) {
    add("error", error.message);
  }

  const baseSha = revParse(ctx.primaryRoot, `refs/remotes/${BASE_REF}`);
  add(
    baseSha ? "ok" : "warn",
    baseSha
      ? `${BASE_REF} ${baseSha.slice(0, 10)} (local ref, not fetched)`
      : `${BASE_REF} not available locally`,
  );

  let registry = null;
  try {
    registry = readRegistry(ctx);
  } catch (error) {
    add("error", error.message);
  }
  if (existsSync(ctx.lockPath)) {
    let owner = "";
    try {
      const o = JSON.parse(
        readFileSync(join(ctx.lockPath, "owner.json"), "utf8"),
      );
      owner = ` by pid ${o.pid} (${o.command}, ${o.startedAt})`;
    } catch {
      // Owner unknown.
    }
    add(
      "warn",
      `registry lock held${owner}; remove ${ctx.lockPath} by hand only if stale`,
    );
  }

  const leases = [];
  if (registry) {
    const i = registry.integration;
    const tip = revParse(ctx.primaryRoot, `refs/heads/${i.branch}`);
    if (!tip) add("error", `${i.branch} missing`);
    else if (!existsSync(integrationPath(ctx)))
      add("error", "integration worktree missing");
    else add("ok", `${i.branch} ${tip.slice(0, 10)}`);
    leases.push(["integration", i.ports]);
    for (const t of Object.values(registry.tasks)) {
      if (t.status === "archived") continue;
      leases.push([t.id, t.ports]);
      if (!existsSync(t.path))
        add("warn", `task ${t.id}: worktree missing at ${t.path}`);
    }
  } else if (profile) {
    leases.push(["base block", blockOf(profile.playwrightPortBase)]);
  }
  for (const [name, ports] of leases) {
    const busy = await busyPorts(ports);
    if (busy.length)
      add(
        "warn",
        `${name} ports in use: ${busy.join(", ")} (running server or conflict)`,
      );
    else add("ok", `${name} ports ${ports.join(", ")} free`);
  }

  for (const w of unmanagedWorktrees(ctx, registry)) {
    if (w.prunable)
      add(
        "warn",
        `stale registration: ${w.path} (prunable; inspect it, never auto-pruned)`,
      );
    else if (w.underAgents)
      add(
        "warn",
        `legacy unmanaged worktree: ${w.path}${w.branch ? ` (${w.branch})` : ""}`,
      );
  }
  return report(checks, out, json);
}

function report(checks, out, json) {
  const errors = checks.filter((c) => c.level === "error").length;
  if (json) out(JSON.stringify({ ok: errors === 0, checks }, null, 2));
  else {
    for (const c of checks) out(`${c.level.padEnd(5)} ${c.message}`);
    out(errors ? `doctor: ${errors} error(s)` : "doctor: ok");
  }
  return errors ? 1 : 0;
}
