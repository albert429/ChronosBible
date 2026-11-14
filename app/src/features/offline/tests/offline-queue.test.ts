import assert from "node:assert/strict";
import { test } from "node:test";
import { allSaved, busy, downloadQueue, overall } from "../downloadQueue.ts";
import type { Pack } from "../packs.ts";
import type { PackDevice } from "../packStatus.ts";

const FILES: Record<Pack, string[]> = {
  text: ["/bible/GEN/1.json", "/bible/GEN/2.json"],
  study: ["/study/v2/GEN/1/index.json", "/study/v2/GEN/2/index.json"],
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A device whose saves wait to be finished or failed by the test. */
function stubDevice({ kept = new Set<string>(), offline = false } = {}) {
  const calls: string[] = [];
  const pending: {
    done: () => void;
    fail: () => void;
    signal: AbortSignal;
  }[] = [];
  const device: PackDevice = {
    list: async (pack) => {
      calls.push(`list ${pack}`);
      if (offline) throw new Error("offline");
      return FILES[pack];
    },
    savedCount: async (urls) => urls.filter((url) => kept.has(url)).length,
    save: (urls, progress, signal) => {
      calls.push(`save ${urls[0].split("/")[1]}`);
      return new Promise<void>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
        pending.push({
          signal,
          fail: () => reject(new Error("HTTP 503")),
          done: () => {
            urls.forEach((url) => kept.add(url));
            progress(urls.length);
            resolve();
          },
        });
      });
    },
  };
  return {
    device,
    calls,
    pending,
    setOnline: () => (offline = false),
  };
}

test("everything saves in order: Scripture text, then study notes", async () => {
  const stub = stubDevice();
  const queue = downloadQueue(stub.device);
  const saving = queue.save();
  assert.equal(busy(queue.get()), true);
  await tick();
  assert.equal(queue.get().active, "text");
  assert.deepEqual(queue.get().queued, ["study"]);
  assert.equal(overall(queue.get()), 0);
  stub.pending[0].done();
  await tick();
  assert.equal(queue.get().active, "study");
  assert.equal(overall(queue.get()), 0.5);
  stub.pending[1].done();
  await saving;
  assert.deepEqual(stub.calls.slice(2), ["save bible", "save study"]);
  assert.equal(allSaved(queue.get()), true);
  assert.equal(busy(queue.get()), false);
});

test("a pack already kept is skipped, and a second request joins the queue", async () => {
  const stub = stubDevice({ kept: new Set(FILES.text) });
  const queue = downloadQueue(stub.device);
  const first = queue.save(["study"]);
  const second = queue.save();
  await tick();
  stub.pending[0].done();
  await Promise.all([first, second]);
  assert.deepEqual(stub.calls.slice(2), ["save study"]);
  assert.equal(allSaved(queue.get()), true);
});

test("cancelling stops the pack being saved and drops the waiting ones", async () => {
  const stub = stubDevice();
  const queue = downloadQueue(stub.device);
  const saving = queue.save();
  await tick();
  queue.cancel();
  await saving;
  assert.equal(stub.pending[0].signal.aborted, true);
  assert.deepEqual(stub.calls.slice(2), ["save bible"]);
  assert.equal(busy(queue.get()), false);
  assert.equal(queue.get().packs.text.kind, "ready");
});

test("a failure stops the queue; trying again counts the pack afresh", async () => {
  const stub = stubDevice({ offline: true });
  const queue = downloadQueue(stub.device);
  await queue.save();
  assert.equal(queue.get().packs.text.kind, "error");
  assert.deepEqual(stub.calls, ["list text", "list study"]);

  stub.setOnline();
  const retry = queue.save(["text"]);
  await tick();
  assert.equal(queue.get().active, "text");
  stub.pending[0].fail();
  await retry;
  assert.equal(queue.get().packs.text.kind, "error");
  assert.equal(busy(queue.get()), false);
});
