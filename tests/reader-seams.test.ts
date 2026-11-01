import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { studyContext } from "../src/features/reader/studyContext.ts";
import {
  continuedListening,
  listeningSurvives,
} from "../src/features/reader/listening.ts";
import { navigationModel } from "../src/features/navigation/model.ts";
import { catalog } from "../src/domain/scripture/catalog.ts";
import type {
  BibleChapter,
  Day,
  ScriptureReading,
} from "../src/domain/reading/types.ts";
import type { ChronologicalReading } from "../src/domain/reading/chronology.ts";
import type { Passage } from "../src/domain/scripture/types.ts";

const plan: Day[] = JSON.parse(
  readFileSync(new URL("../data/plan.json", import.meta.url), "utf8"),
);
const chronological = (passages: Passage[]) =>
  ({
    mode: "chronological",
    testament: "NT",
    readingId: "test",
    title: "قراءة",
    passages,
  }) as unknown as ChronologicalReading;
const chapter = (passage: Passage): BibleChapter => ({
  mode: "bible",
  usfm: catalog.find((book) => book.name === passage.book)!.usfm,
  book: passage.book,
  chapter: passage.chapter,
  verseCount: passage.verses.length,
  passages: [passage],
  structure: [],
});

/** The book StudyPanel resolves from its `usfm` prop and the passage. */
const studiedBook = (usfm: string | undefined, passage: Passage) =>
  catalog.find((item) =>
    usfm ? item.usfm === usfm : item.name === passage.book,
  )?.usfm;

/**
 * What the study sheet received before the canonical context: plan days and
 * chapters as they are, a chronological passage as a synthetic chapter.
 */
function previousStudy(reading: ScriptureReading, index: number, n: number) {
  let passage = reading.passages[index];
  let usfm =
    "mode" in reading && reading.mode === "bible" ? reading.usfm : undefined;
  if ("mode" in reading && reading.mode === "chronological") {
    const book = catalog.find((item) => item.name === passage.book);
    if (!book) return;
    usfm = book.usfm;
    passage = chapter(passage).passages[0];
  }
  const verse = passage?.verses?.find((item) => item.number === n);
  if (!passage || !verse) return;
  return { book: studiedBook(usfm, passage), passage, verse };
}

test("the canonical study context studies the same verse as before in every track", () => {
  let verses = 0;
  for (const day of plan) {
    const readings: ScriptureReading[] = [
      day,
      chronological(day.passages),
      ...day.passages.map(chapter),
    ];
    for (const reading of readings)
      reading.passages.forEach((passage, index) => {
        for (const verse of passage.verses) {
          const before = previousStudy(reading, index, verse.number);
          const context = studyContext(reading, index, verse.number);
          assert.ok(before && context);
          assert.equal(studiedBook(context.usfm, context.passage), before.book);
          assert.ok(before.book, passage.book);
          assert.equal(context.passage, passage);
          assert.equal(context.verse, verse);
          verses++;
        }
      });
  }
  assert.ok(verses > 7900 * 3);
  // A verse or passage the reading does not render opens nothing.
  assert.equal(studyContext(plan[0], 0, 999), undefined);
  assert.equal(studyContext(plan[0], 99, 1), undefined);
});

test("only the session a natural end hands on survives the next navigation", () => {
  const reading = plan[0];
  const next = { mode: "plan" as const, day: 2 };
  const continued = continuedListening(reading, next, 4);
  assert.deepEqual(continued, {
    continuing: true,
    identity: "plan:2",
    navigation: 5,
    reading,
  });
  assert.equal(listeningSurvives(continued, 5, "plan:2"), true);
  // Manual navigation, Back, or another reading close the player.
  assert.equal(listeningSurvives(continued, 6, "plan:2"), false);
  assert.equal(listeningSurvives(continued, 5, "plan:3"), false);
  const opened = { identity: "plan:1", navigation: 4, reading };
  assert.equal(listeningSurvives(opened, 4, "plan:1"), true);
  assert.equal(listeningSurvives(opened, 5, "plan:1"), false);
  assert.equal(listeningSurvives(null, 4, "plan:1"), false);
});

test("the navigation model keeps compact toolbar labels and full sheet titles", () => {
  const day = navigationModel({ mode: "plan", day: 7 }, "", 7);
  assert.equal(day.place, "اليوم ٧");
  assert.equal(day.titles.day, "قراءة اليوم ٧");
  assert.equal(day.pickerPanel, "day");
  assert.equal(day.pickerLabel, "تفاصيل اليوم ٧ · العهد الجديد في ١٥٠ يومًا");
  assert.deepEqual(day.adjacentLabels, ["اليوم السابق", "اليوم التالي"]);
  const gen = navigationModel(
    { mode: "bible", book: "GEN", chapter: 12, verse: 3 },
    "",
    7,
  );
  assert.equal(gen.place, "التكوين ١٢");
  assert.equal(gen.pickerPanel, "bible");
  assert.equal(gen.pickerLabel, "اختيار السفر والإصحاح: التكوين ١٢");
  assert.ok(gen.bible && !gen.chrono);
  const chrono = navigationModel(
    { mode: "chronological", testament: "OT", readingId: "gen-1-1" },
    "",
    7,
  );
  // The title is not known until the catalog loads.
  assert.equal(chrono.place, "");
  assert.equal(
    chrono.pickerLabel,
    "فهرس العهد القديم بالترتيب الزمني: جارٍ التحميل",
  );
  assert.equal(chrono.titles.chronology, "العهد القديم بالترتيب الزمني");
  assert.equal(
    navigationModel(
      { mode: "chronological", testament: "NT", readingId: "luk-1-1" },
      "البداية",
      7,
    ).place,
    "البداية",
  );
});
