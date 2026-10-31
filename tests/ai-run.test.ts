// The request path in src/ai/run.ts, with fetch stubbed. Each test file runs
// in its own process, so the globals set here stay local.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import type { AiBuildConfig } from "../src/ai/config.ts";
import type { AskInput } from "../src/ai/run.ts";
import type { AiError, ChipId } from "../src/ai/types.ts";
import type { Verse } from "../src/plan/readings.ts";

const requests: string[] = [];
const pending: (() => void)[] = [];
const range = (book: string, chapter: number, end: number) => ({
  v: 2,
  book,
  chapter,
  start: 1,
  end,
});
const study: Record<string, unknown> = {
  "v2/MAT/8/index.json": {
    v: 2,
    book: "MAT",
    chapter: 8,
    ranges: [{ start: 1, end: 34, key: "1-34" }],
  },
  "v2/MAT/8/1-34.tr.json": {
    ...range("MAT", 8, 34),
    verses: { 15: { e: "And he touched her hand" } },
  },
  "v2/MAT/8/1-34.words.json.gz": {
    ...range("MAT", 8, 34),
    verses: {
      15: {
        w: [
          ["ἥψατο", "hēpsato", "G0681", "V-AMI-3S", "to kindle", 0, 0, "grc"],
        ],
      },
    },
  },
  "v2/lex/G06.json": {
    v: 2,
    shard: "G06",
    lex: { G0681: { l: "ἅπτω", g: "to touch", d: "" } },
  },
  "v2/MAT/9/index.json": {
    v: 2,
    book: "MAT",
    chapter: 9,
    ranges: [{ start: 1, end: 38, key: "1-38" }],
  },
  "v2/MAT/9/1-38.tr.json": { ...range("MAT", 9, 38), verses: {} },
};
globalThis.fetch = async (url: RequestInfo | URL, init: RequestInit = {}) => {
  const path = String(url);
  requests.push(path);
  if (path.endsWith("/chat/completions")) {
    const body = JSON.parse(String(init.body));
    requests.push(body.messages[1].content);
    return new Response(
      'data: {"model":"m:free","choices":[{"delta":{"content":"جواب"}}]}\n\n' +
        'data: {"model":"m:free","choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  }
  const name = path.split("/study/")[1];
  if (name?.startsWith("v2/MAT/12/")) {
    // A study file that never arrives (until the test releases it).
    return new Promise((resolve) =>
      pending.push(() => resolve(new Response("{}", { status: 404 }))),
    );
  }
  return study[name]
    ? Response.json(study[name])
    : new Response("{}", { status: 404 });
};
const aiConfig = {
  providers: [
    {
      id: "openrouter",
      apiKey: "sk-or-v1-test",
      models: ["openrouter/free"],
      baseUrl: "https://openrouter.test/api/v1",
    },
  ],
  dailyCap: 10,
  attemptCap: 20,
} satisfies AiBuildConfig;
Object.assign(globalThis, {
  location: { origin: "https://app.test" },
  __AI_CONFIG__: aiConfig,
});

const { ask } = await import("../src/ai/run.ts");
const { abortable } = await import("../src/ai/types.ts");

const verse: Verse = { number: 15, text: "فلمس يدها" };
const input = (chip: ChipId, chapter = 8): AskInput => ({
  chip,
  id: `MAT.${chapter}.15`,
  material: {
    book: "متى",
    passage: { book: "متى", chapter, start: 15, end: 15, verses: [verse] },
    verse,
  },
  question: chip === "ask" ? "ما معنى لمس؟" : "",
});
const quiet = { onText() {} };

test("A typed question loads the lexicon, so the Greek meaning is the lexicon's", async () => {
  requests.length = 0;
  let sent = 0;
  await ask(input("ask"), new AbortController().signal, quiet, () => sent++);
  assert.ok(requests.includes("/study/v2/MAT/8/1-34.words.json.gz"));
  assert.ok(requests.includes("/study/v2/lex/G06.json"));
  const prompt = requests.find((r) => r.startsWith("المرجع"));
  assert.ok(prompt);
  assert.match(prompt, /G0681: to touch/);
  assert.doesNotMatch(prompt, /to kindle/);
  assert.match(prompt, /الترجمة الإنجليزية \(KJV\):\nAnd he touched/);
  assert.equal(sent, 1);
});

test("«اشرح الآية» needs no words or lexicon", async () => {
  requests.length = 0;
  await ask(input("explain", 9), new AbortController().signal, quiet);
  assert.ok(requests.includes("/study/v2/MAT/9/1-38.tr.json"));
  assert.ok(!requests.some((r) => /words\.json|\/lex\//.test(r)));
});

test("Stopping while the study files load ends the request at once and sends nothing", async () => {
  requests.length = 0;
  const controller = new AbortController();
  let sent = 0;
  const run = ask(input("explain", 12), controller.signal, quiet, () => sent++);
  setTimeout(() => controller.abort("stop"), 10);
  const result = await Promise.race([
    run.then(
      () => "resolved",
      (error: AiError) => error.kind,
    ),
    new Promise((resolve) => setTimeout(() => resolve("still waiting"), 500)),
  ]);
  assert.equal(result, "aborted");
  assert.equal(sent, 0);
  assert.ok(!requests.some((r) => r.endsWith("/chat/completions")));
  for (const release of pending.splice(0)) release();
});

test("An already-stopped request fetches nothing; abortable cleans up", async () => {
  requests.length = 0;
  await assert.rejects(ask(input("words"), AbortSignal.abort(), quiet), {
    kind: "aborted",
  });
  assert.ok(!requests.some((r) => r.endsWith("/chat/completions")));
  const controller = new AbortController();
  assert.equal(await abortable(Promise.resolve(1), controller.signal), 1);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("canonical OT questions load Hebrew words and shared lexicon definitions", async () => {
  Object.assign(study, {
    "v2/GEN/1/index.json": {
      v: 2,
      book: "GEN",
      chapter: 1,
      ranges: [{ start: 1, end: 31, key: "1-31" }],
    },
    "v2/GEN/1/1-31.tr.json": {
      v: 2,
      book: "GEN",
      chapter: 1,
      start: 1,
      end: 31,
      verses: { 1: { e: "In the beginning God created" } },
    },
    "v2/GEN/1/1-31.words.json.gz": {
      v: 2,
      book: "GEN",
      chapter: 1,
      start: 1,
      end: 31,
      verses: {
        1: {
          w: [["בָּרָא", "bara", "H1254A", "HVqp3ms", "create", 2, 2, "he"]],
        },
      },
    },
    "v2/lex/H12.json": {
      v: 2,
      shard: "H12",
      lex: { H1254A: { l: "בָּרָא", g: "to create", d: "" } },
    },
  });
  requests.length = 0;
  const verse = { number: 1, text: "في البدء خلق" };
  await ask(
    {
      chip: "words",
      id: "GEN.1.1",
      material: {
        book: "التكوين",
        passage: {
          book: "التكوين",
          chapter: 1,
          start: 1,
          end: 1,
          verses: [verse],
        },
        verse,
      },
    },
    new AbortController().signal,
    quiet,
  );
  assert.ok(requests.includes("/study/v2/GEN/1/1-31.words.json.gz"));
  assert.ok(requests.includes("/study/v2/lex/H12.json"));
  const prompt = requests.find((r) => r.startsWith("المرجع"))!;
  assert.match(prompt, /الكلمات العبرية المهمة/);
  assert.match(prompt, /H1254A: to create/);
  assert.doesNotMatch(prompt, /الكلمات اليونانية/);
  assert.ok(!requests.some((r) => /study\/\d+\./.test(r)));
});
