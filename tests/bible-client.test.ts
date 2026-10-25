import assert from "node:assert/strict";
import { test } from "node:test";
import { createBibleClient, validBibleChapter } from "../src/bible/client.ts";
import type { BibleChapter } from "../src/bible/types.ts";

const location = { mode: "bible" as const, book: "GEN", chapter: 1 };
const key = "bible:GEN:1";
const chapter = (): BibleChapter => ({
  mode: "bible",
  usfm: "GEN",
  book: "التكوين",
  chapter: 1,
  verseCount: 31,
  passages: [
    {
      book: "التكوين",
      chapter: 1,
      start: 1,
      end: 31,
      verses: Array.from({ length: 31 }, (_, i) => ({
        number: i + 1,
        text: "نص",
      })),
    },
  ],
  structure: [
    { kind: "heading", marker: "s1", text: "البدء", verse: 1, offset: 0 },
  ],
});

test("Canonical text remains lazy and adjacent prefetch shares one cached request", async () => {
  const urls: string[] = [];
  let resolve: (response: Response) => void = () => {};
  const client = createBibleClient((url) => {
    urls.push(String(url));
    return new Promise((done) => {
      resolve = done;
    });
  });
  assert.deepEqual(urls, []);
  assert.equal(client.peek(key), undefined);
  const warm = client.prefetchChapter(location);
  const foreground = client.load(key);
  await Promise.resolve();
  assert.deepEqual(urls, ["/bible/GEN/1.json"]);
  resolve(Response.json(chapter()));
  await warm;
  assert.deepEqual(await foreground, chapter());
  assert.deepEqual(client.peek(key), chapter());
  await client.load(key);
  assert.equal(urls.length, 1);
});

test("Wrong chapters and malformed metadata fail without poisoning the cache", async () => {
  let body: unknown = { ...chapter(), chapter: 2 };
  let calls = 0;
  const client = createBibleClient(async () => {
    calls++;
    return Response.json(body);
  });
  await assert.rejects(client.load(key), /تعذر تحميل الإصحاح/);
  assert.equal(client.peek(key), undefined);
  body = {
    ...chapter(),
    structure: [
      { kind: "heading", marker: "s1", text: "عنوان", verse: 1, offset: 999 },
    ],
  };
  await assert.rejects(client.load(key), /تعذر تحميل الإصحاح/);
  body = chapter();
  assert.deepEqual(await client.load(key), chapter());
  assert.equal(calls, 3);
});

test("Malformed keys and out-of-range prefetch locations make no network requests", async () => {
  let calls = 0;
  const client = createBibleClient(async () => {
    calls++;
    return Response.json(chapter());
  });
  for (const invalid of [
    "GEN:1",
    "bible:GEN:0",
    "bible:GEN:51",
    "bible:BAD:1",
    "bible:GEN:01",
    "bible:../:1",
  ])
    await assert.rejects(client.load(invalid), /تعذر تحميل الإصحاح/);
  await client.prefetchChapter({ ...location, chapter: 51 });
  await client.prefetchChapter({ ...location, verse: 32 });
  assert.equal(calls, 0);
});

test("Canonical validation rejects missing, duplicate and empty verses and fake day fields", () => {
  assert.equal(validBibleChapter(chapter(), key), true);
  for (const mutate of [
    (c: BibleChapter) => {
      c.passages[0].verses.pop();
    },
    (c: BibleChapter) => {
      c.passages[0].verses[1].number = 1;
    },
    (c: BibleChapter) => {
      c.passages[0].verses[0].text = " ";
    },
    (c: BibleChapter) => {
      c.structure[0].verse = 0;
    },
    (c: BibleChapter) => {
      c.structure[0].text = "";
    },
  ]) {
    const data = chapter();
    mutate(data);
    assert.equal(validBibleChapter(data, key), false);
  }
  assert.equal(validBibleChapter({ ...chapter(), day: 1 }, key), false);
});

test("Failed speculative downloads stay silent and allow a foreground retry", async () => {
  let calls = 0;
  const client = createBibleClient(async () =>
    ++calls === 1
      ? new Response("failed", { status: 503 })
      : Response.json(chapter()),
  );
  await client.prefetchChapter(location);
  assert.equal(client.peek(key), undefined);
  assert.deepEqual(await client.load(key), chapter());
  assert.equal(calls, 2);
});
