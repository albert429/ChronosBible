import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRACK_NAMES,
  continueReading,
  durationLabel,
  minutesLabel,
} from "../src/navigation/modes.ts";
import { READING_TRACKS } from "../src/bible/types.ts";

test("Every reading track has a distinct Arabic name", () => {
  const names = READING_TRACKS.map((track) => TRACK_NAMES[track]);
  assert.equal(new Set(names).size, READING_TRACKS.length);
  assert.equal(TRACK_NAMES.plan, "العهد الجديد في ١٥٠ يومًا");
});

test("Durations and counts use Arabic number agreement", () => {
  assert.equal(minutesLabel(1), "دقيقة واحدة");
  assert.equal(minutesLabel(2), "دقيقتان");
  assert.equal(minutesLabel(9.6), "١٠ دقائق");
  assert.equal(minutesLabel(12), "١٢ دقيقة");
  assert.equal(minutesLabel(0), "دقيقة واحدة");
  assert.equal(durationLabel(45), "٤٥ دقيقة");
  assert.equal(durationLabel(60), "ساعة");
  assert.equal(durationLabel(135), "ساعتان و١٥ دقيقة");
  assert.equal(durationLabel(5 * 60 + 3), "٥ ساعات و٣ دقائق");
  assert.equal(durationLabel(103 * 60), "١٠٣ ساعات");
});

test("Continue reading finds the next unfinished reading, wrapping once", () => {
  const readings = ["a", "b", "c", "d"].map((id) => ({
    id,
    stageId: "s",
    title: id,
    estimatedMinutes: 10,
  }));
  const ids = (done: string[], current: string) =>
    continueReading(readings, current, new Set(done))?.id;
  assert.equal(ids([], "a"), "a");
  assert.equal(ids(["b"], "b"), "c");
  assert.equal(ids(["c", "d"], "c"), "a");
  assert.equal(ids([], "unknown"), "a");
  assert.equal(ids(["a", "b", "c", "d"], "b"), undefined);
});
