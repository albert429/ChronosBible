// The static builders publish through scripts/lib/ownership.js: a rebuild
// removes the files it wrote before and no longer produces, keeps everything
// else, and refuses symlinks and hand-modified owned files. The builders run
// against the committed data into scratch folders whose paths have spaces.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBible } from "../build-bible.js";
import { buildChronology } from "../build-chronology.js";
import { buildReadings } from "../build-readings.js";
import { buildStudy } from "../build-study.js";

function scratch(t: { after: (fn: () => void) => void }) {
  const base = mkdtempSync(join(tmpdir(), "generated output "));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return {
    out: join(base, "public dir", "folder"),
    inventory: join(base, "state dir", "folder.json"),
    base,
  };
}
const put = (path: string, text: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};
const record = (inventory: string) =>
  JSON.parse(readFileSync(inventory, "utf8")).files as Record<string, string>;

test("Readings: a retired day file is removed, others' files stay, edits are refused", (t) => {
  const { out, inventory } = scratch(t);
  put(join(out, "151.json"), "{}");
  buildReadings({ out, inventory });
  // Day 151 was never this builder's, so the rebuild keeps it.
  assert.ok(existsSync(join(out, "151.json")));
  assert.equal(Object.keys(record(inventory)).length, 151);
  // Pretend an earlier build had also written day 151 (as "{}").
  const files = record(inventory);
  files["151.json"] =
    "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
  writeFileSync(inventory, JSON.stringify({ v: 1, files }));
  // That recorded copy was "{}"; an edited one is never removed.
  writeFileSync(join(out, "151.json"), "edited");
  assert.throws(
    () => buildReadings({ out, inventory }),
    /obsolete reading output was modified; refusing removal/,
  );
  assert.equal(readFileSync(join(out, "151.json"), "utf8"), "edited");
  writeFileSync(join(out, "151.json"), "{}");
  buildReadings({ out, inventory });
  assert.equal(existsSync(join(out, "151.json")), false);
  assert.equal(Object.keys(record(inventory)).length, 151);
});

test("Chronology: no longer deletes its folder; it removes owned definitions only", (t) => {
  const { out, inventory } = scratch(t);
  put(join(out, "README.txt"), "kept");
  buildChronology({ out, inventory });
  const owned = record(inventory);
  assert.ok("OT.json" in owned && "NT.json" in owned);
  assert.equal(Object.keys(owned).length, 2 + 412 + 141);
  // A definition an earlier build published but this one does not.
  put(join(out, "OT/retired-1.json"), "old");
  owned["OT/retired-1.json"] =
    "a7a9ea9b4f1c6e0b1c4b6a3d5e4c4e1e8f0a2b3c4d5e6f708192a3b4c5d6e7f8";
  writeFileSync(inventory, JSON.stringify({ v: 1, files: owned }));
  assert.throws(() => buildChronology({ out, inventory }), /modified/);
  rmSync(join(out, "OT/retired-1.json"));
  buildChronology({ out, inventory });
  assert.equal(readFileSync(join(out, "README.txt"), "utf8"), "kept");
});

test("Builders refuse symlinked output instead of writing through it", (t) => {
  const { out, inventory, base } = scratch(t);
  const elsewhere = join(base, "elsewhere");
  mkdirSync(elsewhere);
  mkdirSync(out, { recursive: true });
  symlinkSync(elsewhere, join(out, "GEN"));
  assert.throws(() => buildBible({ out, inventory }), /symlinks/);
  assert.equal(existsSync(join(elsewhere, "1.json")), false);
  assert.equal(existsSync(join(out, "catalog.json")), false);
  rmSync(join(out, "GEN"));
  const linked = join(base, "linked");
  symlinkSync(elsewhere, linked);
  assert.throws(
    () => buildChronology({ out: linked, inventory }),
    /cannot be a symlink/,
  );
  assert.equal(existsSync(join(elsewhere, "OT.json")), false);
});

test("Study: the 450 retired per-day files are removed, only as regular files", (t) => {
  const { out, base } = scratch(t);
  put(join(out, "1.json"), "old");
  put(join(out, "150.lex.json"), "old");
  put(join(out, "151.json"), "not retired");
  const target = join(base, "target.json");
  writeFileSync(target, "kept");
  symlinkSync(target, join(out, "2.tr.json"));
  assert.throws(() => buildStudy({ out }), /2\.tr\.json is not a regular/);
  // Nothing was removed before the refusal.
  assert.ok(existsSync(join(out, "1.json")));
  rmSync(join(out, "2.tr.json"));
  assert.match(buildStudy({ out }), /Canonical study/);
  for (const name of ["1.json", "150.lex.json"])
    assert.equal(existsSync(join(out, name)), false, name);
  assert.equal(readFileSync(join(out, "151.json"), "utf8"), "not retired");
  assert.equal(readFileSync(target, "utf8"), "kept");
  assert.ok(lstatSync(join(out, "v2/inventory.json")).isFile());
});
