import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createReader,
  currentReader,
  setCompletion,
  selectReader,
  exportBackup,
  importBackup,
  loadProgress,
  validDate,
  PROGRESS_KEY,
  STATE_KEY,
} from "../src/plan/progress.ts";
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
  };
}
function current(s: ReturnType<typeof storage>) {
  const reader = currentReader(s);
  assert.ok(reader);
  return reader;
}
test("Local progress survives reopening, is idempotent, supports reading ahead and undo", () => {
  const s = storage();
  const r = createReader(s, "ألبرت", "2026-10-01");
  setCompletion(s, r.id, 1, true);
  setCompletion(s, r.id, 1, true);
  setCompletion(s, r.id, 150, true);
  assert.deepEqual(current(s).completed, [1, 150]);
  assert.equal(current(s).startDate, "2026-10-01");
  setCompletion(s, r.id, 1, false);
  assert.deepEqual(current(s).completed, [150]);
  assert.throws(() => setCompletion(s, r.id, 151, true));
});
test("Switching between duplicate names preserves separate progress", () => {
  const s = storage();
  const a = createReader(s, "قارئ", "2026-09-01");
  setCompletion(s, a.id, 9, true);
  const b = createReader(s, "قارئ", "2026-10-01");
  assert.notEqual(a.id, b.id);
  assert.deepEqual(b.completed, []);
  selectReader(s, null);
  assert.equal(currentReader(s), null);
  selectReader(s, a.id);
  assert.deepEqual(current(s).completed, [9]);
  assert.equal(loadProgress(s).profiles.length, 2);
});
test("Backup can move to another browser and never overwrites an existing profile", () => {
  const first = storage();
  let r = createReader(first, "ميخائيل", "2026-10-01");
  r = setCompletion(first, r.id, 3, true);
  const text = exportBackup(r);
  const second = storage();
  const existing = createReader(second, "قارئ آخر", "2026-09-01");
  setCompletion(second, existing.id, 2, true);
  const restored = importBackup(second, text);
  assert.equal(restored.name, "ميخائيل");
  assert.deepEqual(restored.completed, [3]);
  assert.notEqual(restored.id, r.id);
  selectReader(second, existing.id);
  assert.deepEqual(current(second).completed, [2]);
});
test("Bad dates, malformed backups, and corrupt stored data do not replace progress", () => {
  const s = storage();
  createReader(s, "Test", "2026-10-01");
  const before = s.getItem(STATE_KEY);
  for (const text of [
    "invalid",
    "null",
    JSON.stringify({ version: 2 }),
    JSON.stringify({
      version: 1,
      reader: { name: "Test", startDate: "2026-02-31", completed: [1] },
    }),
    JSON.stringify({
      version: 1,
      reader: { name: "Test", startDate: "2026-10-01", completed: [151] },
    }),
  ])
    assert.throws(() => importBackup(s, text));
  assert.equal(s.getItem(STATE_KEY), before);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2026-02-29"), false);
  s.setItem(STATE_KEY, "corrupt");
  assert.throws(() => createReader(s, "New", "2026-10-01"));
  assert.equal(s.getItem(STATE_KEY), "corrupt");
  // Corrupt legacy progress is never migrated over, nor changed.
  const legacy = storage();
  legacy.setItem(PROGRESS_KEY, "corrupt");
  assert.throws(() => createReader(legacy, "New", "2026-10-01"));
  assert.equal(legacy.getItem(PROGRESS_KEY), "corrupt");
  assert.equal(legacy.getItem(STATE_KEY), null);
});
test("Blocked storage reports failed saving instead of pretending success", () => {
  const s = storage();
  const r = createReader(s, "Test", "2026-10-01");
  const blocked = {
    getItem: s.getItem,
    setItem: () => {
      throw Error("QuotaExceededError");
    },
  };
  assert.throws(() => setCompletion(blocked, r.id, 1, true), /لم يتم الحفظ/);
  assert.deepEqual(current(s).completed, []);
});
