import { test } from "node:test";
import assert from "node:assert/strict";
import { dayLabel, readingLabel } from "../src/domain/reading/labels.ts";

test("Day labels use Eastern Arabic digits", () => {
  assert.equal(dayLabel(1), "اليوم ١");
  assert.equal(dayLabel(150), "اليوم ١٥٠");
  assert.equal(readingLabel(12), "قراءة اليوم ١٢");
});
