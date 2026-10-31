import { test } from "node:test";
import assert from "node:assert/strict";
import { createJsonClient } from "../src/lib/jsonClient.ts";

type Item = { key: string };
const options = {
  url: (key: string) => `/data/${key}.json`,
  validate: (data: unknown, key: string): data is Item =>
    (data as Item | null)?.key === key,
  message: (key: string) => `تعذر تحميل ${key}`,
};

test("Concurrent loads share one request and successes are cached", async () => {
  const urls: string[] = [];
  const client = createJsonClient(options, async (url) => {
    urls.push(String(url));
    return Response.json({ key: "a" });
  });
  const first = client.load("a");
  assert.equal(client.load("a"), first);
  assert.deepEqual(await first, { key: "a" });
  assert.deepEqual(await client.load("a"), { key: "a" });
  assert.deepEqual(client.peek("a"), { key: "a" });
  assert.deepEqual(urls, ["/data/a.json"]);
});

test("HTTP and validation failures reject with the message and are not cached", async () => {
  let requests = 0;
  const client = createJsonClient(options, async () => {
    requests++;
    if (requests === 1) return new Response("down", { status: 503 });
    if (requests === 2) return Response.json({ key: "other" });
    return Response.json({ key: "b" });
  });
  await assert.rejects(client.load("b"), /تعذر تحميل b/);
  await assert.rejects(client.load("b"), (error: Error) => {
    assert.equal(error.message, "تعذر تحميل b");
    assert.match(String(error.cause), /Invalid data/);
    return true;
  });
  assert.equal(client.peek("b"), undefined);
  assert.deepEqual(await client.load("b"), { key: "b" });
  assert.equal(requests, 3);
});

test("A request that outlives the timeout is aborted and can be retried", async () => {
  let aborted = false;
  const client = createJsonClient(
    options,
    (_url, init) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        }),
      ),
    10,
  );
  await assert.rejects(client.load("c"), /تعذر تحميل c/);
  assert.ok(aborted);
  assert.equal(client.peek("c"), undefined);
});

test("Failures keep the underlying error as the cause", async () => {
  const client = createJsonClient(
    options,
    async () => new Response("down", { status: 503 }),
  );
  await assert.rejects(client.load("a"), (error: Error) => {
    assert.equal(error.message, "تعذر تحميل a");
    assert.equal((error.cause as Error).message, "HTTP 503");
    return true;
  });
});

test("Invalidating a key drops only that cached value", async () => {
  const urls: string[] = [];
  const client = createJsonClient(options, async (url) => {
    urls.push(String(url));
    return Response.json({ key: String(url).slice(6, -5) });
  });
  await client.load("a");
  await client.load("b");
  client.invalidate("a");
  assert.equal(client.peek("a"), undefined);
  assert.deepEqual(client.peek("b"), { key: "b" });
  assert.deepEqual(await client.load("a"), { key: "a" });
  assert.deepEqual(urls, ["/data/a.json", "/data/b.json", "/data/a.json"]);
});

test("A response started by the page's inline script serves the first load of its address", async () => {
  const urls: string[] = [];
  const client = createJsonClient(options, async (url) => {
    urls.push(String(url));
    return Response.json({ key: String(url).slice(6, 7) });
  });
  Object.assign(globalThis, {
    __earlyData: {
      "/data/e.json": Promise.resolve(Response.json({ key: "e" })),
      // A failed early request: the client fetches as usual.
      "/data/f.json": Promise.resolve(undefined),
    },
  });
  try {
    assert.deepEqual(await client.load("e"), { key: "e" });
    assert.deepEqual(await client.load("f"), { key: "f" });
    assert.deepEqual(urls, ["/data/f.json"]);
    // Each early response is used once; a later load fetches.
    client.invalidate("e");
    assert.deepEqual(await client.load("e"), { key: "e" });
    assert.deepEqual(urls, ["/data/f.json", "/data/e.json"]);
  } finally {
    delete (globalThis as { __earlyData?: unknown }).__earlyData;
  }
});
