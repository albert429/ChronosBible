import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chapterRange,
  chapterVerse,
  isolate,
  rangeAriaLabel,
  rangeText,
} from "../src/domain/scripture/reference.ts";
import { verseId } from "../src/domain/study/reference.ts";

test("A single verse shows one number; a range shows both with an en dash", () => {
  assert.equal(rangeText({ start: 5, end: 5 }), "٥");
  assert.equal(rangeText({ start: 5, end: 12 }), "٥–١٢");
});

test("Chapter and verse text keeps the Eastern Arabic digits", () => {
  assert.equal(chapterRange(3, { start: 16, end: 18 }), "٣: ١٦–١٨");
  assert.equal(chapterRange(3, { start: 16, end: 16 }), "٣: ١٦");
  assert.equal(chapterVerse(1, 1), "١: ١");
});

test("The spoken reference says verse or verses", () => {
  assert.equal(
    rangeAriaLabel(3, { start: 16, end: 16 }),
    "الإصحاح ٣، الآية ١٦",
  );
  assert.equal(
    rangeAriaLabel(3, { start: 16, end: 18 }),
    "الإصحاح ٣، الآيات ١٦–١٨",
  );
});

test("isolate wraps text in first-strong isolate characters", () => {
  assert.equal(isolate("١: ١"), "⁦١: ١⁩");
});

test("Verse IDs join the USFM book code, chapter and verse", () => {
  assert.equal(verseId("JHN", 1, 1), "JHN.1.1");
});
