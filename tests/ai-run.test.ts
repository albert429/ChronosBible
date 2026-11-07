import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { answer } from "../src/data/ai/client.ts";
import { abortable } from "../src/data/ai/abortable.ts";
test("API client sends only the reference contract and reads split Arabic UTF-8 snapshots", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/ai/v1/answer");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      verseId: "GEN.1.1",
      chip: "explain",
      turnstileToken: "token",
    });
    assert.equal(init?.credentials, "same-origin");
    const bytes = new TextEncoder().encode(
      'event: delta\ndata: {"text":"في البدء"}\n\nevent: done\ndata: {"provider":"openrouter","model":"free","finish":"stop"}\n\n',
    );
    return new Response(
      new ReadableStream({
        start(c) {
          for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
          c.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
  try {
    let text = "";
    const result = await answer(
      { verseId: "GEN.1.1", chip: "explain", turnstileToken: "token" },
      new AbortController().signal,
      {
        onText(t) {
          text += t;
        },
      },
    );
    assert.equal(text, "في البدء");
    assert.equal(result.finish, "stop");
  } finally {
    globalThis.fetch = original;
  }
});
test("Stop during a lazy load settles immediately and cleans up listeners", async () => {
  const control = new AbortController();
  const pending = abortable(new Promise(() => {}), control.signal);
  control.abort();
  await assert.rejects(pending, { kind: "aborted" });
  const live = new AbortController();
  assert.equal(await abortable(Promise.resolve(1), live.signal), 1);
  assert.equal(getEventListeners(live.signal, "abort").length, 0);
});
