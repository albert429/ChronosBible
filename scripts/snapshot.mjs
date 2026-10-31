// Snapshot of everything the build generates, for refactor comparisons.
//
//   node scripts/snapshot.mjs capture <dir> [--label <name>] [--dist <folder>] [--root <repo>]
//   node scripts/snapshot.mjs compare <baseline-dir> [<candidate-dir>] [--full]
//
// `capture` writes <dir>/snapshot.json: the complete relative-path set and the
// SHA-256 of every byte under public/{readings,bible,chronology,study,audio}
// (what the generators produced), the same folders inside the built <dist>
// (what actually ships, after build filtering), the other files in <dist>, and
// size measurements of the bundle. `compare` exits 1 and lists added, removed
// and changed paths when generated or shipped content differs, or when initial
// JS/CSS gzip grows by more than 512 bytes. Without a candidate directory it
// captures the working tree and compares that.
//
// `save <dir>` and `compare <dir>` (one argument) are the older spellings.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const GROWTH_LIMIT = 512;
/** Generated data folders: public/<folder> and, once built, dist/<folder>. */
export const GENERATED_FOLDERS = [
  "readings",
  "bible",
  "chronology",
  "study",
  "audio",
];
/** Files of dist/ that legitimately change with every code change. */
const DERIVED = new Set(["index.html", "sw.js"]);
const FORMAT = 2;
const LIST_LIMIT = 40;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const kb = (n) => `${n} B`;

/**
 * Every file below `base` (recursively, symlinks recorded rather than
 * followed) as { "relative/posix/path": { sha256, bytes } }, sorted by path.
 * @param {string} base
 * @returns {Record<string, { sha256: string, bytes: number, symlink?: true }>}
 */
export function walk(base) {
  /** @type {Record<string, { sha256: string, bytes: number, symlink?: true }>} */
  const out = {};
  const visit = (dir, prefix) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      const path = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (lstatSync(path).isSymbolicLink())
        out[rel] = {
          sha256: sha256("symlink:" + readlinkSync(path)),
          bytes: 0,
          symlink: true,
        };
      else if (entry.isDirectory()) visit(path, rel);
      else if (entry.isFile()) {
        const bytes = readFileSync(path);
        out[rel] = { sha256: sha256(bytes), bytes: bytes.length };
      }
    }
  };
  if (existsSync(base)) visit(base, "");
  return out;
}

/** Names Vite gives a chunk, without its content hash. */
export const unhashed = (name) =>
  name.replace(/^(.*)-[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]+)$/, "$1$2");

/** Files the page loads before first paint: scripts, preloads, stylesheets. */
function initialAssets(html) {
  const initial = new Set();
  for (const tag of html.match(/<(script|link)\b[^>]*>/g) ?? []) {
    const isStyle = /rel="stylesheet"/.test(tag);
    const isPreload = /rel="modulepreload"/.test(tag);
    const isModule = /^<script\b/.test(tag) && /type="module"/.test(tag);
    if (!isStyle && !isPreload && !isModule) continue;
    const ref = tag.match(/(?:src|href)="\/?(assets\/[^"]+)"/)?.[1];
    if (ref) initial.add(ref.slice("assets/".length));
  }
  return initial;
}

/** Inline <script>/<style> bodies of the page: startup code outside the bundle. */
function inlineCode(html) {
  const parts = { script: [], style: [] };
  for (const [, tag, attrs, body] of html.matchAll(
    /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/g,
  )) {
    if (tag === "script" && /\bsrc=/.test(attrs)) continue;
    parts[tag].push(body);
  }
  const measure = (bodies) => {
    const text = bodies.join("\n");
    return {
      count: bodies.length,
      bytes: Buffer.byteLength(text),
      gzip: bodies.length ? gzipSync(text).length : 0,
      each: bodies.map((body) => ({
        bytes: Buffer.byteLength(body),
        gzip: gzipSync(body).length,
      })),
    };
  };
  const script = measure(parts.script);
  const style = measure(parts.style);
  return { script, style, gzip: script.gzip + style.gzip };
}

function git(root, ...args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Capture generated data, shipped data and bundle measurements.
 * @param {string} root repository root
 * @param {{ dist?: string, label?: string, requireDist?: boolean }} [options]
 */
export function capture(root, options = {}) {
  const { dist = "dist", label = "", requireDist = true } = options;
  const publicDir = join(root, "public");
  const distDir = join(root, dist);

  const generated = {};
  for (const folder of GENERATED_FOLDERS) {
    const files = walk(join(publicDir, folder));
    if (!Object.keys(files).length)
      throw new Error(
        `public/${folder} is missing or empty: run npm run build first`,
      );
    for (const [rel, info] of Object.entries(files))
      generated[`${folder}/${rel}`] = info;
  }

  /** @type {Record<string, any>} */
  const snapshot = {
    format: FORMAT,
    meta: {
      label,
      dist,
      commit: git(root, "rev-parse", "HEAD"),
      dirty: !!git(root, "status", "--porcelain", "--untracked-files=no"),
    },
    generated,
    shipped: {},
    shell: {},
    assets: {},
    bundle: null,
  };

  if (!existsSync(join(distDir, "index.html"))) {
    if (requireDist)
      throw new Error(`${dist}/index.html is missing: run the build first`);
    return snapshot;
  }

  const everything = walk(distDir);
  for (const [rel, info] of Object.entries(everything)) {
    const [top] = rel.split("/");
    if (GENERATED_FOLDERS.includes(top)) snapshot.shipped[rel] = info;
    else if (top === "assets") continue;
    else snapshot.shell[rel] = info;
  }

  const html = readFileSync(join(distDir, "index.html"), "utf8");
  const initial = initialAssets(html);
  const assetFiles = walk(join(distDir, "assets"));
  const aiAssets = [];
  for (const [name, info] of Object.entries(assetFiles)) {
    const bytes = readFileSync(join(distDir, "assets", name));
    snapshot.assets[name] = {
      ...info,
      gzip: gzipSync(bytes).length,
      initial: initial.has(name),
    };
    if (
      /\.(js|css)$/.test(name) &&
      /openrouter/i.test(bytes.toString("latin1"))
    )
      aiAssets.push(unhashed(name));
  }

  const totals = { js: 0, css: 0 };
  const lazy = [];
  for (const [name, asset] of Object.entries(snapshot.assets)) {
    const kind = name.endsWith(".js")
      ? "js"
      : name.endsWith(".css")
        ? "css"
        : "";
    if (!kind) continue;
    if (asset.initial) totals[kind] += asset.gzip;
    else
      lazy.push({
        name: unhashed(name),
        file: name,
        bytes: asset.bytes,
        gzip: asset.gzip,
      });
  }
  // Chunks can share a name (two `index-<hash>.js`): number them by size.
  lazy.sort((a, b) =>
    a.name === b.name ? a.bytes - b.bytes : a.name < b.name ? -1 : 1,
  );
  const seen = new Map();
  for (const chunk of lazy) {
    const n = (seen.get(chunk.name) ?? 0) + 1;
    seen.set(chunk.name, n);
    if (n > 1 || lazy.filter((c) => c.name === chunk.name).length > 1)
      chunk.name = `${chunk.name}#${n}`;
  }
  snapshot.bundle = {
    initial: {
      js: totals.js,
      css: totals.css,
      files: [...initial].map(unhashed).sort(),
    },
    inline: inlineCode(html),
    page: { bytes: Buffer.byteLength(html), gzip: gzipSync(html).length },
    lazy,
    aiAssets: aiAssets.sort(),
  };
  return snapshot;
}

/** Added, removed and changed paths between two path -> { sha256 } maps. */
export function diffFiles(before, after) {
  const diff = { added: [], removed: [], changed: [] };
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!(path in after)) diff.removed.push(path);
    else if (!(path in before)) diff.added.push(path);
    else if (before[path].sha256 !== after[path].sha256)
      diff.changed.push(path);
  }
  for (const list of Object.values(diff)) list.sort();
  return diff;
}

/**
 * Report lines plus every differing path and budget breach, as failures
 * (empty when the candidate matches the baseline).
 * @returns {{ failures: string[], lines: string[] }}
 */
export function compare(before, after) {
  const failures = [];
  const lines = [];
  const show = (title, diff) => {
    for (const [kind, paths] of Object.entries(diff))
      for (const path of paths) failures.push(`[${title}] ${kind}: ${path}`);
    return diff.added.length + diff.removed.length + diff.changed.length;
  };

  if (before.meta?.label !== after.meta?.label)
    lines.push(
      `warning: comparing different configurations ("${before.meta?.label}" vs "${after.meta?.label}")`,
    );

  const sections = [
    ["generated", before.generated, after.generated],
    ["shipped", before.shipped, after.shipped],
  ];
  const strictShell = (shell) =>
    Object.fromEntries(Object.entries(shell).filter(([k]) => !DERIVED.has(k)));
  sections.push(["shell", strictShell(before.shell), strictShell(after.shell)]);
  for (const [title, a, b] of sections) {
    const diff = diffFiles(a, b);
    const count = show(title, diff);
    lines.push(
      `${title}: ${Object.keys(a).length} -> ${Object.keys(b).length} files, ${count} differences`,
    );
  }

  const informational = (title, a, b) => {
    const diff = diffFiles(a, b);
    const n = diff.added.length + diff.removed.length + diff.changed.length;
    lines.push(`${title}: ${n} differences (informational)`);
  };
  informational(
    "derived (index.html, sw.js)",
    Object.fromEntries(
      Object.entries(before.shell).filter(([k]) => DERIVED.has(k)),
    ),
    Object.fromEntries(
      Object.entries(after.shell).filter(([k]) => DERIVED.has(k)),
    ),
  );

  const a = before.bundle;
  const b = after.bundle;
  if (!a || !b) {
    failures.push("[bundle] a snapshot has no dist measurements");
  } else {
    for (const kind of ["js", "css"]) {
      const delta = b.initial[kind] - a.initial[kind];
      lines.push(
        `initial ${kind} gzip: ${a.initial[kind]} -> ${b.initial[kind]} B (${delta >= 0 ? "+" : ""}${delta}, limit +${GROWTH_LIMIT})`,
      );
      if (delta > GROWTH_LIMIT)
        failures.push(
          `[bundle] initial ${kind} gzip grew by ${delta} B (limit ${GROWTH_LIMIT} B)`,
        );
    }
    const inline = b.inline.gzip - a.inline.gzip;
    lines.push(
      `inline startup gzip (separate, not budgeted): ${a.inline.gzip} -> ${b.inline.gzip} B (${inline >= 0 ? "+" : ""}${inline}); raw ${a.inline.script.bytes + a.inline.style.bytes} -> ${b.inline.script.bytes + b.inline.style.bytes} B`,
    );
    const lazyNames = (bundle) =>
      new Map(bundle.lazy.map((chunk) => [chunk.name, chunk.gzip]));
    const la = lazyNames(a);
    const lb = lazyNames(b);
    const gone = [...la.keys()].filter((n) => !lb.has(n));
    const fresh = [...lb.keys()].filter((n) => !la.has(n));
    lines.push(
      `lazy chunks: ${la.size} -> ${lb.size}; removed [${gone.join(", ")}]; added [${fresh.join(", ")}] (informational)`,
    );
    const promoted = b.initial.files.filter(
      (n) =>
        !a.initial.files.includes(n) &&
        la.has(n) &&
        !b.lazy.some((chunk) => chunk.name === n),
    );
    if (promoted.length)
      lines.push(`warning: lazy chunks now initial: ${promoted.join(", ")}`);
    if (!a.aiAssets.length && b.aiAssets.length)
      failures.push(
        `[bundle] AI code appeared in a build that had none: ${b.aiAssets.join(", ")}`,
      );
  }
  return { failures, lines };
}

function summarize(snapshot) {
  const count = (files) => Object.keys(files).length;
  const lines = [
    `generated ${count(snapshot.generated)} files, shipped ${count(snapshot.shipped)}, shell ${count(snapshot.shell)}, assets ${count(snapshot.assets)}`,
  ];
  if (snapshot.bundle) {
    const { initial, inline, lazy } = snapshot.bundle;
    lines.push(
      `initial gzip: js ${kb(initial.js)}, css ${kb(initial.css)}; inline startup gzip ${kb(inline.gzip)}; ${lazy.length} lazy chunks`,
    );
  }
  return lines;
}

const USAGE = `Usage:
  snapshot.mjs capture <dir> [--label <name>] [--dist <folder>] [--root <repo>] [--no-dist]
  snapshot.mjs compare <baseline-dir> [<candidate-dir>] [--full] [--root <repo>]`;

function parse(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) positional.push(arg);
    else if (["full", "no-dist"].includes(arg.slice(2)))
      flags[arg.slice(2)] = true;
    else flags[arg.slice(2)] = argv[++i];
  }
  return { positional, flags };
}

const read = (location) => {
  const file = location.endsWith(".json")
    ? location
    : join(location, "snapshot.json");
  if (!existsSync(file)) throw new Error(`no snapshot at ${file}`);
  return JSON.parse(readFileSync(file, "utf8"));
};

/** @returns {number} the process exit code */
export function main(
  argv,
  defaultRoot = fileURLToPath(new URL("..", import.meta.url)),
) {
  const { positional, flags } = parse(argv);
  const [rawCommand, first, second] = positional;
  const command = rawCommand === "save" ? "capture" : rawCommand;
  if (!["capture", "compare"].includes(command) || !first) {
    console.error(USAGE);
    return 2;
  }
  const root = resolve(flags.root ?? defaultRoot);
  try {
    if (command === "capture") {
      const snapshot = capture(root, {
        dist: flags.dist,
        label: flags.label,
        requireDist: !flags["no-dist"],
      });
      mkdirSync(first, { recursive: true });
      const file = join(first, "snapshot.json");
      writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n");
      console.log(`Captured ${file}`);
      for (const line of summarize(snapshot)) console.log(`  ${line}`);
      return 0;
    }
    const before = read(first);
    const after = second
      ? read(second)
      : capture(root, {
          dist: flags.dist ?? before.meta?.dist,
          label: flags.label ?? before.meta?.label,
        });
    const { failures, lines } = compare(before, after);
    for (const line of lines) console.log(line);
    if (failures.length) {
      console.error(`\nFAILED (${failures.length}):`);
      const seen = new Map();
      for (const failure of failures) {
        const group = failure.match(/^\[[^\]]+\] \w+:/)?.[0] ?? failure;
        const n = (seen.get(group) ?? 0) + 1;
        seen.set(group, n);
        if (flags.full || n <= LIST_LIMIT) console.error(`  ${failure}`);
        else if (n === LIST_LIMIT + 1)
          console.error(`  ${group} ... more (use --full to list them all)`);
      }
      return 1;
    }
    console.log("OK");
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 2;
  }
}

const invoked = process.argv[1] ? realpathSync(resolve(process.argv[1])) : "";
if (invoked && realpathSync(fileURLToPath(import.meta.url)) === invoked)
  process.exitCode = main(process.argv.slice(2));
