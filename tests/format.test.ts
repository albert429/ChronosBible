import { test } from "node:test";
import assert from "node:assert/strict";
import { ar, clock, dateLabel, daysLabel, today } from "../src/lib/format.ts";

test("Numbers use Eastern Arabic digits without grouping", () => {
  assert.equal(ar(0), "٠");
  assert.equal(ar(150), "١٥٠");
  assert.equal(ar(12345), "١٢٣٤٥");
});

test("today() is the Cairo calendar date, not the UTC date", (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-01-15T21:59:00Z"),
  });
  assert.equal(today(), "2026-01-15");
  t.mock.timers.setTime(Date.parse("2026-01-15T22:00:00Z"));
  assert.equal(today(), "2026-01-16");
  // Daylight saving (UTC+3) from late April until the end of October.
  t.mock.timers.setTime(Date.parse("2026-07-01T21:00:00Z"));
  assert.equal(today(), "2026-07-02");
});

test("Date labels are the Arabic weekday, day and month", () => {
  assert.equal(dateLabel("2026-10-01"), "الخميس، ١ أكتوبر");
  assert.equal(dateLabel("2027-02-27"), "السبت، ٢٧ فبراير");
  assert.equal(dateLabel("2028-02-29"), "الثلاثاء، ٢٩ فبراير");
});

test("Day counts agree with their number", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 10, 11, 99, 100, 101, 103, 150].map(daysLabel),
    [
      "٠ يوم",
      "يوم واحد",
      "يومان",
      "٣ أيام",
      "١٠ أيام",
      "١١ يومًا",
      "٩٩ يومًا",
      "١٠٠ يوم",
      "١٠١ يوم",
      "١٠٣ أيام",
      "١٥٠ يومًا",
    ],
  );
});

test("Recording times read as minutes and seconds in Arabic digits", () => {
  assert.equal(clock(0), "٠:٠٠");
  assert.equal(clock(65.9), "١:٠٥");
  assert.equal(clock(600), "١٠:٠٠");
  assert.equal(clock(3725), "١:٠٢:٠٥");
  assert.equal(clock(Number.NaN), "٠:٠٠");
});
