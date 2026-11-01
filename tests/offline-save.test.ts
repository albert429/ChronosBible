import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { savePack } from "../src/features/offline/downloads.ts";
import { packUrls } from "../src/features/offline/packs.ts";

const globals = globalThis as unknown as {
  caches?: unknown;
  fetch: typeof fetch;
  location?: unknown;
};
const realFetch = globals.fetch;
afterEach(() => {
  globals.fetch = realFetch;
  delete globals.caches;
  delete globals.location;
});

/** A data cache, and a network where each file answers when released. */
function stubDevice(fail: string) {
  const stored = new Map<string, Response>();
  const pending: (() => void)[] = [];
  const writing: (() => void)[] = [];
  let slowWrites = false;
  globals.location = { href: "https://chronos.test/" };
  globals.caches = {
    open: async () => ({
      keys: async () => [...stored.keys()].map((url) => ({ url })),
      put: async (url: string, response: Response) => {
        if (slowWrites) await new Promise<void>((done) => writing.push(done));
        stored.set(new URL(url, "https://chronos.test/").href, response);
      },
    }),
  };
  globals.fetch = ((url: string, init: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      pending.push(() =>
        resolve(new Response("{}", { status: url === fail ? 503 : 200 })),
      );
    })) as typeof fetch;
  return {
    stored,
    release: () => pending.splice(0).forEach((go) => go()),
    slowWrites: () => (slowWrites = true),
    finishWrites: () => writing.splice(0).forEach((done) => done()),
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a failed file stops the whole save, and no progress follows it", async () => {
  const urls = Array.from(
    { length: 20 },
    (_, index) => `/bible/GEN/${index + 1}.json`,
  );
  const device = stubDevice(urls[2]);
  const reported: number[] = [];
  const save = savePack(
    urls,
    (saved) => reported.push(saved),
    new AbortController().signal,
  );
  const outcome = assert.rejects(save, /HTTP 503/);
  await tick();
  device.release();
  await outcome;
  const after = reported.length;
  await tick();
  device.release();
  await tick();
  assert.equal(reported.length, after, "no progress after the failure");
  assert.ok(device.stored.size < urls.length, "the rest was not downloaded");
});

test("a cancelled save reports nothing more, even for files being written", async () => {
  const urls = Array.from(
    { length: 20 },
    (_, index) => `/bible/EXO/${index + 1}.json`,
  );
  const device = stubDevice("");
  device.slowWrites();
  const controller = new AbortController();
  const reported: number[] = [];
  const save = savePack(
    urls,
    (saved) => reported.push(saved),
    controller.signal,
  );
  const outcome = assert.rejects(save);
  await tick();
  // Six files arrive and wait to be written when the reader cancels.
  device.release();
  await tick();
  controller.abort();
  device.finishWrites();
  await outcome;
  await tick();
  assert.deepEqual(reported, [0]);
});

test("the study pack is every chapter's study files from the build inventory", async () => {
  const requested: string[] = [];
  globals.fetch = (async (url: string) => {
    requested.push(url);
    return Response.json({
      v: 2,
      files: {
        "GEN/1/index.json": "a",
        "GEN/1/1-31.words.json.gz": "b",
        "GEN/1/1-31.tr.json": "c",
        "lex/H00.json": "d",
      },
    });
  }) as typeof fetch;
  assert.deepEqual(await packUrls("study"), [
    "/study/v2/GEN/1/index.json",
    "/study/v2/GEN/1/1-31.words.json.gz",
    "/study/v2/GEN/1/1-31.tr.json",
  ]);
  assert.deepEqual(requested, ["/study/v2/inventory.json"]);
  globals.fetch = (async () =>
    new Response("{}", { status: 404 })) as unknown as typeof fetch;
  await assert.rejects(packUrls("study"), /HTTP 404/);
});

/** A device whose cache opens when `open` is called, and a quick network. */
function quickDevice() {
  const requested: string[] = [];
  let opened!: () => void;
  const opening = new Promise<void>((done) => (opened = done));
  let openCalled!: () => void;
  const openStarted = new Promise<void>((done) => (openCalled = done));
  globals.location = { href: "https://chronos.test/" };
  globals.caches = {
    open: async () => {
      openCalled();
      await opening;
      return { keys: async () => [], put: async () => {} };
    },
  };
  globals.fetch = (async (url: string, init: RequestInit) => {
    init.signal?.throwIfAborted();
    requested.push(url);
    return new Response("{}");
  }) as typeof fetch;
  return { requested, opened, openStarted };
}
const files = (book: string) =>
  Array.from({ length: 8 }, (_, index) => `/bible/${book}/${index + 1}.json`);

test("a save cancelled before it starts downloads and reports nothing", async () => {
  const device = quickDevice();
  device.opened();
  const controller = new AbortController();
  controller.abort();
  const reported: number[] = [];
  await assert.rejects(
    savePack(files("LEV"), (saved) => reported.push(saved), controller.signal),
  );
  assert.deepEqual(device.requested, []);
  assert.deepEqual(reported, []);
});

test("a save cancelled while the cache opens downloads and reports nothing", async () => {
  const device = quickDevice();
  const controller = new AbortController();
  const reported: number[] = [];
  const save = savePack(
    files("NUM"),
    (saved) => reported.push(saved),
    controller.signal,
  );
  const outcome = assert.rejects(save);
  await device.openStarted;
  controller.abort();
  device.opened();
  await outcome;
  assert.deepEqual(device.requested, []);
  assert.deepEqual(reported, []);
});

test("six files download at once; files already kept are skipped at their versioned address", async () => {
  let open = 0;
  let most = 0;
  const requested: string[] = [];
  const stored = new Map<string, Response>();
  const kept = [
    "https://chronos.test/bible/RUT/1.json?v=new",
    // An older version of the same file is not the one this build needs.
    "https://chronos.test/bible/RUT/2.json?v=old",
  ];
  globals.location = { href: "https://chronos.test/" };
  globals.caches = {
    open: async () => ({
      keys: async () => kept.map((url) => ({ url })),
      put: async (url: string, response: Response) => {
        stored.set(url, response);
      },
    }),
  };
  const body = new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3]);
  globals.fetch = (async (url: string, init: RequestInit) => {
    requested.push(url);
    assert.equal(new Headers(init.headers).get("x-chronos-save"), "1");
    most = Math.max(most, ++open);
    await tick();
    open--;
    return new Response(body, {
      headers: { "content-type": "application/gzip" },
    });
  }) as typeof fetch;
  const urls = Array.from(
    { length: 4 },
    (_, index) => `/bible/RUT/${index + 1}.json?v=new`,
  ).concat(
    Array.from(
      { length: 20 },
      (_, index) => `/study/v2/RUT/1/${index + 1}-${index + 1}.words.json.gz`,
    ),
  );
  const reported: number[] = [];
  await savePack(
    urls,
    (saved) => reported.push(saved),
    new AbortController().signal,
  );
  assert.equal(most, 6);
  assert.equal(requested.length, urls.length - 1);
  assert.ok(!requested.includes("/bible/RUT/1.json?v=new"));
  assert.ok(requested.includes("/bible/RUT/2.json?v=new"));
  assert.deepEqual(
    reported,
    Array.from({ length: urls.length }, (_, index) => index + 1),
  );
  // The raw response is kept as it arrived: the gzip stays compressed.
  const words = stored.get("/study/v2/RUT/1/1-1.words.json.gz")!;
  assert.equal(words.headers.get("content-type"), "application/gzip");
  assert.deepEqual(new Uint8Array(await words.arrayBuffer()), body);
});
