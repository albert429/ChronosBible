import assert from "node:assert/strict";
import { test } from "node:test";
import { adjacentLocation } from "../src/navigation/adjacent.ts";
import type { ChronologyCatalog } from "../src/chronology/types.ts";

test("canonical neighbours cross books but stop at Genesis 1 and Revelation 22", () => {
  const genesis = { mode: "bible", book: "GEN", chapter: 1 } as const;
  assert.equal(adjacentLocation(genesis, -1), undefined);
  assert.deepEqual(adjacentLocation(genesis, 1), {
    mode: "bible",
    book: "GEN",
    chapter: 2,
  });
  assert.deepEqual(
    adjacentLocation({ mode: "bible", book: "GEN", chapter: 50 }, 1),
    { mode: "bible", book: "EXO", chapter: 1 },
  );
  assert.equal(
    adjacentLocation({ mode: "bible", book: "REV", chapter: 22 }, 1),
    undefined,
  );
});

test("plan neighbours stay within the 150 days and drop any verse", () => {
  assert.equal(adjacentLocation({ mode: "plan", day: 1 }, -1), undefined);
  assert.deepEqual(adjacentLocation({ mode: "plan", day: 5, verse: 3 }, 1), {
    mode: "plan",
    day: 6,
  });
  assert.equal(adjacentLocation({ mode: "plan", day: 150 }, 1), undefined);
});

test("chronological neighbours wait for their catalog", () => {
  const location = {
    mode: "chronological",
    testament: "NT",
    readingId: "b",
  } as const;
  const catalog = {
    testament: "NT",
    readings: [{ id: "a" }, { id: "b" }],
  } as unknown as ChronologyCatalog;
  assert.equal(adjacentLocation(location, 1), undefined);
  assert.deepEqual(adjacentLocation(location, -1, catalog), {
    mode: "chronological",
    testament: "NT",
    readingId: "a",
  });
  assert.equal(adjacentLocation(location, 1, catalog), undefined);
});
