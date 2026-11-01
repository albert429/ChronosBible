import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReadings } from "../scripts/data/build-readings.js";
import type { Day } from "../src/domain/reading/types.ts";
test("All static readings exactly preserve the validated source, independent of the API", (t) => {
  const out = mkdtempSync(join(tmpdir(), "readings-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  buildReadings({ out });
  const source: Day[] = JSON.parse(
    readFileSync(new URL("../data/plan.json", import.meta.url), "utf8"),
  );
  const index: Day[] = JSON.parse(readFileSync(join(out, "plan.json"), "utf8"));
  assert.equal(index.length, 150);
  for (const day of source) {
    const file = JSON.parse(readFileSync(join(out, day.day + ".json"), "utf8"));
    assert.deepEqual(file, day);
    assert.equal(index[day.day - 1].verseCount, day.verseCount);
    assert.ok(index[day.day - 1].passages.every((p) => !("verses" in p)));
  }
});
