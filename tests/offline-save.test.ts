import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { savePack } from "../src/pwa/offline.ts";

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
