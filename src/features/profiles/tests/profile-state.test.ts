// The pure profile transitions behind the storage adapter: they never touch
// storage, never mutate the state they are given, and keep the guest and
// each reader apart. Storage behaviour itself is covered in progress.test.ts
// and reader-contracts.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addReader,
  freshState,
  newReader,
  parseState,
  serializeState,
  validateReader,
  withActiveReader,
  withReaderPlaces,
  withReadingCompletion,
  type ProgressState,
} from "../domain/state.ts";
import { exportBackup, parseBackup } from "../domain/backup.ts";
import { migrateLegacy } from "../domain/legacy.ts";

function frozen<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
const withReader = (): ProgressState => {
  const reader = validateReader({
    name: "مريم",
    startDate: "2026-10-01",
    completed: [],
  });
  const start = freshState();
  return addReader(start, "r1", newReader(start, reader)).state;
};

test("Profile transitions return new states and leave their input untouched", () => {
  const before = frozen(withReader());
  const text = serializeState(before);
  const done = withReadingCompletion(
    before,
    "r1",
    { mode: "bible", book: "GEN", chapter: 1 },
    true,
    "2026-10-05",
  );
  const guest = withReadingCompletion(
    done.state,
    "",
    { mode: "plan", day: 3 },
    true,
    "2026-10-06",
  );
  const selected = withActiveReader(guest.state, null);
  const placed = withReaderPlaces(
    selected.state,
    "",
    { track: "plan", places: { plan: { mode: "plan", day: 3 } } },
    true,
  );
  assert.equal(serializeState(before), text);
  assert.equal(placed.activeId, null);
  assert.equal(placed.continuous, true);
  assert.deepEqual(placed.profiles[0].completion.bible, ["GEN:1"]);
  assert.deepEqual(placed.profiles[0].readOn, { "bible|GEN:1": "2026-10-05" });
  assert.deepEqual(placed.profiles[0].completion.plan, []);
  assert.deepEqual(placed.guest.completion.plan, [3]);
  assert.deepEqual(placed.guest.readOn, { "plan|3": "2026-10-06" });
  assert.equal(placed.guest.track, "plan");
  assert.equal(placed.profiles[0].track, "bible");
});

test("Serialized states and backups parse back to the same data", () => {
  const state = withReadingCompletion(
    withReader(),
    "r1",
    { mode: "chronological", testament: "OT", readingId: "ot-001" },
    true,
    "2026-10-05",
  ).state;
  assert.deepEqual(parseState(serializeState(state)), state);
  const { id: _id, completed: _completed, ...body } = state.profiles[0];
  assert.deepEqual(parseBackup(exportBackup(state.profiles[0])), body);
  assert.deepEqual(parseState(serializeState(migrateLegacy(null, null))), {
    ...freshState(),
  });
});

test("Transitions reject unknown readers and invalid readings without a new state", () => {
  const state = frozen(withReader());
  assert.throws(() => withActiveReader(state, "missing"), /القارئ غير موجود/);
  assert.throws(
    () =>
      withReadingCompletion(
        state,
        "missing",
        { mode: "plan", day: 1 },
        true,
        "2026-10-05",
      ),
    /اختر القارئ أولًا/,
  );
  assert.throws(
    () =>
      withReadingCompletion(
        state,
        "r1",
        { mode: "plan", day: 151 },
        true,
        "2026-10-05",
      ),
    /القراءة غير صالحة/,
  );
});
