import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStudyLicense } from "../build-study.js";

test("Study licence publishes exact source bytes and owns only its notice", (t) => {
  const root = mkdtempSync(join(tmpdir(), "study licence "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const out = join(root, "app/public/licenses");
  const inventory = join(root, "artifacts/licenses.json");
  const source = join(root, "data/study/LICENSE.md");
  mkdirSync(join(source, ".."), { recursive: true });
  mkdirSync(out, { recursive: true });
  const bytes = Buffer.from("Attribution — مصدر\r\nLicence text.\n");
  writeFileSync(source, bytes);
  writeFileSync(join(out, "other.txt"), "kept");
  writeFileSync(join(out, "study-data.txt"), "outdated notice");
  buildStudyLicense({ out, inventory, root });
  assert.deepEqual(readFileSync(join(out, "study-data.txt")), bytes);
  assert.equal(readFileSync(join(out, "other.txt"), "utf8"), "kept");
  assert.deepEqual(
    Object.keys(JSON.parse(readFileSync(inventory, "utf8")).files),
    ["study-data.txt"],
  );
  writeFileSync(source, "Updated attribution\n");
  buildStudyLicense({ out, inventory, root });
  assert.deepEqual(
    readFileSync(join(out, "study-data.txt")),
    readFileSync(source),
  );
  rmSync(join(out, "study-data.txt"));
  symlinkSync(source, join(out, "study-data.txt"));
  assert.throws(() => buildStudyLicense({ out, inventory, root }), /symlink/);
  assert.equal(readFileSync(source, "utf8"), "Updated attribution\n");
});
