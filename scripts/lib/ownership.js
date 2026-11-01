// Inventory-owned generated output, shared by every static builder.
//
// A builder publishes a complete set of files into its output folder and
// records each one's SHA-256 in an inventory. The next run may delete a file
// only if the inventory names it, it is no longer generated and its bytes are
// still exactly what was recorded. Every path, the inventory and the removals
// are checked before anything is written. Unsafe paths, symlinks, invalid
// inventories and hand-modified owned files stop the build. Unknown files,
// such as local recordings beside the audio manifests, are never touched, and
// folders are never removed.
//
// The canonical study set keeps its inventory inside its folder
// (public/study/v2/inventory.json, which the app also reads). The other
// builders' outputs are shipped as they are, so their inventories live outside
// public/ (OWNERSHIP_DIR). The Python tools follow the same rules
// (scripts/lib/chronos_tools/ownership.py).
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** Where builders whose output ships unchanged keep their inventories. */
export const OWNERSHIP_DIR = "artifacts/generated-output";

/**
 * One generated file for publishOwned.
 * @param {string} path relative POSIX path
 * @param {string | Buffer} data text (UTF-8) or bytes
 * @returns {[string, Buffer]}
 */
export const payload = (path, data) => [
  path,
  typeof data === "string" ? Buffer.from(data) : data,
];

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isLink = (path) => existsSync(path) && lstatSync(path).isSymbolicLink();
// existsSync follows links, so a dangling link would look absent.
const present = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

/**
 * Write `payloads` ([relative POSIX path, bytes][]) under `base`.
 *
 * @param {object} options
 * @param {string} options.base output folder
 * @param {[string, Buffer][]} options.payloads every file this build produces
 * @param {(path: string) => boolean} options.safePath the generator's own names
 * @param {string} [options.inventory] inventory file; without one, nothing is
 *   removed and nothing is recorded
 * @param {number} [options.version] inventory format version (study: 2)
 * @param {string} [options.label] what the messages call this output
 * @param {(message: string) => never} [options.fail]
 * @param {boolean} [options.listUnowned] also report generator-named files
 *   that this build does not produce and no inventory owns
 * @returns {{ files: number, bytes: number, removed: string[], unowned: string[] }}
 *   `files`/`bytes` include the inventory when it is inside `base`
 */
export function publishOwned({
  base,
  payloads,
  safePath,
  inventory,
  version = 1,
  label = "generated",
  fail = (message) => {
    throw new Error(message);
  },
  listUnowned = false,
}) {
  const next = Object.fromEntries(
    payloads.map(([path, body]) => [path, sha256(body)]),
  );
  if (Object.keys(next).length !== payloads.length)
    fail(`duplicate generated ${label} path`);
  const obsolete = [];
  if (isLink(base)) fail(`${label} output cannot be a symlink`);
  function checkParents(path) {
    let current = base;
    for (const part of path.split("/")) {
      current = join(current, part);
      if (isLink(current)) fail(`${label} output cannot contain symlinks`);
    }
  }
  for (const [path] of payloads) {
    if (!safePath(path)) fail(`invalid generated ${label} path`);
    checkParents(path);
  }
  let owned = {};
  if (inventory && present(inventory)) {
    if (lstatSync(inventory).isSymbolicLink())
      fail(`${label} inventory cannot be a symlink`);
    let old;
    try {
      old = JSON.parse(readFileSync(inventory, "utf8"));
    } catch {
      fail(`invalid ${label} inventory`);
    }
    if (
      !old ||
      old.v !== version ||
      !old.files ||
      Array.isArray(old.files) ||
      typeof old.files !== "object"
    )
      fail(`invalid ${label} inventory`);
    owned = old.files;
    for (const [path, checksum] of Object.entries(owned)) {
      if (
        !safePath(path) ||
        typeof checksum !== "string" ||
        !/^[a-f0-9]{64}$/.test(checksum)
      )
        fail(`invalid ${label} inventory entry`);
      if (path in next) continue;
      checkParents(path);
      const target = join(base, path);
      if (!existsSync(target)) continue;
      if (sha256(readFileSync(target)) !== checksum)
        fail(`obsolete ${label} output was modified; refusing removal`);
      obsolete.push([path, target]);
    }
  }
  const unowned = listUnowned
    ? generatorNamed(base, safePath).filter(
        (path) => !(path in next) && !(path in owned),
      )
    : [];
  // All data, budgets and removals are verified before touching existing files.
  for (const [, target] of obsolete) unlinkSync(target);
  let bytes = 0;
  for (const [path, body] of payloads) {
    const target = join(base, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    bytes += body.length;
  }
  let files = payloads.length;
  if (inventory) {
    const record = Buffer.from(JSON.stringify({ v: version, files: next }));
    mkdirSync(dirname(inventory), { recursive: true });
    writeFileSync(inventory, record);
    if (dirname(inventory) === base) {
      files += 1;
      bytes += record.length;
    }
  }
  return { files, bytes, removed: obsolete.map(([path]) => path), unowned };
}

/** Regular files below `base` that carry one of the generator's names. */
function generatorNamed(base, safePath) {
  const found = [];
  const visit = (dir, prefix) => {
    if (!existsSync(dir) || lstatSync(dir).isSymbolicLink()) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(dir, entry.name), path);
      else if (entry.isFile() && safePath(path)) found.push(path);
    }
  };
  visit(base, "");
  return found.sort();
}
