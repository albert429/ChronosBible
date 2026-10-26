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

test("An opt-in LRU bound evicts old entries and keeps shared pending requests", async () => {
  const urls: string[] = [];
  const client = createJsonClient(
    { ...options, maxEntries: 2 },
    async (url) => {
      urls.push(String(url));
      return Response.json({ key: String(url).slice(6, -5) });
    },
  );
  await client.load("a");
  await client.load("b");
  await client.load("a"); // a becomes the most recently used entry.
  const first = client.load("c");
  assert.equal(first, client.load("c"));
  await first;
  assert.equal(client.peek("b"), undefined);
  assert.deepEqual(client.peek("a"), { key: "a" });
  assert.deepEqual(client.peek("c"), { key: "c" });
  await client.load("b");
  assert.deepEqual(urls, [
    "/data/a.json",
    "/data/b.json",
    "/data/c.json",
    "/data/b.json",
  ]);
});

test("Custom decoders still validate before caching and failed parsing retries", async () => {
  let calls = 0;
  const client = createJsonClient(
    {
      ...options,
      parse: async (response) => ({ key: await response.text() }),
    },
    async () => new Response(++calls === 1 ? "wrong" : "a"),
  );
  await assert.rejects(client.load("a"), /تعذر تحميل/);
  assert.equal(client.peek("a"), undefined);
  assert.deepEqual(await client.load("a"), { key: "a" });
});
