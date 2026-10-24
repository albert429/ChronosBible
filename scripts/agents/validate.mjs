// Pure validation: ids, writable paths, briefs, handoff reports, profile and
// registry shape. Functions return error lists instead of throwing.
import { isAbsolute, relative, resolve } from "node:path";

export const INTEGRATION_BRANCH = "agents/integration";
export const BASE_REF = "origin/dev";
export const STATUSES = ["assigned", "ready", "integrated", "archived"];
export const UNFINISHED = ["assigned", "ready"];
export const PROTECTED_BRANCHES = ["main", "master", "dev", INTEGRATION_BRANCH];
export const MAX_AGENTS = 3;

const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GLOB_RE = /[*?[\]{}!]/;
// Common credential shapes; matches are reported by field, never echoed.
const SECRET_RE =
  /sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|bearer\s+[\w.~+/-]{16,}|:\/\/[^/\s:@]+:[^/\s@]+@/i;
const SECRET_KEY_RE = /token|secret|passw|credential|api[-_]?key|auth|cookie/i;

export function taskIdError(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    return "task id must be 1-40 chars of a-z, 0-9 and inner hyphens";
  }
  if (id === "integration") return "`integration` is reserved";
  return null;
}

/** Normalize one writable path: exact file or `dir/` prefix, repo-relative. */
export function writablePathError(path) {
  if (typeof path !== "string" || path === "")
    return "must be a non-empty string";
  if ([...path].some((c) => c === "\\" || c.charCodeAt(0) < 32)) {
    return "contains a backslash or control character";
  }
  if (isAbsolute(path) || /^(?:[A-Za-z]:|:)/.test(path))
    return "must be repo-relative";
  if (GLOB_RE.test(path)) return "globs are not supported; use a file or dir/";
  const segments = path.replace(/\/$/, "").split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    return "empty, `.` or `..` segments are not allowed";
  }
  if (segments.some((s) => s.toLowerCase() === ".git")) return "touches .git";
  return null;
}

const strip = (p) => p.replace(/\/$/, "");
const covers = (scope, path) =>
  scope.endsWith("/") ? path.startsWith(scope) : path === scope;

export const inScope = (path, writablePaths) =>
  writablePaths.some((scope) => covers(scope, path));

export const pathsOverlap = (a, b) =>
  strip(a) === strip(b) || covers(a, b) || covers(b, a);

const nonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
const stringList = (v) => Array.isArray(v) && v.every(nonEmptyString);

function unknownKeys(obj, allowed, label) {
  return Object.keys(obj)
    .filter((k) => !allowed.includes(k))
    .map((k) => `${label}: unknown field \`${k}\``);
}

const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Validate a task brief; returns the normalized brief and errors. */
export function validateBrief(raw) {
  if (!isObject(raw)) return { errors: ["brief must be a JSON object"] };
  const errors = unknownKeys(
    raw,
    ["goal", "writablePaths", "dependencies", "acceptanceChecks"],
    "brief",
  );
  if (!nonEmptyString(raw.goal)) errors.push("brief.goal must be non-empty");
  const paths = raw.writablePaths;
  if (!Array.isArray(paths) || paths.length === 0) {
    errors.push("brief.writablePaths must be a non-empty array");
  } else {
    paths.forEach((p, i) => {
      const error = writablePathError(p);
      if (error)
        errors.push(`brief.writablePaths[${i}] ${JSON.stringify(p)}: ${error}`);
    });
    if (new Set(paths).size !== paths.length) {
      errors.push("brief.writablePaths has duplicates");
    }
  }
  const deps = raw.dependencies ?? [];
  if (!Array.isArray(deps) || deps.some((d) => taskIdError(d))) {
    errors.push("brief.dependencies must be an array of task ids");
  }
  if (!stringList(raw.acceptanceChecks) || raw.acceptanceChecks.length === 0) {
    errors.push("brief.acceptanceChecks must be a non-empty array of strings");
  }
  if (errors.length) return { errors };
  return {
    errors,
    brief: {
      goal: raw.goal.trim(),
      writablePaths: [...paths],
      dependencies: [...deps],
      acceptanceChecks: [...raw.acceptanceChecks],
    },
  };
}

function secretErrors(value, label) {
  if (typeof value === "string") {
    return SECRET_RE.test(value)
      ? [`${label} looks like a credential; remove it`]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => secretErrors(v, `${label}[${i}]`));
  }
  if (isObject(value)) {
    return Object.entries(value).flatMap(([k, v]) =>
      secretErrors(v, `${label}.${k}`),
    );
  }
  return [];
}

const SESSION_KEYS = ["tool", "model", "sessionId", "watchPath", "startedAt"];

/** Optional session metadata: short strings only, never credentials. */
export function validateSession(raw) {
  if (raw === undefined) return [];
  if (!isObject(raw)) return ["report.session must be an object"];
  const errors = [];
  for (const [key, value] of Object.entries(raw)) {
    if (SECRET_KEY_RE.test(key)) {
      errors.push(`report.session.${key}: credential fields are not accepted`);
    } else if (!SESSION_KEYS.includes(key)) {
      errors.push(`report.session: unknown field \`${key}\``);
    } else if (typeof value !== "string" || value.length > 500) {
      errors.push(`report.session.${key} must be a string (<= 500 chars)`);
    }
  }
  return errors;
}

/** Validate a handoff report; commits are derived, not reported. */
export function validateReport(raw) {
  if (!isObject(raw)) return { errors: ["report must be a JSON object"] };
  const errors = unknownKeys(
    raw,
    ["tests", "findings", "remainingWork", "artifacts", "session"],
    "report",
  );
  const tests = raw.tests;
  if (
    !Array.isArray(tests) ||
    !tests.every(
      (t) =>
        isObject(t) &&
        nonEmptyString(t.command) &&
        nonEmptyString(t.result) &&
        Object.keys(t).every((k) => k === "command" || k === "result"),
    )
  ) {
    errors.push("report.tests must be an array of {command, result} strings");
  }
  for (const key of ["findings", "remainingWork", "artifacts"]) {
    if (!stringList(raw[key]))
      errors.push(`report.${key} must be an array of strings`);
  }
  errors.push(...validateSession(raw.session));
  errors.push(...secretErrors(raw, "report"));
  if (errors.length) return { errors };
  const report = {
    tests: tests.map(({ command, result }) => ({ command, result })),
    findings: [...raw.findings],
    remainingWork: [...raw.remainingWork],
    artifacts: [...raw.artifacts],
  };
  if (raw.session) report.session = { ...raw.session };
  return { errors, report };
}

export const PROFILE_DEFAULTS = {
  maxImplementationAgents: MAX_AGENTS,
  integrationBranch: INTEGRATION_BRANCH,
  base: BASE_REF,
  playwrightPortBase: 4400,
  mediaRoot: null,
  allowRemoteActions: false,
  models: null,
};

const within = (root, path) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** Local profile; `models` is advisory passthrough and never acted on. */
export function validateProfile(raw, primaryRoot) {
  const errors = [];
  const warnings = [];
  if (!isObject(raw))
    return { errors: ["profile must be a JSON object"], warnings };
  const p = { ...PROFILE_DEFAULTS, ...raw };
  for (const key of Object.keys(raw)) {
    if (!(key in PROFILE_DEFAULTS))
      warnings.push(`profile: unknown field \`${key}\` ignored`);
  }
  const n = p.maxImplementationAgents;
  if (!Number.isInteger(n) || n < 1 || n > MAX_AGENTS) {
    errors.push(`maxImplementationAgents must be an integer 1-${MAX_AGENTS}`);
  }
  if (p.integrationBranch !== INTEGRATION_BRANCH) {
    errors.push(`integrationBranch must be ${INTEGRATION_BRANCH}`);
  }
  if (p.base !== BASE_REF) errors.push(`base must be ${BASE_REF}`);
  const port = p.playwrightPortBase;
  if (!Number.isInteger(port) || port < 1024 || port > 65000) {
    errors.push("playwrightPortBase must be an integer 1024-65000");
  }
  if (p.mediaRoot !== null) {
    if (typeof p.mediaRoot !== "string" || !isAbsolute(p.mediaRoot)) {
      errors.push("mediaRoot must be an absolute path");
    } else if (within(primaryRoot, resolve(p.mediaRoot))) {
      errors.push("mediaRoot must be outside the checkout and its worktrees");
    }
  }
  if (typeof p.allowRemoteActions !== "boolean") {
    errors.push("allowRemoteActions must be a boolean");
  } else if (p.allowRemoteActions) {
    warnings.push(
      "allowRemoteActions is ignored: the CLI never mutates remotes",
    );
  }
  if (p.models !== null && !isObject(p.models))
    errors.push("models must be an object");
  return { profile: p, errors, warnings };
}

const isPortBlock = (ports) =>
  Array.isArray(ports) &&
  ports.length === 3 &&
  ports.every((p, i) => Number.isInteger(p) && p === ports[0] + i);

export function validateRegistry(reg) {
  if (!isObject(reg) || reg.version !== 1)
    return ["unsupported registry version"];
  const errors = [];
  const integ = reg.integration;
  if (
    !isObject(integ) ||
    integ.branch !== INTEGRATION_BRANCH ||
    typeof integ.path !== "string" ||
    !SHA_RE.test(integ.baseSha ?? "") ||
    !isPortBlock(integ.ports)
  ) {
    errors.push("integration record is malformed");
  }
  if (!isObject(reg.tasks)) return [...errors, "tasks must be an object"];
  for (const [id, t] of Object.entries(reg.tasks)) {
    if (
      taskIdError(id) ||
      !isObject(t) ||
      t.id !== id ||
      t.branch !== `agents/${id}` ||
      typeof t.path !== "string" ||
      !STATUSES.includes(t.status) ||
      !SHA_RE.test(t.baseSha ?? "") ||
      !isPortBlock(t.ports) ||
      !isObject(t.brief) ||
      !Array.isArray(t.brief.writablePaths)
    ) {
      errors.push(`task ${JSON.stringify(id)} is malformed`);
    }
  }
  return errors;
}
