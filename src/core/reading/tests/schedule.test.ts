import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAGE_COUNT,
  PAGE_SIZE,
  PLAN_DAYS,
  clampDay,
  dateFor,
  dayIndex,
  dayStatus,
  isPlanDay,
  pageFor,
  scheduledDay,
} from "../schedule.ts";
import { today } from "../../../shared/browser/clock.ts";

test("Day numbers count from the start date, inclusive", () => {
  assert.equal(dayIndex("2026-10-01", "2026-10-01"), 1);
  assert.equal(dayIndex("2026-10-01", "2026-10-02"), 2);
  assert.equal(dayIndex("2026-10-01", "2027-02-27"), 150);
  assert.equal(dayIndex("2026-10-01", "2026-09-30"), 0);
  assert.equal(dayIndex("2026-10-01", "2026-09-01"), -29);
  // Across a year boundary and a leap day.
  assert.equal(dayIndex("2027-12-31", "2028-01-01"), 2);
  assert.equal(dayIndex("2028-02-28", "2028-03-01"), 3);
});

test("The scheduled day is clamped to the plan and follows the Cairo date", (t) => {
  assert.equal(scheduledDay("2026-10-01", "2026-09-15"), 1);
  assert.equal(scheduledDay("2026-10-01", "2026-10-01"), 1);
  assert.equal(scheduledDay("2026-10-01", "2026-10-10"), 10);
  assert.equal(scheduledDay("2026-10-01", "2027-02-27"), 150);
  assert.equal(scheduledDay("2026-10-01", "2030-01-01"), 150);
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-10-05T10:00:00Z"),
  });
  assert.equal(scheduledDay("2026-10-01", today()), 5);
});

test("dateFor is the inverse of dayIndex", () => {
  assert.equal(dateFor("2026-10-01", 1), "2026-10-01");
  assert.equal(dateFor("2026-10-01", 3), "2026-10-03");
  assert.equal(dateFor("2026-10-01", 150), "2027-02-27");
  assert.equal(dateFor("2028-02-28", 3), "2028-03-01");
  for (const day of [1, 2, 31, 100, 150])
    assert.equal(dayIndex("2026-10-01", dateFor("2026-10-01", day)), day);
});

test("The plan is five pages of thirty days", () => {
  assert.equal(PLAN_DAYS, 150);
  assert.equal(PAGE_SIZE * PAGE_COUNT, PLAN_DAYS);
});

test("Pages hold thirty days each", () => {
  assert.equal(pageFor(1), 0);
  assert.equal(pageFor(30), 0);
  assert.equal(pageFor(31), 1);
  assert.equal(pageFor(120), 3);
  assert.equal(pageFor(121), 4);
  assert.equal(pageFor(PLAN_DAYS), PAGE_COUNT - 1);
});

test("Plan days are whole numbers from 1 to the last day", () => {
  for (const day of [1, 2, 149, 150]) assert.ok(isPlanDay(day), String(day));
  for (const day of [0, -1, 151, 1.5, NaN, Infinity])
    assert.ok(!isPlanDay(day), String(day));
  assert.equal(clampDay(-5), 1);
  assert.equal(clampDay(75), 75);
  assert.equal(clampDay(999), PLAN_DAYS);
});

test("A day's status compares it with the current day; done wins", () => {
  assert.equal(dayStatus(5, 5, false), "today");
  assert.equal(dayStatus(4, 5, false), "behind");
  assert.equal(dayStatus(6, 5, false), "ahead");
  assert.equal(dayStatus(5, 5, true), "done");
  assert.equal(dayStatus(4, 5, true), "done");
  assert.equal(dayStatus(6, 5, true), "done");
});

test("Status uses whichever current day the caller passes", () => {
  // Before the start date the unclamped index is 0 or below: no day is today.
  assert.equal(dayStatus(1, 0, false), "ahead");
  assert.equal(dayStatus(1, clampDay(0), false), "today");
  // After the last day every unfinished day is behind, until clamped.
  assert.equal(dayStatus(150, 151, false), "behind");
  assert.equal(dayStatus(150, clampDay(151), false), "today");
});
