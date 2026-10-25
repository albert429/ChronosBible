import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  TARGET_WORDS,
  auditOccurrences,
  correctedOccurrences,
  groupSegment,
  prepareChronology,
  readingTitle,
  sourceOccurrences,
  verseSequence,
} from "../scripts/build-chronology.js";
import { readBibleChapters } from "../scripts/build-bible.js";
import type { BibleChapter } from "../src/bible/types.ts";
import { catalog as books } from "../src/bible/catalog.ts";
import type { Day } from "../src/plan/readings.ts";
import type {
  ChronologicalReadingDefinition,
  ChronologyCatalog,
} from "../src/chronology/types.ts";

const root = new URL("../", import.meta.url).pathname;
const built = prepareChronology(root);
const { source, review, stages } = built.inputs;
type Prepared = {
  catalog: ChronologyCatalog;
  definitions: ChronologicalReadingDefinition[];
};
const ot = built.testaments.OT as unknown as Prepared;
const nt = built.testaments.NT as unknown as Prepared;
const flatten = (
  ranges: { usfm: string; chapter: number; from: number; to: number }[],
) =>
  ranges.flatMap(({ usfm, chapter, from, to }) =>
    Array.from(
      { length: to - from + 1 },
      (_, i) => `${usfm} ${chapter}:${from + i}`,
    ),
  );
const readingVerses = ({ definitions }: Prepared) =>
  flatten(definitions.flatMap((d) => d.passages));
const usfmOf = new Map(books.map((b) => [b.name, b.usfm]));
const plan: Day[] = JSON.parse(
  readFileSync(new URL("../data/plan.json", import.meta.url), "utf8"),
);
const planVerses = plan.flatMap((day) =>
  day.passages.flatMap((p) =>
    p.verses.map((v) => `${usfmOf.get(p.book)} ${p.chapter}:${v.number}`),
  ),
);

test("The source is pinned and its audit counts are exact", () => {
  assert.equal(source.source.sha256, review.sourceSha256);
  const [rawOT, rawNT] = built.audit.raw;
  assert.deepEqual(
    [rawOT.occurrences, rawOT.verses, rawOT.canonical, rawOT.distinct],
    [1224, 23309, 23145, 23145],
  );
  assert.deepEqual(
    [rawNT.occurrences, rawNT.verses, rawNT.canonical, rawNT.distinct],
    [534, 7965, 7959, 7958],
  );
  assert.deepEqual(rawOT.omissions, []);
  assert.deepEqual(rawNT.omissions, ["1TI 6:22"]);
  assert.equal(rawOT.invalid + rawNT.invalid, "");
  assert.equal(rawOT.duplicates.length, 16);
  assert.equal(rawNT.duplicates.length, 4);
  // Repeated verse occurrences (beyond each verse's first reading).
  assert.equal(rawOT.verses - rawOT.distinct, 164);
  assert.equal(rawNT.verses - rawNT.distinct, 7);
  const [okOT, okNT] = built.audit.corrected;
  assert.deepEqual([okOT.omissions, okNT.omissions], [[], []]);
});

test("Known source repetitions are kept as explicit occurrences, never deduplicated", () => {
  const verses = review.duplicates.map((d: { verses: string }) => d.verses);
  for (const known of ["NUM 7:1-89", "NUM 8:1-26", "NUM 9:1-14", "NUM 9:15-23"])
    assert.ok(verses.includes(known), known);
  const numbers7 = ot.definitions.filter((d) =>
    d.passages.some((p) => p.usfm === "NUM" && p.chapter === 7),
  );
  assert.deepEqual(
    numbers7.map((d) => [d.id, d.stageId]),
    [
      ["num-7-1", "exodus"],
      ["num-7-1-2", "exodus"],
    ],
  );
  // Every reviewed entry is visible as two occurrence ids in the readings.
  const ids = new Set(
    [...ot.definitions, ...nt.definitions].flatMap((d) =>
      d.passages.map((p) => p.id.replace(/-v\d+$/, "")),
    ),
  );
  for (const d of review.duplicates)
    for (const id of d.occurrences) assert.ok(ids.has(id), id);
  // Parent review: every repetition keeps the source sequence; possible
  // source errors keep a suggestion for a future source revision.
  assert.ok(
    review.duplicates.every(
      (d: { disposition: string; note: string }) =>
        d.disposition === "keep" && d.note,
    ),
  );
  const suggested = review.duplicates.filter(
    (d: { suggestion?: string }) => d.suggestion,
  );
  assert.equal(suggested.length, 5);
});

test("Readings contain exactly the source occurrences in order (only reviewed corrections)", () => {
  for (const [testament, prepared] of [
    ["OT", ot],
    ["NT", nt],
  ] as const) {
    const expected = flatten(
      correctedOccurrences(sourceOccurrences(source, testament), review),
    );
    assert.deepEqual(readingVerses(prepared), expected);
  }
});

test("The self-paced New Testament shares the youth plan's exact verse sequence", () => {
  assert.equal(planVerses.length, 7966);
  assert.deepEqual(readingVerses(nt), planVerses);
  // The PDF itself differs only by 1 Timothy 6:22 (Van Dyck versification).
  const pdf = flatten(sourceOccurrences(source, "NT"));
  const at = planVerses.indexOf("1TI 6:22");
  assert.deepEqual(
    [...planVerses.slice(0, at), ...planVerses.slice(at + 1)],
    pdf,
  );
  const corrected = nt.definitions
    .flatMap((d) => d.passages)
    .filter((p) =>
      p.provenance?.exceptions?.some((e) => e.kind === "corrected"),
    );
  assert.deepEqual(
    corrected.map((p) => [p.id, p.usfm, p.chapter, p.from, p.to]),
    [["g349-1", "1TI", 6, 11, 22]],
  );
});

const OT_STAGES = [
  "البدايات: الخلق والطوفان",
  "الآباء: من إبراهيم إلى يوسف",
  "الخروج من مصر والعهد",
  "البرية والاستعداد لأرض الموعد",
  "أرض الموعد وعصر القضاة",
  "المملكة المتحدة: شاول وداود وسليمان",
  "المملكة المنقسمة وخدمة الأنبياء",
  "السبي والرجاء",
  "العودة وتجديد العهد",
];
const NT_STAGES = [
  "حياة يسوع وخدمته",
  "بداية الكنيسة وانتشار الإنجيل",
  "رحلات بولس التبشيرية",
  "بولس إلى روما ورسائل السجن",
  "تثبيت الكنائس ورسائل الرسل",
  "سفر الرؤيا",
];

test("Stages have the agreed titles, follow source order and never share a reading", () => {
  assert.deepEqual(
    ot.catalog.stages.map((s) => s.title),
    OT_STAGES,
  );
  assert.deepEqual(
    nt.catalog.stages.map((s) => s.title),
    NT_STAGES,
  );
  for (const { catalog } of [ot, nt]) {
    const order = catalog.readings.map(
      (r) => `${r.stageId}/${r.substageId ?? ""}`,
    );
    const runs = order.filter((key, i) => key !== order[i - 1]);
    assert.equal(new Set(runs).size, runs.length, "stages are contiguous");
    const expected = catalog.stages.flatMap((s) =>
      s.substages
        ? s.substages.map((sub) => `${s.id}/${sub.id}`)
        : [`${s.id}/`],
    );
    assert.deepEqual(runs, expected);
  }
  const firsts = (p: Prepared) =>
    p.catalog.stages.flatMap((s) =>
      (s.substages ?? [s]).map(
        (sub) =>
          p.catalog.readings.find((r) =>
            s.substages ? r.substageId === sub.id : r.stageId === s.id,
          )!.id,
      ),
    );
  assert.deepEqual(firsts(ot), [
    "gen-1-1",
    "gen-11-27",
    "exo-1-1",
    "num-10-1",
    "jos-1-1",
    "1sa-8-1",
    "1ki-12-1",
    "2ki-25-3",
    "2ch-36-22",
  ]);
  assert.deepEqual(firsts(nt), [
    "mrk-1-1",
    "mrk-1-14",
    "mrk-14-1",
    "act-1-1",
    "act-13-1",
    "act-15-36",
    "act-18-23",
    "act-21-1",
    "jas-1-1",
    "rev-1-1",
  ]);
  // James follows Philippians in the source; letters stay interleaved.
  const letters = nt.definitions.find((d) => d.id === "jas-1-1")!;
  const before = nt.definitions[nt.definitions.indexOf(letters) - 1];
  assert.equal(before.passages.at(-1)!.usfm, "PHP");
  assert.ok(
    stages.testaments.OT.stages.every((s: { reason: string }) => s.reason),
  );
});

test("Reading ids are stable slugs, unique per testament, and regeneration is identical", () => {
  for (const { catalog } of [ot, nt]) {
    const ids = catalog.readings.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)));
  }
  const again = prepareChronology(root);
  assert.deepEqual(again.testaments.OT.catalog, ot.catalog);
  assert.deepEqual(again.testaments.NT.definitions, nt.definitions);
  // Changing any id breaks saved places and completion; update deliberately.
  const digest = (p: Prepared) =>
    createHash("sha256")
      .update(p.catalog.readings.map((r) => r.id).join("\n"))
      .digest("hex")
      .slice(0, 16);
  assert.deepEqual(
    [ot.catalog.readings.length, nt.catalog.readings.length],
    [412, 141],
  );
  assert.deepEqual(
    [digest(ot), digest(nt)],
    ["4399a8dea286269c", "e50549a12430635c"],
  );
});

test("Catalogs carry summaries only; readings never split a verse and stay near ten minutes", () => {
  for (const p of [ot, nt]) {
    assert.ok(p.catalog.readings.every((r) => !("passages" in r)));
    assert.doesNotMatch(JSON.stringify(p.catalog), /"verses"|"text"/);
    for (const d of p.definitions) {
      assert.equal(
        d.verseCount,
        d.passages.reduce((n, x) => n + x.to - x.from + 1, 0),
      );
      assert.ok(d.title.length <= 200);
    }
    const minutes = p.definitions.map((d) => d.estimatedMinutes);
    const near = minutes.filter((m) => m >= 7 && m <= 13).length;
    assert.ok(near / minutes.length > 0.9, `${near}/${minutes.length}`);
    assert.ok(Math.max(...minutes) <= 15);
  }
});

const items = (words: number[], natural = words.map(() => true)) =>
  words.map((w, i) => ({ words: w, natural: natural[i] }));

test("Grouping picks the boundary nearest the target and the earlier one on a tie", () => {
  // Boundaries after 700 and 900 words are equally far from 800: earlier wins.
  assert.deepEqual(groupSegment(items([700, 200, 700]), 0, 3, 800), [1, 3]);
  // 750 is nearer than 950.
  assert.deepEqual(groupSegment(items([750, 200, 750]), 0, 3, 800), [1, 3]);
  // 850 is nearer than 600; then 600 and 1000 tie, so the earlier wins.
  assert.deepEqual(
    groupSegment(items([600, 250, 600, 400]), 0, 4, 800),
    [2, 3, 4],
  );
  // Only natural boundaries count; a long section is not cut mid-way.
  assert.deepEqual(
    groupSegment(
      items([500, 500, 500, 500], [true, false, false, true]),
      0,
      4,
      800,
    ),
    [3, 4],
  );
  // The segment end (a stage boundary) is always a break.
  assert.deepEqual(groupSegment(items([300, 300, 300]), 0, 2, 800), [2]);
  // A small remainder before a stage end cannot override the closest or
  // tied-earlier boundary: the stage may end with a short reading.
  assert.deepEqual(groupSegment(items([800, 150]), 0, 2, 800), [1, 2]);
  assert.deepEqual(groupSegment(items([700, 100, 100]), 0, 3, 800), [2, 3]);
  assert.deepEqual(groupSegment(items([700, 200, 50]), 0, 3, 800), [1, 3]);
  assert.equal(TARGET_WORDS, 800);
});

const chapter = (verses: number, sections: number[] = []) => ({
  passages: [
    {
      verses: Array.from({ length: verses }, (_, i) => ({
        number: i + 1,
        text: "كلمة كلمة",
      })),
    },
  ],
  structure: sections.map((verse) => ({
    kind: "heading",
    marker: "s1",
    text: "عنوان",
    verse,
    offset: 0,
  })),
});
const occurrence = (
  id: string,
  group: number,
  usfm: string,
  ch: number,
  from: number,
  to: number,
) => ({ id, group, usfm, chapter: ch, from, to });

test("Source day/group boundaries are not breaks; chapter ends and sections are", () => {
  const chapters: Record<string, ReturnType<typeof chapter>> = {
    "A:1": chapter(10, [6]),
    "A:2": chapter(10),
    "B:1": chapter(20),
  };
  const sequence = verseSequence(
    [
      // Group 1 ends mid-chapter at A 2:4; group 2 continues at A 2:5.
      occurrence("g001-1", 1, "A", 1, 1, 10),
      occurrence("g001-2", 1, "A", 2, 1, 4),
      occurrence("g002-1", 2, "A", 2, 5, 8),
      // After A 2:8 (not a chapter end), B 1:5 begins mid-chapter.
      occurrence("g002-2", 2, "B", 1, 5, 9),
      // After the chapter end A 1:10, B 1:12 may begin a reading.
      occurrence("g003-1", 3, "A", 1, 10, 10),
      occurrence("g003-2", 3, "B", 1, 12, 13),
    ],
    (usfm: string, ch: number) => chapters[`${usfm}:${ch}`],
  );
  const natural = sequence
    .filter((item: { natural: boolean }) => item.natural)
    .map(
      (item: {
        occurrence: { usfm: string; chapter: number };
        verse: number;
      }) => `${item.occurrence.usfm} ${item.occurrence.chapter}:${item.verse}`,
    );
  assert.deepEqual(natural, ["A 1:1", "A 1:6", "A 2:1", "B 1:12"]);
});

test("No real reading starts at a bare source-group boundary", () => {
  const canonical = new Map(
    readBibleChapters(root).map((c: BibleChapter) => [
      `${c.usfm}:${c.chapter}`,
      c,
    ]),
  );
  const forced = new Set(
    [ot, nt].flatMap((p) =>
      p.catalog.stages.flatMap((s) =>
        (s.substages ?? [s]).map(
          (sub) =>
            p.catalog.readings.find((r) =>
              s.substages ? r.substageId === sub.id : r.stageId === s.id,
            )!.id,
        ),
      ),
    ),
  );
  for (const p of [ot, nt])
    p.definitions.forEach((d, i) => {
      if (forced.has(d.id)) return;
      const first = d.passages[0];
      const before = p.definitions[i - 1].passages.at(-1)!;
      const previous = canonical.get(`${before.usfm}:${before.chapter}`)!;
      const own = canonical.get(`${first.usfm}:${first.chapter}`)!;
      const section = own.structure.some(
        (b) =>
          (b.kind === "heading" || b.kind === "acrostic") &&
          b.offset === 0 &&
          b.verse === first.from,
      );
      assert.ok(
        first.from === 1 || before.to === previous.verseCount || section,
        `${d.id} starts at an artificial boundary`,
      );
    });
  // Genesis 28:1-5 (group 9) and 28:6-22 (group 10) read continuously.
  assert.ok(!ot.catalog.readings.some((r) => r.id === "gen-28-6"));
});

test("Titles summarize books and chapters in Arabic numerals", () => {
  assert.equal(
    readingTitle([
      { usfm: "GEN", chapter: 10, from: 1, to: 5 },
      { usfm: "1CH", chapter: 1, from: 5, to: 7 },
      { usfm: "GEN", chapter: 10, from: 6, to: 32 },
      { usfm: "GEN", chapter: 11, from: 1, to: 26 },
    ]),
    "التكوين ١٠، ١١: ١–٢٦؛ أخبار الأيام الأول ١: ٥–٧",
  );
  assert.equal(
    readingTitle([{ usfm: "PSA", chapter: 119, from: 1, to: 88 }]),
    "المزامير ١١٩: ١–٨٨",
  );
  // Disjoint ranges are listed exactly, never as one span with unread verses.
  assert.equal(
    readingTitle([
      { usfm: "1SA", chapter: 13, from: 1, to: 5 },
      { usfm: "1SA", chapter: 13, from: 19, to: 23 },
      { usfm: "GEN", chapter: 11, from: 32, to: 32 },
      { usfm: "GEN", chapter: 11, from: 27, to: 30 },
    ]),
    "صموئيل الأول ١٣: ١–٥، ١٣: ١٩–٢٣؛ التكوين ١١: ٢٧–٣٠، ١١: ٣٢",
  );
  assert.equal(
    readingTitle([
      { usfm: "PSA", chapter: 116, from: 1, to: 19 },
      { usfm: "PSA", chapter: 117, from: 1, to: 2 },
      { usfm: "PSA", chapter: 118, from: 1, to: 29 },
      { usfm: "PSA", chapter: 119, from: 1, to: 64 },
    ]),
    "المزامير ١١٦–١١٨، ١١٩: ١–٦٤",
  );
});

test("The audit reports invalid references and omissions without fixing them", () => {
  const audit = auditOccurrences(
    [
      { id: "a", usfm: "JUD", chapter: 1, from: 1, to: 26 },
      { id: "b", usfm: "JUD", chapter: 1, from: 20, to: 25 },
    ],
    "NT",
  );
  assert.equal(audit.invalid, "JUD 1:26");
  assert.deepEqual(audit.duplicates, [
    { occurrences: ["a", "b"], verses: "JUD 1:20-25" },
  ]);
  assert.ok(audit.omissions.includes("MAT 1:1-25"));
});
