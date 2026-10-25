import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readBibleChapters } from "../scripts/build-bible.js";
import { buildChronology } from "../scripts/build-chronology.js";
import { createBibleClient } from "../src/bible/client.ts";
import type {
  BibleChapter,
  ChronologicalLocation,
} from "../src/bible/types.ts";
import {
  adjacentChronologicalLocation,
  chronologicalKeyLocation,
  chronologicalStage,
  chronologicalSummary,
  createChronologyClients,
  firstChronologicalLocation,
  resumeChronologicalLocation,
} from "../src/chronology/client.ts";
import type {
  ChronologicalReading,
  ChronologyCatalog,
} from "../src/chronology/types.ts";
import { isChronologicalReadingData } from "../src/chronology/validate.ts";

const root = new URL("../", import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), "chronology-"));
after(() => rmSync(out, { recursive: true, force: true }));
buildChronology({ out, root });
const chapters = new Map<string, BibleChapter>(
  readBibleChapters(root).map((c: BibleChapter) => [
    `/bible/${c.usfm}/${c.chapter}.json`,
    c,
  ]),
);

/** Serves the built chronology and canonical chapters; records each URL. */
function server(fail: (url: string, attempt: number) => boolean = () => false) {
  const urls: string[] = [];
  const attempts = new Map<string, number>();
  const fetcher = async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const n = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, n);
    if (fail(url, n)) return new Response("down", { status: 503 });
    const chapter = chapters.get(url);
    if (chapter) return Response.json(chapter);
    const match = /^\/chronology\/(.+\.json)$/.exec(url);
    try {
      if (match) return new Response(readFileSync(join(out, match[1])));
    } catch {
      // Missing file: fall through to 404.
    }
    return new Response("missing", { status: 404 });
  };
  const bible = createBibleClient(fetcher as typeof fetch);
  const clients = createChronologyClients(
    fetcher as typeof fetch,
    15000,
    bible,
  );
  return { urls, fetcher: fetcher as typeof fetch, bible, ...clients };
}
const location = (
  readingId: string,
  testament: "OT" | "NT" = "OT",
): ChronologicalLocation => ({
  mode: "chronological",
  testament,
  readingId,
});

test("Nothing loads until asked, and a catalog never downloads Scripture", async () => {
  const s = server();
  assert.deepEqual(s.urls, []);
  const catalog = await s.catalogs.load("OT");
  assert.deepEqual(s.urls, ["/chronology/OT.json"]);
  assert.equal(catalog.testament, "OT");
  assert.equal(s.catalogs.peek("OT"), catalog);
  await assert.rejects(
    s.catalogs.load("XX"),
    /تعذر تحميل فهرس القراءة الزمنية/,
  );
  assert.deepEqual(s.urls, ["/chronology/OT.json"]);
});

test("A reading fetches its definition and only its chapters, once, through the chapter cache", async () => {
  const s = server();
  const key = "chrono:OT:gen-1-1";
  const [a, b] = await Promise.all([
    s.readings.load(key),
    s.readings.load(key),
  ]);
  assert.equal(a, b);
  assert.deepEqual(s.urls, [
    "/chronology/OT/gen-1-1.json",
    "/bible/GEN/1.json",
    "/bible/GEN/2.json",
  ]);
  assert.equal(s.readings.peek(key), a);
  assert.ok(s.bible.peek("bible:GEN:2"));
  await s.readings.load(key);
  assert.equal(s.urls.length, 3);
  // Interleaved passages from the same chapter reuse one request.
  await s.readings.load("chrono:OT:gen-9-1");
  const gen10 = s.urls.filter((u) => u === "/bible/GEN/10.json");
  assert.equal(gen10.length, 1);
});

test("Passages keep exact canonical text, verse numbers and in-range structure", async () => {
  const s = server();
  const reading = await s.readings.load("chrono:OT:gen-1-1");
  assert.equal(reading.mode, "chronological");
  assert.equal(reading.title, "التكوين ١–٢");
  const [first] = reading.passages;
  const canonical = chapters.get("/bible/GEN/1.json")!;
  assert.equal(first.book, "التكوين");
  assert.deepEqual(first.verses, canonical.passages[0].verses);
  assert.deepEqual(first.structure, canonical.structure);
  assert.equal(first.structure![0].text, "البدء");
  assert.equal(first.occurrenceId, "g001-1");
  assert.equal(first.provenance?.group, "1");
  // Psalm 119, split at an acrostic, keeps only its own stanzas' blocks.
  const catalog = await s.catalogs.load("OT");
  const part = catalog.readings.find((r) =>
    r.title.startsWith("المزامير ١١٩:"),
  )!;
  assert.equal(part.id, "psa-119-65");
  const second = await s.readings.load(`chrono:OT:${part.id}`);
  const psalm = second.passages[0];
  assert.ok(psalm.start > 1);
  assert.equal(psalm.verses[0].number, psalm.start);
  assert.ok(psalm.structure!.length > 0);
  assert.ok(
    psalm.structure!.every(
      (b) => b.verse >= psalm.start && b.verse <= psalm.end,
    ),
  );
  assert.equal(psalm.structure![0].kind, "acrostic");
  assert.equal(psalm.structure![0].verse, psalm.start);
});

test("Failures are not cached: a retry refetches only what failed", async () => {
  const s = server(
    (url, attempt) => url === "/bible/GEN/2.json" && attempt === 1,
  );
  const key = "chrono:OT:gen-1-1";
  await assert.rejects(s.readings.load(key), /تعذر تحميل القراءة/);
  assert.equal(s.readings.peek(key), undefined);
  const reading = await s.readings.load(key);
  assert.equal(reading.verseCount, 31 + 25);
  const count = (url: string) => s.urls.filter((u) => u === url).length;
  assert.equal(count("/chronology/OT/gen-1-1.json"), 1);
  assert.equal(count("/bible/GEN/1.json"), 1);
  assert.equal(count("/bible/GEN/2.json"), 2);
});

test("Unknown or malformed ids reject with an Arabic message; prefetch stays silent", async () => {
  const s = server();
  await assert.rejects(s.readings.load("chrono:OT:no-such-reading"), /تعذر/);
  await assert.rejects(s.readings.load("chrono:NT:gen-1-1"), /تعذر/);
  const before = s.urls.length;
  await assert.rejects(s.readings.load("chrono:OT:../OT"), /تعذر/);
  await assert.rejects(s.readings.load("plan:1"), /تعذر/);
  assert.equal(s.urls.length, before);
  await s.readings.prefetchReading(location("missing-id"));
  assert.equal(
    chronologicalKeyLocation("chrono:NT:mat-1-1")?.readingId,
    "mat-1-1",
  );
  assert.equal(chronologicalKeyLocation("chrono:OT:Bad"), undefined);
});

test("Corrupt definitions or chapters are rejected", async () => {
  const s = server();
  const badDefinition = createChronologyClients(
    (async () => Response.json({ id: "gen-1-1" })) as typeof fetch,
    15000,
    s.bible,
  );
  await assert.rejects(
    badDefinition.readings.load("chrono:OT:gen-1-1"),
    /تعذر/,
  );
  const badChapters = createChronologyClients(
    s.fetcher,
    15000,
    createBibleClient((async () =>
      Response.json({ mode: "bible" })) as typeof fetch),
  );
  await assert.rejects(badChapters.readings.load("chrono:OT:gen-1-1"), /تعذر/);
  assert.equal(badChapters.readings.peek("chrono:OT:gen-1-1"), undefined);
});

test("Every reading assembles to valid Scripture matching its definition", async () => {
  const s = server();
  for (const testament of ["OT", "NT"] as const) {
    const catalog: ChronologyCatalog = await s.catalogs.load(testament);
    for (const summary of catalog.readings) {
      const reading: ChronologicalReading = await s.readings.load(
        `chrono:${testament}:${summary.id}`,
      );
      assert.ok(isChronologicalReadingData(reading, testament, summary.id));
      assert.equal(reading.verseCount, summary.verseCount);
      assert.equal(reading.stageId, summary.stageId);
      for (const p of reading.passages) {
        assert.deepEqual(
          p.verses.map((v) => v.number),
          Array.from({ length: p.end - p.start + 1 }, (_, i) => p.start + i),
        );
        for (const block of p.structure ?? []) {
          const verse = p.verses[block.verse - p.start];
          assert.ok(verse);
          assert.ok(block.offset <= Array.from(verse.text).length);
        }
      }
    }
  }
});

test("Pure navigation over a catalog: first, adjacent, resume and stage", async () => {
  const s = server();
  const catalog = await s.catalogs.load("NT");
  const first = firstChronologicalLocation(catalog);
  assert.deepEqual(first, location("mrk-1-1", "NT"));
  assert.equal(adjacentChronologicalLocation(catalog, first, -1), undefined);
  const next = adjacentChronologicalLocation(
    catalog,
    { ...first, verse: 3 },
    1,
  );
  assert.deepEqual(next, location(catalog.readings[1].id, "NT"));
  const last = location(catalog.readings.at(-1)!.id, "NT");
  assert.equal(adjacentChronologicalLocation(catalog, last, 1), undefined);
  assert.equal(
    adjacentChronologicalLocation(catalog, location("mrk-1-1", "OT"), 1),
    undefined,
  );
  assert.equal(
    adjacentChronologicalLocation(catalog, location("gone", "NT"), 1),
    undefined,
  );
  assert.deepEqual(resumeChronologicalLocation(catalog), first);
  assert.deepEqual(
    resumeChronologicalLocation(catalog, location("gone", "NT")),
    first,
  );
  const saved = { ...location("act-13-1", "NT"), verse: 4 };
  assert.deepEqual(resumeChronologicalLocation(catalog, saved), saved);
  assert.equal(
    chronologicalSummary(catalog, "act-13-1")?.stageId,
    "missionary-journeys",
  );
  const stage = chronologicalStage(catalog, "act-13-1")!;
  assert.equal(stage.stage.title, "رحلات بولس التبشيرية");
  assert.equal(stage.substage?.title, "الرحلة التبشيرية الأولى");
  assert.equal(chronologicalStage(catalog, "jas-1-1")?.substage, undefined);
});
