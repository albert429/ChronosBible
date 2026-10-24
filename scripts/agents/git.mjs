// Thin, shell-free Git helpers. Every call runs with GIT_OPTIONAL_LOCKS=0 so
// read-only inspection never refreshes an index, and with inherited
// repository-selecting variables removed so cwd alone picks the repository
// (hooks export GIT_DIR/GIT_INDEX_FILE).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const REPO_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
];

export class AgentsError extends Error {}

export function gitEnv(base = process.env) {
  const env = { ...base, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
  for (const name of REPO_VARS) delete env[name];
  return env;
}

/** Run git; throws AgentsError on failure unless `allowFail`. */
export function git(cwd, args, { allowFail = false } = {}) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: gitEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) {
    const code = /** @type {NodeJS.ErrnoException} */ (r.error).code;
    throw new AgentsError(`git unavailable (${code})`);
  }
  const res = {
    ok: r.status === 0,
    status: r.status,
    out: r.stdout,
    err: r.stderr.trim(),
  };
  if (!res.ok && !allowFail) {
    const why = res.err.split("\n")[0] || `exit ${r.status}`;
    throw new AgentsError(`git ${args[0]} failed: ${why}`);
  }
  return res;
}

export const gitOut = (cwd, args) => git(cwd, args).out.trim();

/** Commit SHA for a ref, or null when it does not resolve. */
export function revParse(cwd, ref) {
  const r = git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    allowFail: true,
  });
  return r.ok ? r.out.trim() : null;
}

export const branchSha = (cwd, branch) => revParse(cwd, `refs/heads/${branch}`);

export function isAncestor(cwd, ancestor, descendant) {
  const r = git(cwd, ["merge-base", "--is-ancestor", ancestor, descendant], {
    allowFail: true,
  });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new AgentsError(`git merge-base failed: ${r.err.split("\n")[0]}`);
}

/** Current branch of a checkout ("" when detached). */
export function currentBranch(cwd) {
  const r = git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
    allowFail: true,
  });
  return r.ok ? r.out.trim() : "";
}

/** `git worktree list --porcelain -z` as objects. */
export function listWorktrees(cwd) {
  const out = git(cwd, ["worktree", "list", "--porcelain", "-z"]).out;
  /** @type {Array<Record<string, any>>} */
  const list = [];
  /** @type {Record<string, any> | null} */
  let cur = null;
  for (const field of out.split("\0")) {
    if (field === "") {
      if (cur) list.push(cur);
      cur = null;
      continue;
    }
    const [key, ...rest] = field.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") cur = { path: value, branch: "", detached: false };
    else if (!cur) continue;
    else if (key === "HEAD") cur.head = value;
    else if (key === "branch") cur.branch = value.replace(/^refs\/heads\//, "");
    else if (key === "detached") cur.detached = true;
    else if (key === "bare") cur.bare = true;
    else if (key === "locked") cur.locked = value || true;
    else if (key === "prunable") cur.prunable = value || true;
  }
  if (cur) list.push(cur);
  return list;
}

/** Tracked changes and untracked (non-ignored) files, v1 porcelain. */
export function statusEntries(cwd) {
  const out = git(cwd, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--no-renames",
  ]).out;
  const fields = out.split("\0");
  const entries = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f) continue;
    const xy = f.slice(0, 2);
    entries.push({ xy, path: f.slice(3) });
    if (/[RC]/.test(xy)) i++;
  }
  return entries;
}

/** Committed changes base..head with rename detection (old and new paths). */
export function diffRaw(cwd, base, head) {
  const out = git(cwd, [
    "diff",
    "--raw",
    "-z",
    "-M",
    "-C",
    "--no-ext-diff",
    "--no-textconv",
    base,
    head,
  ]).out;
  const fields = out.split("\0");
  const entries = [];
  for (let i = 0; i < fields.length; i++) {
    const meta = fields[i];
    if (!meta.startsWith(":")) continue;
    const [oldMode, newMode, , , status] = meta.slice(1).split(" ");
    const kind = status[0];
    const entry = { kind, oldMode, newMode, path: fields[++i] };
    if (kind === "R" || kind === "C") {
      entry.oldPath = entry.path;
      entry.path = fields[++i];
    }
    entries.push(entry);
  }
  return entries;
}

/** Ignored untracked entries; wholly ignored directories collapse to `dir/`. */
export function ignoredEntries(cwd) {
  const out = git(cwd, [
    "ls-files",
    "-z",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
  ]).out;
  return out.split("\0").filter(Boolean);
}

/** In-progress merge/rebase/cherry-pick/revert/bisect markers. */
export function pendingOperations(cwd) {
  const markers = [
    "MERGE_HEAD",
    "rebase-merge",
    "rebase-apply",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
  ];
  const paths = gitOut(cwd, [
    "rev-parse",
    "--path-format=absolute",
    ...markers.flatMap((m) => ["--git-path", m]),
  ]).split("\n");
  return markers.filter((_, i) => existsSync(paths[i]));
}
