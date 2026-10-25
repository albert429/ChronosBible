import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chapterAvailability,
  chapterHasAudio,
} from "../src/audio/availability.ts";
import { catalog } from "../src/bible/catalog.ts";

test("Chapter availability is one flag per canonical chapter in catalog order", () => {
  const published = ["bible:GEN:1", "bible:PSA:119", "bible:REV:22"];
  const flags = chapterAvailability(catalog, published);
  assert.equal(flags.length, 1189);
  assert.equal(flags.replaceAll("0", ""), "111");
  assert.equal(flags[0], "1");
  assert.equal(flags.at(-1), "1");
  for (const identity of published) {
    const [, book, chapter] = identity.split(":");
    assert.ok(chapterHasAudio(catalog, flags, { book, chapter: +chapter }));
  }
  for (const [book, chapter] of [
    ["GEN", 2],
    ["PSA", 118],
    ["PSA", 120],
    ["REV", 21],
    ["REV", 23],
    ["GEN", 0],
    ["XYZ", 1],
  ] as const)
    assert.equal(chapterHasAudio(catalog, flags, { book, chapter }), false);
  // A build without a catalog advertises nothing rather than everything.
  assert.equal(
    chapterHasAudio(catalog, "", { book: "GEN", chapter: 1 }),
    false,
  );
  assert.equal(chapterAvailability(catalog, []), "0".repeat(1189));
});
