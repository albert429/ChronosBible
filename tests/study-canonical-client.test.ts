import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  decodeStudyWords,
  UNSUPPORTED_WORDS,
} from "../src/study/decodeWords.ts";
import type { WordToken } from "../src/study/types.ts";

const requests: string[] = [];
const files: Record<string, unknown> = {};
const failures = new Set<string>();
globalThis.fetch = async (url: RequestInfo | URL) => {
  const path = String(url);
  requests.push(path);
  if (failures.has(path)) return new Response("down", { status: 503 });
  if (!(path in files)) return new Response("missing", { status: 404 });
  return path.endsWith(".gz")
    ? new Response(gzipSync(JSON.stringify(files[path])))
    : Response.json(files[path]);
};
const {
  studyChapter,
  studyWords,
  studyTranslations,
  studyLexicon,
  verseWords,
  verseTranslations,
  wordDefinitions,
  studyReference,
} = await import("../src/study/canonicalClient.ts");
const word: WordToken = [
  "בָּרָא",
  "bara",
  "H1254A",
  "HVqp3ms",
  "create",
  2,
  2,
  "he",
];
function chapter(book: string, chapter = 1) {
  const path = `/study/v2/${book}/${chapter}`;
  files[`${path}/index.json`] = {
    v: 2,
    book,
    chapter,
    ranges: [
      { start: 1, end: 2, key: "1-2" },
      { start: 3, end: 4, key: "3-4" },
    ],
  };
  for (const [start, end] of [
    [1, 2],
    [3, 4],
  ]) {
    const header = { v: 2, book, chapter, start, end };
    files[`${path}/${start}-${end}.words.json.gz`] = {
      ...header,
      verses: { [start]: { w: [word] } },
    };
    files[`${path}/${start}-${end}.tr.json`] = {
      ...header,
      verses: { [start]: { n: "في البدء", e: "In the beginning" } },
    };
  }
  return path;
}

test("canonical sections are independent and verses share only their chapter/range resources", async () => {
  const path = chapter("GEN");
  requests.length = 0;
  const [first, second] = await Promise.all([
    verseTranslations.load("GEN.1.1"),
    verseTranslations.load("GEN.1.2"),
  ]);
  assert.equal(first, second);
  assert.deepEqual(requests, [`${path}/index.json`, `${path}/1-2.tr.json`]);
  assert.equal(verseWords.peek("GEN.1.1"), undefined);
  await verseWords.load("GEN.1.1");
  assert.equal(verseWords.peek("GEN.1.2")?.verses["1"].w[0][7], "he");
  await verseWords.load("GEN.1.3");
  assert.equal(requests.at(-1), `${path}/3-4.words.json.gz`);
  assert.equal(requests.filter((p) => p.endsWith("index.json")).length, 1);
});

test("a failed word file does not block translations and can be retried", async () => {
  const path = chapter("EXO");
  const words = `${path}/1-2.words.json.gz`;
  failures.add(words);
  await assert.rejects(verseWords.load("EXO.1.1"), /تعذر تحميل/);
  assert.equal(verseWords.peek("EXO.1.1"), undefined);
  assert.equal(
    (await verseTranslations.load("EXO.1.1")).verses["1"].e,
    "In the beginning",
  );
  failures.delete(words);
  assert.deepEqual((await verseWords.load("EXO.1.1")).verses["1"].w, [word]);
});

test("wrong identity, broken ranges, invalid spans and stale schemas are rejected", async () => {
  const path = chapter("LEV");
  const index = files[`${path}/index.json`];
  for (const invalid of [
    { v: 1, book: "LEV", chapter: 1, ranges: [] },
    { v: 2, book: "GEN", chapter: 1, ranges: [] },
    {
      v: 2,
      book: "LEV",
      chapter: 1,
      ranges: [{ start: 1, end: 2, key: "../../x" }],
    },
    {
      v: 2,
      book: "LEV",
      chapter: 1,
      ranges: [{ start: 2, end: 4, key: "2-4" }],
    },
  ]) {
    files[`${path}/index.json`] = invalid;
    await assert.rejects(studyChapter.load("LEV/1"));
  }
  files[`${path}/index.json`] = index;
  const original = files[`${path}/1-2.words.json.gz`];
  for (const invalid of [
    { v: 2, book: "GEN", chapter: 1, start: 1, end: 2, verses: {} },
    {
      v: 2,
      book: "LEV",
      chapter: 1,
      start: 1,
      end: 2,
      verses: { 3: { w: [word] } },
    },
    {
      v: 2,
      book: "LEV",
      chapter: 1,
      start: 1,
      end: 2,
      verses: { 1: { w: [[...word.slice(0, 5), 3, 2, "he"]] } },
    },
    {
      v: 2,
      book: "LEV",
      chapter: 1,
      start: 1,
      end: 2,
      verses: { 1: { w: [[...word.slice(0, 7), "unknown"]] } },
    },
  ]) {
    files[`${path}/1-2.words.json.gz`] = invalid;
    await assert.rejects(studyWords.load("LEV/1/1-2"));
  }
  files[`${path}/1-2.words.json.gz`] = original;
  await studyWords.load("LEV/1/1-2");
  files[`${path}/1-2.tr.json`] = {
    v: 2,
    book: "LEV",
    chapter: 1,
    start: 1,
    end: 2,
    verses: { 1: { e: { b: "1-2", t: 4 } } },
  };
  await assert.rejects(studyTranslations.load("LEV/1/1-2"));
  for (const id of ["GEN.1.0", "GEN.01.1", "../1/2", "GEN.1.1.extra"])
    assert.throws(() => studyReference(id));
});

test("lexicon shards deduplicate and validate shard identity", async () => {
  files["/study/v2/lex/H12.json"] = {
    v: 2,
    shard: "H12",
    lex: { H1254A: { l: "בָּרָא", g: "create", d: "" } },
  };
  requests.length = 0;
  const definitions = await wordDefinitions([word, word]);
  assert.equal(definitions.H1254A.g, "create");
  assert.deepEqual(requests, ["/study/v2/lex/H12.json"]);
  files["/study/v2/lex/H13.json"] = { v: 2, shard: "H12", lex: {} };
  await assert.rejects(studyLexicon.load("H13"));
});

test("gzip transport supports compressed and host-decoded responses", async () => {
  const data = { verses: { 1: { w: [word] } } };
  assert.deepEqual(
    await decodeStudyWords(new Response(gzipSync(JSON.stringify(data)))),
    data,
  );
  assert.deepEqual(await decodeStudyWords(Response.json(data)), data);
  await assert.rejects(
    decodeStudyWords(new Response(new Uint8Array([31, 139, 1, 2, 3]))),
  );
  await assert.rejects(
    decodeStudyWords(new Response(gzipSync("x".repeat(256 * 1024 + 1)))),
    /size limit/,
  );
  await assert.rejects(
    decodeStudyWords(new Response("x".repeat(256 * 1024 + 1))),
    /size limit/,
  );
  const gzip = new Uint8Array(30001);
  gzip[0] = 31;
  gzip[1] = 139;
  await assert.rejects(
    decodeStudyWords(new Response(gzip)),
    /Compressed.*size limit/,
  );
});

test("an older browser gets an explicit word error while decoded JSON remains usable", async () => {
  const native = globalThis.DecompressionStream;
  try {
    Object.defineProperty(globalThis, "DecompressionStream", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    await assert.rejects(decodeStudyWords(new Response(gzipSync("{}"))), {
      message: UNSUPPORTED_WORDS,
    });
    assert.deepEqual(await decodeStudyWords(Response.json({ ok: true })), {
      ok: true,
    });
  } finally {
    globalThis.DecompressionStream = native;
  }
});

test("retry refreshes a stale index after a publication changes range boundaries", async () => {
  const path = chapter("NUM");
  await studyChapter.load("NUM/1");
  failures.add(`${path}/1-2.words.json.gz`);
  await assert.rejects(verseWords.load("NUM.1.1"));
  assert.equal(studyChapter.peek("NUM/1"), undefined);
  files[`${path}/index.json`] = {
    v: 2,
    book: "NUM",
    chapter: 1,
    ranges: [{ start: 1, end: 4, key: "1-4" }],
  };
  files[`${path}/1-4.words.json.gz`] = {
    v: 2,
    book: "NUM",
    chapter: 1,
    start: 1,
    end: 4,
    verses: { 1: { w: [word] } },
  };
  requests.length = 0;
  assert.deepEqual((await verseWords.load("NUM.1.1")).verses["1"].w, [word]);
  assert.deepEqual(requests, [
    `${path}/index.json`,
    `${path}/1-4.words.json.gz`,
  ]);
});
