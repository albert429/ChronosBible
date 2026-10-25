import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createReader,
  currentReader,
  exportBackup,
  importBackup,
  loadProgress,
  setReadingCompletion,
  STATE_KEY,
} from "../src/plan/progress.ts";
import { streakStats } from "../src/plan/streak.ts";

/** Read dates as a `readOn` record (the keys don't matter for streaks). */
const on = (...dates: string[]) =>
  Object.fromEntries(dates.map((date, i) => [`plan|${i + 1}`, date]));
const TODAY = "2026-10-20";

test("A streak counts consecutive read dates; today stays pending until read", () => {
  assert.deepEqual(streakStats({}, TODAY), {
    current: 0,
    best: 0,
    readToday: false,
    atRisk: false,
    week: ["idle", "idle", "idle", "idle", "idle", "idle", "today"],
  });
  const three = on("2026-10-18", "2026-10-19", "2026-10-20");
  assert.equal(streakStats(three, TODAY).current, 3);
  assert.equal(streakStats(three, TODAY).readToday, true);
  // Not read yet today: still alive, but at risk.
  const pending = streakStats(on("2026-10-18", "2026-10-19"), TODAY);
  assert.equal(pending.current, 2);
  assert.equal(pending.atRisk, true);
  assert.deepEqual(pending.week, [
    "idle",
    "idle",
    "idle",
    "idle",
    "read",
    "read",
    "today",
  ]);
  // Several readings on one date count once.
  assert.equal(
    streakStats(
      { "plan|1": TODAY, "bible|GEN:1": TODAY, "chrono:OT|ot-001": TODAY },
      TODAY,
    ).current,
    1,
  );
});

test("One missed date a week is a rest day; two in a row end the streak", () => {
  // 10-17 missed between reading: forgiven, not counted.
  const rested = streakStats(
    on("2026-10-15", "2026-10-16", "2026-10-18", "2026-10-19", TODAY),
    TODAY,
  );
  assert.equal(rested.current, 5);
  assert.deepEqual(rested.week, [
    "idle",
    "read",
    "read",
    "rest",
    "read",
    "read",
    "read",
  ]);
  // Two rest days within a week (10-16 and 10-13): only the later one is
  // forgiven, so the streak starts on 10-14.
  assert.equal(
    streakStats(
      on(
        "2026-10-12",
        "2026-10-14",
        "2026-10-15",
        "2026-10-17",
        "2026-10-18",
        "2026-10-19",
        TODAY,
      ),
      TODAY,
    ).current,
    6,
  );
  // A week apart: both forgiven.
  assert.equal(
    streakStats(
      on(
        "2026-10-08",
        "2026-10-10",
        "2026-10-11",
        "2026-10-12",
        "2026-10-13",
        "2026-10-14",
        "2026-10-15",
        "2026-10-16",
        "2026-10-18",
        "2026-10-19",
        TODAY,
      ),
      TODAY,
    ).current,
    11,
  );
  // Two missed dates in a row: the streak is over.
  const broken = streakStats(on("2026-10-14", "2026-10-15", TODAY), TODAY);
  assert.equal(broken.current, 1);
  assert.equal(broken.best, 2);
  assert.deepEqual(broken.week, [
    "read",
    "read",
    "miss",
    "miss",
    "miss",
    "miss",
    "read",
  ]);
  // Yesterday missed, today not yet read: yesterday can still be a rest day.
  const resting = streakStats(on("2026-10-17", "2026-10-18"), TODAY);
  assert.equal(resting.current, 2);
  assert.equal(resting.atRisk, true);
  assert.equal(resting.week[5], "rest");
  // Two days without reading before today: over, until today's reading.
  assert.equal(streakStats(on("2026-10-17"), TODAY).current, 0);
});

test("The best streak survives a break; future dates are ignored", () => {
  const dates = on(
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-10-19",
    TODAY,
    "2026-12-01",
  );
  const stats = streakStats(dates, TODAY);
  assert.equal(stats.current, 2);
  assert.equal(stats.best, 4);
  // Across a month boundary and a Cairo date string.
  assert.equal(
    streakStats(on("2026-09-30", "2026-10-01"), "2026-10-01").current,
    2,
  );
});

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
  };
}

test("Completing a reading records its date per track; undoing forgets it", () => {
  const s = storage();
  const r = createReader(s, "قارئ", "2026-10-01");
  const day = (n: number) => ({ mode: "plan" as const, day: n });
  const chapter = { mode: "bible" as const, book: "GEN", chapter: 1 };
  setReadingCompletion(s, r.id, day(3), true, "2026-10-18");
  setReadingCompletion(s, r.id, chapter, true, "2026-10-19");
  // Marking done again keeps the first date.
  setReadingCompletion(s, r.id, day(3), true, "2026-10-20");
  assert.deepEqual(currentReader(s)!.readOn, {
    "plan|3": "2026-10-18",
    "bible|GEN:1": "2026-10-19",
  });
  setReadingCompletion(s, r.id, day(3), false);
  setReadingCompletion(s, r.id, chapter, false);
  // Nothing left: the field is dropped, not stored empty.
  assert.equal("readOn" in currentReader(s)!, false);
  assert.doesNotMatch(s.values.get(STATE_KEY)!, /readOn/);
  // The guest too.
  setReadingCompletion(s, "", day(5), true, "2026-10-20");
  assert.deepEqual(loadProgress(s).guest.readOn, { "plan|5": "2026-10-20" });
  // An invalid date is never kept.
  setReadingCompletion(s, r.id, day(6), true, "soon");
  assert.equal(currentReader(s)!.readOn, undefined);
});

test("Stored and backed-up dates keep only completed readings with valid dates", () => {
  const s = storage();
  const r = createReader(s, "قارئ", "2026-10-01");
  setReadingCompletion(s, r.id, { mode: "plan", day: 2 }, true, "2026-10-19");
  const state = JSON.parse(s.values.get(STATE_KEY)!);
  state.profiles[0].readOn = {
    "plan|2": "2026-10-19",
    "plan|9": "2026-10-19", // not completed
    "bible|GEN:1": "not a date",
    __proto__: "2026-10-19",
  };
  state.guest.readOn = ["2026-10-19"]; // not a record: ignored
  s.setItem(STATE_KEY, JSON.stringify(state));
  assert.deepEqual(currentReader(s)!.readOn, { "plan|2": "2026-10-19" });
  assert.equal(loadProgress(s).guest.readOn, undefined);

  const text = exportBackup(currentReader(s)!);
  assert.deepEqual(JSON.parse(text).reader.readOn, { "plan|2": "2026-10-19" });
  const other = storage();
  const restored = importBackup(other, text);
  assert.deepEqual(restored.readOn, { "plan|2": "2026-10-19" });
  // Backups without dates, and unknown reader keys, behave as before.
  const plain = JSON.parse(text);
  delete plain.reader.readOn;
  assert.equal("readOn" in importBackup(other, JSON.stringify(plain)), false);
  plain.reader.streak = 5;
  assert.throws(() => importBackup(other, JSON.stringify(plain)));
});
