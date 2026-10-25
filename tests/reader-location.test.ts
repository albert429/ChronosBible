import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initialPreferences,
  loadPreferences,
  locationSearch,
  planLocation,
  sameLocation,
  validLocation,
  withLocation,
} from "../src/reader/location.ts";
import { chapterSegments } from "../src/reader/chapterSegments.ts";

test("each reader's last plan place, the Bible place and the mode are remembered", () => {
  const saved = {
    version: 1,
    mode: "bible",
    plans: {
      "reader-a": { mode: "plan", day: 83 },
      "": { mode: "plan", day: 5, verse: 2 },
    },
    bible: { mode: "bible", book: "JHN", chapter: 3, verse: 16 },
    continuous: true,
  };
  const loaded = loadPreferences(JSON.stringify(saved));
  assert.deepEqual(loaded, saved);
  assert.deepEqual(planLocation(loaded, "reader-a", 10), {
    mode: "plan",
    day: 83,
  });
  assert.deepEqual(planLocation(loaded, "", 1), {
    mode: "plan",
    day: 5,
    verse: 2,
  });
  // A reader without a place of their own starts on their scheduled day.
  assert.deepEqual(planLocation(loaded, "reader-b", 12), {
    mode: "plan",
    day: 12,
  });
  // Moving in the plan updates only the active reader; the Bible place stays.
  const moved = withLocation(loaded, "reader-b", { mode: "plan", day: 13 });
  assert.equal(moved.mode, "plan");
  assert.deepEqual(moved.plans["reader-a"], saved.plans["reader-a"]);
  assert.deepEqual(moved.plans["reader-b"], { mode: "plan", day: 13 });
  assert.deepEqual(moved.bible, saved.bible);
  const read = withLocation(moved, "reader-b", {
    mode: "bible",
    book: "PSA",
    chapter: 119,
  });
  assert.equal(read.mode, "bible");
  assert.deepEqual(read.plans, moved.plans);
  // Places are bounded, keeping the most recently used readers.
  let many = loadPreferences(null);
  for (let i = 0; i < 25; i++)
    many = withLocation(many, `r${i}`, { mode: "plan", day: i + 1 });
  assert.equal(Object.keys(many.plans).length, 20);
  assert.ok(many.plans.r24 && !many.plans.r4);
});

test("explicit links choose the place and update the active reader's plan place", () => {
  const saved = JSON.stringify({
    version: 1,
    mode: "bible",
    plans: { "reader-a": { mode: "plan", day: 83 } },
    bible: { mode: "bible", book: "JHN", chapter: 3 },
    continuous: false,
  });
  const linked = initialPreferences("reader-a", "?day=7", saved);
  assert.equal(linked.mode, "plan");
  assert.deepEqual(linked.plans["reader-a"], { mode: "plan", day: 7 });
  const chapter = initialPreferences(
    "reader-a",
    "?mode=bible&book=REV&chapter=22&verse=21",
    saved,
  );
  assert.equal(chapter.mode, "bible");
  assert.deepEqual(chapter.bible, {
    mode: "bible",
    book: "REV",
    chapter: 22,
    verse: 21,
  });
  assert.deepEqual(chapter.plans, JSON.parse(saved).plans);
  // An invalid link is ignored rather than replacing a remembered place.
  assert.deepEqual(
    initialPreferences("reader-a", "?mode=bible&book=XYZ&chapter=1", saved),
    loadPreferences(saved),
  );
});

test("plan days reached in the app keep the bare URL; chapters get a static link", () => {
  assert.equal(locationSearch({ mode: "plan", day: 7, verse: 3 }), "");
  assert.equal(
    locationSearch({ mode: "bible", book: "GEN", chapter: 1, verse: 1 }),
    "?mode=bible&book=GEN&chapter=1&verse=1",
  );
  // An address that already names the place (an explicit link) is kept.
  assert.ok(sameLocation({ mode: "plan", day: 7 }, { mode: "plan", day: 7 }));
  assert.ok(
    !sameLocation({ mode: "plan", day: 7 }, { mode: "plan", day: 7, verse: 1 }),
  );
  assert.ok(
    !sameLocation(
      { mode: "plan", day: 1 },
      { mode: "bible", book: "GEN", chapter: 1 },
    ),
  );
  assert.ok(!sameLocation(undefined, { mode: "plan", day: 1 }));
});

test("invalid saved locations and malformed storage fall back safely", () => {
  const initial = loadPreferences();
  for (const value of [
    "bad",
    "null",
    "[]",
    '{"version":9}',
    '{"version":1,"plans":{"a":{"mode":"plan","day":0},"b":{"mode":"bible","book":"GEN","chapter":1}},"bible":{"mode":"bible","book":"GEN","chapter":51},"continuous":"true"}',
    '{"version":1,"plans":[{"mode":"plan","day":3}]}',
  ]) {
    assert.deepEqual(loadPreferences(value), initial);
  }
  for (const location of [
    null,
    { mode: "bible", book: "GEN", chapter: 1, verse: 32 },
    { mode: "plan", day: 151 },
    { mode: "plan", day: 1, verse: 0 },
  ])
    assert.equal(validLocation(location), false);
});

test("source structure splits by Unicode codepoint without altering Arabic text", () => {
  const text = "فِي ٱلْبَدْءِ كَانَ ٱلْكَلِمَةُ 🌿";
  const blocks = [
    { kind: "paragraph" as const, marker: "p", verse: 1, offset: 0 },
    { kind: "poetry" as const, marker: "q2", verse: 1, offset: 14 },
  ];
  const segments = chapterSegments(text, blocks);
  assert.equal(segments.map((segment) => segment.text).join(""), text);
  assert.equal(segments[0].text, Array.from(text).slice(0, 14).join(""));
  assert.equal(segments[1].blocks[0].marker, "q2");
});

test("reader ids that name Object.prototype members still get their own plan place", () => {
  for (const id of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    // No saved place: the scheduled day, never an inherited member.
    assert.deepEqual(planLocation(loadPreferences(), id, 7), {
      mode: "plan",
      day: 7,
    });
    // A stored place survives saving and loading as an own entry.
    const moved = withLocation(loadPreferences(), id, {
      mode: "plan",
      day: 42,
    });
    assert.deepEqual(planLocation(moved, id, 7), { mode: "plan", day: 42 });
    const reloaded = loadPreferences(JSON.stringify(moved));
    assert.ok(Object.hasOwn(reloaded.plans, id));
    assert.deepEqual(planLocation(reloaded, id, 7), { mode: "plan", day: 42 });
    assert.deepEqual(planLocation(reloaded, "other", 3), {
      mode: "plan",
      day: 3,
    });
  }
});
