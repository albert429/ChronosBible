import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyCode,
  MAX_LINE,
  readChatStream,
  retryAtFrom,
} from "../worker/sse.ts";
import { AiError, type AiErrorKind } from "../src/domain/ai/types.ts";

const encoder = new TextEncoder();
const classify = (code: unknown, message?: unknown, metadata?: unknown) =>
  classifyCode(code, message, metadata);
/** A byte stream delivered in the given pieces (strings or byte arrays). */
const stream = (...parts: (string | Uint8Array)[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts)
        controller.enqueue(
          typeof part === "string" ? encoder.encode(part) : part,
        );
      controller.close();
    },
  });
const data = (chunk: unknown) => `data: ${JSON.stringify(chunk)}\n\n`;
const delta = (content: string | null, extra = {}) => ({
  model: "google/gemma-4-31b-it:free",
  choices: [{ index: 0, delta: { content, ...extra }, finish_reason: null }],
});
const finish = (reason = "stop") => ({
  model: "google/gemma-4-31b-it:free",
  choices: [{ index: 0, delta: {}, finish_reason: reason }],
});
function collect() {
  const seen = { text: "", meta: [] as string[], activity: 0 };
  return {
    seen,
    callbacks: {
      onText: (t: string) => (seen.text += t),
      onMeta: (m: string) => seen.meta.push(m),
      onActivity: () => seen.activity++,
    },
  };
}
const fails = async (
  promise: Promise<unknown>,
  kind: AiErrorKind,
  after?: boolean,
) => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AiError);
    assert.equal(error.kind, kind);
    if (after !== undefined) assert.equal(error.afterFirstToken, after);
    return true;
  });
};

test("Streams text across split lines and a UTF-8 character split between chunks", async () => {
  const body =
    ": OPENROUTER PROCESSING\n\n" +
    data(delta("مرحبا ")) +
    data(delta("بكم")) +
    data(finish()) +
    "data: [DONE]\n\n";
  const bytes = encoder.encode(body);
  // Split inside a multi-byte Arabic letter and inside a line.
  const cut = bytes.indexOf(0xd8, 40) + 1;
  const { seen, callbacks } = collect();
  const end = await readChatStream(
    stream(
      bytes.slice(0, cut),
      bytes.slice(cut, cut + 7),
      bytes.slice(cut + 7),
    ),
    callbacks,
  );
  assert.equal(seen.text, "مرحبا بكم");
  assert.deepEqual(seen.meta, ["google/gemma-4-31b-it:free"]);
  assert.equal(seen.activity, 1);
  assert.deepEqual(end, {
    model: "google/gemma-4-31b-it:free",
    finish: "stop",
  });
});

test("Reasoning is never text, only activity; null content is ignored", async () => {
  const { seen, callbacks } = collect();
  await readChatStream(
    stream(
      data(delta(null, { reasoning: "thinking…" })),
      data({
        model: "m/x:free",
        choices: [{ delta: { reasoning_details: [{}] } }],
      }),
      data(delta("نص")),
      data(finish()),
      "data: [DONE]\n\n",
    ),
    callbacks,
  );
  assert.equal(seen.text, "نص");
  assert.equal(seen.activity, 2);
  assert.deepEqual(seen.meta, [
    "google/gemma-4-31b-it:free",
    "m/x:free",
    "google/gemma-4-31b-it:free",
  ]);
});

test("The usage chunk repeats finish_reason harmlessly; length is reported", async () => {
  const { callbacks } = collect();
  const end = await readChatStream(
    stream(
      data(delta("a")),
      data(finish("length")),
      data({ ...finish("length"), usage: { completion_tokens: 9 } }),
      "data: [DONE]\n\n",
    ),
    callbacks,
  );
  assert.equal(end.finish, "length");
});

test("Errors after HTTP 200: before and after text, numeric or string codes", async () => {
  const errorChunk = (code: unknown, message = "x") => ({
    error: { code, message },
    choices: [{ delta: { content: "" }, finish_reason: "error" }],
  });
  await fails(
    readChatStream(stream(data(errorChunk(502))), collect().callbacks),
    "server",
    false,
  );
  await fails(
    readChatStream(
      stream(data(errorChunk("server_error"))),
      collect().callbacks,
    ),
    "server",
    false,
  );
  await fails(
    readChatStream(
      stream(data(errorChunk(429, "Rate limit exceeded: free-models-per-day"))),
      collect().callbacks,
    ),
    "quota",
    false,
  );
  await fails(
    readChatStream(
      stream(data(delta("بعض")), data(errorChunk(502))),
      collect().callbacks,
    ),
    "server",
    true,
  );
  await fails(
    readChatStream(stream(data({ ...finish("error") })), collect().callbacks),
    "server",
    false,
  );
  await fails(
    readChatStream(
      stream(data(delta("x")), data(finish("content_filter"))),
      collect().callbacks,
    ),
    "refused",
    true,
  );
});

test("Empty, cut-off, oversized and malformed streams fail clearly", async () => {
  await fails(
    readChatStream(
      stream(data(finish()), "data: [DONE]\n\n"),
      collect().callbacks,
    ),
    "empty",
    false,
  );
  await fails(
    readChatStream(stream(data(delta("نص"))), collect().callbacks),
    "network",
    true,
  );
  await fails(
    readChatStream(
      stream("data: " + "x".repeat(MAX_LINE + 10)),
      collect().callbacks,
    ),
    "server",
  );
  await fails(
    readChatStream(stream("data: {not json}\n\n"), collect().callbacks),
    "server",
  );
});

test("Error codes and rate-limit metadata are classified", () => {
  assert.equal(classify(401), "auth");
  assert.equal(classify(402), "quota");
  assert.equal(classify(403), "refused");
  assert.equal(classify(404), "unavailable");
  assert.equal(classify(400), "unavailable");
  assert.equal(classify(408), "server");
  assert.equal(classify(503), "server");
  assert.equal(
    classify(429, "Rate limit exceeded: free-models-per-day"),
    "quota",
  );
  assert.equal(
    classify(429, "Rate limit exceeded: free-models-per-min.", {
      provider_name: null,
    }),
    "rate",
  );
  assert.equal(
    classify(429, "Provider returned error", {
      provider_name: "Google AI Studio",
    }),
    "server",
  );
  assert.equal(
    retryAtFrom({ headers: { "X-RateLimit-Reset": "1760054400000" } }),
    1760054400000,
  );
  assert.equal(
    retryAtFrom({ headers: { "X-RateLimit-Reset": "1760054400" } }),
    1760054400000,
  );
  assert.equal(retryAtFrom({}), undefined);
});
