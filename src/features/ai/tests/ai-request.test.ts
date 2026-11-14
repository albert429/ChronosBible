// The AI card's request control (src/features/ai/request.ts) and session
// guards (guards.ts), driven without React: a fake request module, an
// in-memory storage and a manual clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerKey, readAnswer, saveAnswer, usage } from "../cache.ts";
import { PROMPT_VERSION } from "../domain/chips.ts";
import { MAX_TEXT } from "../domain/text.ts";
import { createGuards } from "../guards.ts";
import { reportMailto } from "../report.ts";
import { startAnswer, type AnswerDeps, type View } from "../request.ts";
import { AiError, type AiMeta, type StreamCallbacks } from "../domain/types.ts";

const DATE = "2026-11-01";
const tick = () => new Promise((resolve) => setTimeout(resolve));
function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

type Script = (
  signal: AbortSignal,
  callbacks: StreamCallbacks,
  send: () => void,
) => Promise<AiMeta>;

/** One answer with fakes; `script` plays the provider's part. */
function harness(
  script: Script,
  {
    clock = { now: 0 },
    guards = createGuards({
      dailyCap: 2,
      attemptCap: 5,
      now: () => clock.now,
    }),
    storage = memory(),
    load,
  }: {
    clock?: { now: number };
    guards?: ReturnType<typeof createGuards>;
    storage?: ReturnType<typeof memory>;
    load?: AnswerDeps["load"];
  } = {},
) {
  const views: View[] = [];
  const statuses: string[] = [];
  const answered: number[] = [];
  let loads = 0;
  let runs = 0;
  let current: View = { s: "idle" };
  const frames: (() => void)[] = [];
  const deps: AnswerDeps = {
    storage,
    guards,
    date: DATE,
    load:
      load ??
      (async () => {
        loads += 1;
        return {
          // As run.ts does: an already-stopped request sends nothing.
          ask: async (_input, signal, callbacks, onSend) => {
            if (signal.aborted) throw new AiError("aborted");
            return script(signal, callbacks, () => onSend?.());
          },
        };
      }),
    frame: (callback) => frames.push(callback),
    cancelFrame: () => {},
  };
  const start = (
    chip: "explain" | "words" | "ask" = "explain",
    options: { fresh?: boolean; question?: string } = {},
  ) =>
    startAnswer(
      {
        chip,
        id: "JHN.1.1",
        question: options.question ?? "",
        fresh: options.fresh,
        n: ++runs,
      },
      deps,
      {
        view(next) {
          current = typeof next === "function" ? next(current) : next;
          views.push(current);
        },
        status: (text) => statuses.push(text),
        answered: (n) => answered.push(n),
      },
    );
  return {
    start,
    views,
    statuses,
    answered,
    storage,
    guards,
    clock,
    loads: () => loads,
    last: () => current,
    flushFrames: () => frames.splice(0).forEach((f) => f()),
  };
}

const meta = (finish: "stop" | "length" = "stop"): AiMeta => ({
  provider: "openrouter",
  model: "google/gemma",
  finish,
});

test("an answer counts one attempt when sent and one answer at its first visible text, then is cached", async () => {
  const h = harness(async (_signal, { onText, onMeta }, send) => {
    send();
    onText("<think>hidden</think>");
    onMeta?.("google/gemma");
    onText("الكلمة ");
    onText("هو المسيح.");
    return meta();
  });
  const started = h.start();
  assert.ok(started);
  assert.deepEqual(h.last(), {
    s: "loading",
    chip: "explain",
    thinking: false,
  });
  await started.done;
  assert.deepEqual(h.answered, [0], "hidden reasoning spends nothing");
  assert.deepEqual(usage(h.storage, DATE), { date: DATE, n: 0, a: 0 });
  assert.deepEqual(h.last(), {
    s: "done",
    chip: "explain",
    text: "الكلمة هو المسيح.",
    model: "google/gemma",
    truncated: false,
  });
  assert.equal(h.statuses.at(-1), "اكتملت الإجابة: اشرح الآية");
  // The same chip again is served from the cache: no request, no counts.
  assert.equal(h.start(), undefined);
  assert.equal(h.loads(), 1);
  assert.equal(h.last().s, "done");
  assert.deepEqual(usage(h.storage, DATE), { date: DATE, n: 0, a: 0 });
});

test("a fresh request skips the cache; a typed question is never cached", async () => {
  const h = harness(async (_s, { onText }, send) => {
    send();
    onText("جواب");
    return meta();
  });
  saveAnswer(
    h.storage,
    answerKey("JHN.1.1", "explain", PROMPT_VERSION),
    { text: "قديم", model: "m" },
    PROMPT_VERSION,
  );
  await h.start("explain", { fresh: true })!.done;
  assert.equal(
    readAnswer(h.storage, answerKey("JHN.1.1", "explain", PROMPT_VERSION))
      ?.text,
    "جواب",
  );
  await h.start("ask", { question: "من هو الكلمة؟" })!.done;
  assert.equal(h.statuses.at(-1), "اكتملت الإجابة عن سؤالك");
  assert.equal(h.loads(), 2);
});

test("Stop is immediate while the request module or study files load, and spends nothing", async () => {
  let release!: () => void;
  const h = harness(async () => meta(), {
    load: () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            ask: async (_i, _s, _c, onSend) => (onSend?.(), meta()),
          });
      }),
  });
  const started = h.start()!;
  started.controller.abort("stop");
  await started.done;
  assert.deepEqual(h.last(), { s: "idle" });
  assert.equal(h.statuses.at(-1), "أُوقفت الإجابة.");
  release();
  await tick();
  assert.deepEqual(usage(h.storage, DATE), { date: DATE, n: 0, a: 0 });
  // A stop is not a failure: no cooldown follows.
  assert.equal(h.guards.remaining(), 0);
});

test("Stop after text keeps the partial answer for retry; unmount stays silent", async () => {
  const stopped = () =>
    harness(async (signal, { onText }, send) => {
      send();
      onText("بداية الجواب");
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () =>
          reject(new AiError("aborted", true)),
        ),
      );
    });
  const h = stopped();
  const run = h.start()!;
  await tick();
  run.controller.abort("stop");
  await run.done;
  assert.deepEqual(h.last(), {
    s: "error",
    chip: "explain",
    problem: "stopped",
    partial: "بداية الجواب",
    model: undefined,
    n: 1,
  });
  assert.deepEqual(h.answered, [0], "the text reached the reader");

  const gone = stopped();
  const left = gone.start()!;
  await tick();
  const before = gone.views.length;
  left.controller.abort("unmount");
  await left.done;
  assert.equal(gone.views.length, before, "no update after unmount");
});

test("An over-long answer is cut at the card's limit without caching a truncated answer", async () => {
  const h = harness(async (signal, { onText }, send) => {
    send();
    onText("ا".repeat(MAX_TEXT));
    onText("ب".repeat(10));
    assert.equal(signal.reason, "truncated");
    throw new AiError("aborted", true);
  });
  await h.start()!.done;
  const done = h.last();
  assert.equal(done.s, "done");
  assert.equal(done.s === "done" && done.truncated, true);
  assert.equal(done.s === "done" && done.text.length, MAX_TEXT);
  assert.equal(
    readAnswer(h.storage, answerKey("JHN.1.1", "explain", PROMPT_VERSION))
      ?.truncated,
    undefined,
  );
  // A provider that stops for length is truncated too.
  const length = harness(async (_s, { onText }, send) => {
    send();
    onText("نص");
    return meta("length");
  });
  await length.start()!.done;
  assert.equal((length.last() as Extract<View, { s: "done" }>).truncated, true);
});

test("Streaming text is shown once per frame", async () => {
  let resolve!: (meta: AiMeta) => void;
  const h = harness((_s, { onText }, send) => {
    send();
    onText("أ");
    onText("ب");
    return new Promise((r) => (resolve = r));
  });
  const run = h.start()!;
  await tick();
  assert.equal(h.last().s, "loading");
  h.flushFrames();
  assert.deepEqual(h.last(), {
    s: "streaming",
    chip: "explain",
    text: "أب",
    model: undefined,
  });
  resolve(meta());
  await run.done;
  assert.equal(h.last().s, "done");
});

test("A failure with partial text keeps it and sets no cooldown", async () => {
  const h = harness(async (_s, { onText }, send) => {
    send();
    onText("نصف");
    throw new AiError("server", true, { model: "x/y" });
  });
  await h.start()!.done;
  assert.deepEqual(h.last(), {
    s: "error",
    chip: "explain",
    problem: "server",
    partial: "نصف",
    model: "x/y",
    n: 1,
  });
  assert.equal(h.guards.remaining(), 0);
});

test("Failures without text cool down, escalate and reset after an answer", async () => {
  const clock = { now: 1_000_000 };
  let fail = true;
  const h = harness(
    async (_s, { onText }, send) => {
      send();
      if (fail) throw new AiError("network");
      onText("تم");
      return meta();
    },
    { clock },
  );
  await h.start("explain", { fresh: true })!.done;
  assert.equal((h.last() as Extract<View, { s: "error" }>).problem, "network");
  assert.equal(h.guards.remaining(), 5000);
  // While cooling, a new request is refused without loading anything.
  assert.equal(h.start("explain", { fresh: true }), undefined);
  assert.equal((h.last() as Extract<View, { s: "error" }>).problem, "rate");
  clock.now += 5000;
  await h.start("explain", { fresh: true })!.done;
  assert.equal(h.guards.remaining(), 15000, "the second failure waits longer");
  clock.now += 15000;
  fail = false;
  await h.start("explain", { fresh: true })!.done;
  assert.equal(h.last().s, "done");
  fail = true;
  await h.start("explain", { fresh: true })!.done;
  assert.equal(h.guards.remaining(), 5000, "an answer resets the escalation");
});

test("An empty answer is an error with a cooldown and spends no answer", async () => {
  const h = harness(async (_s, { onText }, send) => {
    send();
    onText("<think>only reasoning");
    return meta();
  });
  await h.start()!.done;
  assert.equal((h.last() as Extract<View, { s: "error" }>).problem, "empty");
  assert.deepEqual(usage(h.storage, DATE), { date: DATE, n: 0, a: 0 });
  assert.equal(h.guards.remaining(), 5000);
});

test("Rate limits wait for the service's reset, bounded to 30-65 seconds", async () => {
  for (const [retryAt, wait] of [
    [undefined, 30000],
    [40000, 40000],
    [600000, 65000],
  ] as const) {
    const h = harness(async (_s, _c, send) => {
      send();
      throw new AiError("rate", false, { retryAt });
    });
    await h.start()!.done;
    assert.equal(h.guards.remaining(), wait, String(retryAt));
  }
});

test("Local counters and previous quota errors cannot refuse a server cache hit", () => {
  const guards = createGuards({ dailyCap: 1, attemptCap: 1 });
  const storage = memory();
  storage.setItem(
    "nt-ai-usage-v1",
    JSON.stringify({ date: DATE, n: 999, a: 999 }),
  );
  guards.backOff("quota");
  assert.equal(guards.refusal(storage, DATE), undefined);
});

test("The error report carries the request, a safe model name and a clipped answer", () => {
  const link = reportMailto({
    email: "team@example.org",
    reference: "يوحنا 1:1",
    asking: "اشرح الآية",
    model: "<script>",
    text: "أ".repeat(2000) + "\uD800",
  });
  assert.ok(link.startsWith("mailto:team@example.org?subject="));
  const body = decodeURIComponent(link.split("&body=")[1]);
  const lines = body.split("\n");
  assert.deepEqual(lines.slice(0, 5), [
    "المرجع: يوحنا 1:1",
    "الطلب: اشرح الآية",
    "النموذج: نموذج غير معروف",
    `إصدار الطلب: ${PROMPT_VERSION}`,
    "",
  ]);
  assert.equal(lines[5].length, 1500);
  // A surrogate pair cut in two never reaches encodeURIComponent.
  assert.doesNotThrow(() =>
    reportMailto({
      email: "a@b.c",
      reference: "x",
      text: "😀".repeat(800),
    }),
  );
});
