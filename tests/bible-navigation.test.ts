import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adjacentChapter,
  parseReadingLocation,
  readingSearch,
} from "../src/bible/navigation.ts";
import { readingKey, type BibleBook } from "../src/bible/types.ts";

const catalog: BibleBook[] = [
  {
    usfm: "GEN",
    name: "التكوين",
    testament: "OT",
    chapters: 2,
    verseCounts: [31, 25],
  },
  {
    usfm: "REV",
    name: "رؤيا يوحنا",
    testament: "NT",
    chapters: 1,
    verseCounts: [21],
  },
];
const first = { mode: "bible" as const, book: "GEN", chapter: 1 };

test("Canonical navigation crosses books and stops at the Bible boundaries", () => {
  assert.equal(adjacentChapter(catalog, first, -1), undefined);
  assert.deepEqual(adjacentChapter(catalog, { ...first, chapter: 2 }, 1), {
    mode: "bible",
    book: "REV",
    chapter: 1,
  });
  assert.deepEqual(
    adjacentChapter(catalog, { mode: "bible", book: "REV", chapter: 1 }, -1),
    { ...first, chapter: 2 },
  );
  assert.equal(
    adjacentChapter(catalog, { mode: "bible", book: "REV", chapter: 1 }, 1),
    undefined,
  );
});
test("Links round trip and reject invalid chapter and verse bounds", () => {
  const location = { ...first, verse: 31 };
  assert.equal(
    readingSearch(location),
    "?mode=bible&book=GEN&chapter=1&verse=31",
  );
  assert.deepEqual(
    parseReadingLocation(readingSearch(location), catalog),
    location,
  );
  assert.deepEqual(parseReadingLocation("?day=150", catalog), {
    mode: "plan",
    day: 150,
  });
  for (const query of [
    "?day=151",
    "?day=1.5",
    "?mode=unknown&day=1",
    "?mode=bible&book=GEN&chapter=3",
    "?mode=bible&book=GEN&chapter=1&verse=32",
    "?mode=bible&book=GEN&chapter=1&verse=0",
    "?mode=bible&book=BAD&chapter=1",
  ])
    assert.equal(parseReadingLocation(query, catalog), undefined, query);
});
test("Reading identities keep chronological and canonical readings distinct", () => {
  assert.equal(readingKey(first), "bible:GEN:1");
  assert.equal(readingKey({ mode: "plan", day: 1 }), "plan:1");
});
