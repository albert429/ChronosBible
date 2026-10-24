// Checkout roots, local profile, registry persistence and the registry lock.
// Definitions (catalog, roles) come from the current checkout; runtime state
// is anchored in the primary checkout found through the Git common dir, so
// every linked worktree shares one registry.
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { AgentsError, git, gitOut } from "./git.mjs";
import { validateProfile, validateRegistry } from "./validate.mjs";

export function resolveContext(cwd = process.cwd()) {
  const top = git(cwd, ["rev-parse", "--show-toplevel"], { allowFail: true });
  if (!top.ok) throw new AgentsError("not inside a Git checkout");
  const commonDir = realpathSync(
    gitOut(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  );
  if (basename(commonDir) !== ".git") {
    throw new AgentsError(
      "unsupported repository layout (bare repository or separate Git dir)",
    );
  }
  const primaryRoot = dirname(commonDir);
  const agentsDir = join(primaryRoot, ".agents");
  const stateDir = join(agentsDir, "state");
  return {
    cwd: realpathSync(cwd),
    sourceRoot: realpathSync(top.out.trim()),
    primaryRoot,
    commonDir,
    agentsDir,
    stateDir,
    worktreesDir: join(agentsDir, "worktrees"),
    registryPath: join(stateDir, "registry.json"),
    lockPath: join(stateDir, "registry.lock"),
    profilePath: join(stateDir, "local-profile.json"),
  };
}

export const integrationPath = (ctx) => join(ctx.worktreesDir, "integration");
export const taskPath = (ctx, id) => join(ctx.worktreesDir, id);

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new AgentsError(`${label}: unreadable JSON (${error.message})`);
  }
}

/** Profile with defaults applied; never creates the file. */
export function loadProfile(ctx) {
  const present = existsSync(ctx.profilePath);
  const raw = present ? readJson(ctx.profilePath, "local profile") : {};
  const { profile, errors, warnings } = validateProfile(raw, ctx.primaryRoot);
  if (errors.length) {
    throw new AgentsError(`local profile invalid:\n- ${errors.join("\n- ")}`);
  }
  return { profile, warnings, present };
}

export function readRegistry(ctx) {
  if (!existsSync(ctx.registryPath)) return null;
  const registry = readJson(ctx.registryPath, "registry");
  const errors = validateRegistry(registry);
  if (errors.length) {
    throw new AgentsError(`registry invalid:\n- ${errors.join("\n- ")}`);
  }
  return registry;
}

export function requireRegistry(ctx) {
  const registry = readRegistry(ctx);
  if (!registry) throw new AgentsError("not initialized; run `init` first");
  return registry;
}

/** Write JSON atomically: temp file in the same dir, fsync, rename. */
export function writeJsonAtomic(path, value) {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/**
 * Run `fn` holding the registry lock (an atomic mkdir). A held lock is waited
 * on, never reclaimed: a stale one must be removed by hand.
 */
export async function withLock(ctx, command, fn) {
  if (!existsSync(ctx.stateDir)) {
    throw new AgentsError("not initialized; run `init` first");
  }
  const timeout = Number(process.env.AGENTS_LOCK_TIMEOUT_MS ?? 15000);
  const deadline = Date.now() + timeout;
  for (;;) {
    try {
      mkdirSync(ctx.lockPath);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw lockBusy(ctx);
      await sleep(25 + Math.random() * 50);
    }
  }
  const ownerPath = join(ctx.lockPath, "owner.json");
  const release = () => {
    rmSync(ownerPath, { force: true });
    try {
      rmdirSync(ctx.lockPath);
    } catch {
      // Left for manual inspection if something else was placed inside.
    }
  };
  const onSignal = (signal) => {
    release();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    writeJsonAtomic(ownerPath, {
      pid: process.pid,
      host: hostname(),
      command,
      startedAt: new Date().toISOString(),
    });
    return await fn();
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    release();
  }
}

function lockBusy(ctx) {
  let owner = "unknown owner";
  try {
    const o = JSON.parse(
      readFileSync(join(ctx.lockPath, "owner.json"), "utf8"),
    );
    owner = `pid ${o.pid} on ${o.host}, \`${o.command}\` since ${o.startedAt}`;
  } catch {
    // Owner file missing or partial: still never reclaimed automatically.
  }
  return new AgentsError(
    `registry is locked (${owner}). If no agents command is running, ` +
      `remove ${ctx.lockPath} by hand.`,
  );
}

/** Remove a path this command created, only if it is an empty directory. */
export function removeIfEmptyDir(path) {
  try {
    rmdirSync(path);
  } catch {
    // Not empty or already gone: keep it.
  }
}
