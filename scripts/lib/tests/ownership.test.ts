// Inventory-owned output (scripts/lib/ownership.js): what a builder may write,
// remove and must refuse. Every case runs below a folder whose name contains
// spaces and a non-ASCII letter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { publishOwned } from "../ownership.js";

const NAME = /^(?:[a-z]+\/)?[0-9]+\.json$/;
const body = (text: string) => Buffer.from(text);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function scratch(t: { after: (fn: () => void) => void }) {
  const root = join(mkdtempSync(join(tmpdir(), "owned output ")), "my out ü");
  mkdirSync(root, { recursive: true });
  t.after(() => rmSync(dirname(root), { recursive: true, force: true }));
  const base = join(root, "public folder");
  const inventory = join(root, "state dir", "folder.json");
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(base, path)), { recursive: true });
    writeFileSync(join(base, path), text);
  };
  const read = (path: string) => readFileSync(join(base, path), "utf8");
  const publish = (
    payloads: [string, string][],
    options: Record<string, unknown> = {},
  ) =>
    publishOwned({
      base,
      payloads: payloads.map(([path, text]) => [path, body(text)]),
      safePath: (path: string) => NAME.test(path),
      inventory,
      ...options,
    });
  return { root, base, inventory, put, read, publish };
}

test("A rebuild removes only obsolete owned files and records the new set", (t) => {
  const f = scratch(t);
  f.put("notes.txt", "not generated");
  f.put("7.json", "named like output, never generated");
  const first = f.publish([
    ["1.json", "one"],
    ["a/2.json", "two"],
  ]);
  assert.deepEqual(first, { files: 2, bytes: 6, removed: [], unowned: [] });
  assert.deepEqual(JSON.parse(readFileSync(f.inventory, "utf8")), {
    v: 1,
    files: { "1.json": sha("one"), "a/2.json": sha("two") },
  });
  const second = f.publish([["1.json", "uno"]], { listUnowned: true });
  assert.deepEqual(second.removed, ["a/2.json"]);
  assert.deepEqual(second.unowned, ["7.json"]);
  assert.equal(existsSync(join(f.base, "a/2.json")), false);
  // Folders and unknown files stay, even with a generator's name.
  assert.ok(existsSync(join(f.base, "a")));
  assert.equal(f.read("notes.txt"), "not generated");
  assert.equal(f.read("7.json"), "named like output, never generated");
  assert.equal(f.read("1.json"), "uno");
});

test("Without an inventory nothing is removed or recorded", (t) => {
  const f = scratch(t);
  f.put("3.json", "old");
  f.publish([["1.json", "one"]], { inventory: undefined });
  assert.equal(f.read("3.json"), "old");
  assert.equal(existsSync(f.inventory), false);
});

test("A modified obsolete owned file stops the build before anything changes", (t) => {
  const f = scratch(t);
  f.publish([
    ["1.json", "one"],
    ["2.json", "two"],
  ]);
  f.put("2.json", "edited by hand");
  const before = readFileSync(f.inventory, "utf8");
  assert.throws(
    () => f.publish([["1.json", "changed"]], { label: "test" }),
    /obsolete test output was modified; refusing removal/,
  );
  assert.equal(f.read("1.json"), "one");
  assert.equal(f.read("2.json"), "edited by hand");
  assert.equal(readFileSync(f.inventory, "utf8"), before);
});

test("Unsafe generated or recorded paths are refused", (t) => {
  const f = scratch(t);
  for (const path of ["../1.json", "/1.json", "a/../1.json", "1.txt", ""])
    assert.throws(
      () => f.publish([[path, "x"]]),
      /invalid generated generated path/,
      path,
    );
  assert.throws(
    () =>
      f.publish([
        ["1.json", "x"],
        ["1.json", "y"],
      ]),
    /duplicate/,
  );
  mkdirSync(dirname(f.inventory), { recursive: true });
  for (const files of [
    { "../outside.json": sha("x") },
    { "1.json": "not a checksum" },
  ]) {
    writeFileSync(f.inventory, JSON.stringify({ v: 1, files }));
    assert.throws(() => f.publish([["1.json", "x"]]), /inventory entry/);
  }
  for (const text of ["not json", "[]", '{"v":2,"files":{}}', '{"v":1}']) {
    writeFileSync(f.inventory, text);
    assert.throws(
      () => f.publish([["1.json", "x"]]),
      /invalid generated inventory/,
      text,
    );
  }
  assert.equal(existsSync(join(f.base, "1.json")), false);
});

test("Symlinked output, parents, files and inventories are refused", (t) => {
  const f = scratch(t);
  const elsewhere = join(f.root, "elsewhere");
  mkdirSync(elsewhere);
  writeFileSync(join(elsewhere, "1.json"), "outside");
  // The output folder itself.
  symlinkSync(elsewhere, f.base);
  assert.throws(() => f.publish([["1.json", "x"]]), /cannot be a symlink/);
  rmSync(f.base);
  // A parent folder of a generated file.
  mkdirSync(f.base);
  symlinkSync(elsewhere, join(f.base, "a"));
  assert.throws(() => f.publish([["a/1.json", "x"]]), /contain symlinks/);
  rmSync(join(f.base, "a"));
  // A generated file.
  symlinkSync(join(elsewhere, "1.json"), join(f.base, "1.json"));
  assert.throws(() => f.publish([["1.json", "x"]]), /contain symlinks/);
  rmSync(join(f.base, "1.json"));
  // An obsolete owned file that became a link.
  f.publish([["2.json", "two"]]);
  rmSync(join(f.base, "2.json"));
  symlinkSync(join(elsewhere, "1.json"), join(f.base, "2.json"));
  assert.throws(() => f.publish([["1.json", "x"]]), /contain symlinks/);
  rmSync(join(f.base, "2.json"));
  // The inventory, dangling or not.
  rmSync(f.inventory);
  symlinkSync(join(elsewhere, "missing.json"), f.inventory);
  assert.throws(() => f.publish([["1.json", "x"]]), /inventory cannot be/);
  assert.equal(readFileSync(join(elsewhere, "1.json"), "utf8"), "outside");
  assert.equal(existsSync(join(elsewhere, "missing.json")), false);
});

test("An inventory inside the output folder counts as one of its files", (t) => {
  const f = scratch(t);
  const result = f.publish([["1.json", "one"]], {
    inventory: join(f.base, "inventory.json"),
    version: 2,
  });
  const record = readFileSync(join(f.base, "inventory.json"), "utf8");
  assert.equal(
    record,
    JSON.stringify({ v: 2, files: { "1.json": sha("one") } }),
  );
  assert.deepEqual(result, {
    files: 2,
    bytes: 3 + record.length,
    removed: [],
    unowned: [],
  });
});
