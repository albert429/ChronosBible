import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { catalog } from "../../src/core/scripture/catalog.ts";
import type { ChronologyCatalog } from "../../src/core/reading/chronology.ts";
import { PLAN_DAYS } from "../../src/core/reading/schedule.ts";
import {
  packUrls,
  studyPackPaths,
  textPackPaths,
} from "../../src/features/offline/packs.ts";
import {
  CHECK_FAILED,
  SAVE_FAILED,
  isComplete,
  packController,
  type PackDevice,
  type PackStatus,
} from "../../src/features/offline/packStatus.ts";

const globals = globalThis as unknown as { fetch: typeof fetch };
const realFetch = globals.fetch;
afterEach(() => {
  globals.fetch = realFetch;
});

/** The network answers the inventory request with this body. */
function inventory(body: unknown, init?: (init?: RequestInit) => void) {
  globals.fetch = (async (_url: string, options?: RequestInit) => {
    init?.(options);
    return typeof body === "string" ? new Response(body) : Response.json(body);
  }) as typeof fetch;
}

test("an inventory that is not the build's file table is refused", async () => {
  for (const body of [
    { v: 2 },
    { v: 2, files: null },
    { v: 2, files: 1 },
    // A list was read by position before (`/study/v2/0`).
    { v: 2, files: ["GEN/1/index.json"] },
    { v: 1, files: { "GEN/1/index.json": "a" } },
    { files: { "GEN/1/index.json": "a" } },
  ]) {
    inventory(body);
    await assert.rejects(packUrls("study"), /Invalid study inventory/);
  }
  inventory("not json");
  await assert.rejects(packUrls("study"), SyntaxError);
});

test("a path outside the study folder refuses the whole inventory", () => {
  // Before, each was saved as written (`/study/v2/../readings/1.json`).
  for (const path of [
    "../readings/1.json",
    "/GEN/1/index.json",
    "GEN//1/index.json",
    "GEN/./1/index.json",
    "GEN/1/index.json?v=1",
    "GEN\\1\\index.json",
    "",
  ])
    assert.throws(
      () =>
        studyPackPaths({
          v: 2,
          files: { "GEN/1/index.json": "a", [path]: "b" },
        }),
      /Invalid study inventory/,
      path,
    );
});

test("only the sheet's chapter resources are saved; lexicon and unknown files are not", () => {
  // Before, everything but `lex/` was saved, `notes.txt` and `LEX/` too.
  assert.deepEqual(
    studyPackPaths({
      v: 2,
      files: {
        "GEN/1/index.json": "a",
        "GEN/1/1-31.words.json.gz": "b",
        "GEN/1/1-31.tr.json": "c",
        "1SA/3/1-10.words.json.gz": "d",
        "1SA/3/11-21.tr.json": "e",
        "GEN/1/notes.txt": "f",
        "lex/H00.json": "g",
        "LEX/H01.json": "h",
        "GEN/0/index.json": "i",
        "GEN/51/index.json": "m",
        "GEN/1/5-2.tr.json": "j",
        "GEN/1/1-31.words.json": "k",
        "genesis/1/index.json": "l",
      },
    }),
    [
      "GEN/1/index.json",
      "GEN/1/1-31.words.json.gz",
      "GEN/1/1-31.tr.json",
      "1SA/3/1-10.words.json.gz",
      "1SA/3/11-21.tr.json",
    ],
  );
});

test("the inventory request stops when the check is cancelled", async () => {
  let signal: AbortSignal | undefined;
  globals.fetch = ((_url: string, init?: RequestInit) =>
    new Promise((_, reject) => {
      signal = init?.signal ?? undefined;
      signal?.addEventListener("abort", () => reject(signal!.reason));
    })) as typeof fetch;
  const controller = new AbortController();
  const listing = packUrls("study", controller.signal);
  controller.abort();
  await assert.rejects(listing, { name: "AbortError" });
  assert.equal(signal?.aborted, true);
});

test("the text pack is every plan day, Bible chapter and chronological reading", () => {
  const chronology = (testament: "OT" | "NT", ids: string[]) =>
    ({ testament, readings: ids.map((id) => ({ id })) }) as ChronologyCatalog;
  const paths = textPackPaths([
    chronology("OT", ["gen-1-1", "deu-2-1"]),
    chronology("NT", ["mrk-1-1"]),
  ]);
  const chapters = catalog.reduce((sum, book) => sum + book.chapters, 0);
  assert.equal(paths.length, 1 + PLAN_DAYS + chapters + 2 + 3);
  assert.equal(new Set(paths).size, paths.length);
  for (const path of [
    "/readings/plan.json",
    "/readings/1.json",
    `/readings/${PLAN_DAYS}.json`,
    "/bible/GEN/1.json",
    "/bible/MAL/4.json",
    "/bible/REV/22.json",
    "/chronology/OT.json",
    "/chronology/NT.json",
    "/chronology/OT/deu-2-1.json",
    "/chronology/NT/mrk-1-1.json",
  ])
    assert.ok(paths.includes(path), path);
});

/** A device whose answers the test releases. */
function stubDevice() {
  const calls: string[] = [];
  let listSignal: AbortSignal | undefined;
  let saveSignal: AbortSignal | undefined;
  let listed!: (urls: string[]) => void;
  let listFailed!: (error: Error) => void;
  let saveProgress!: (saved: number) => void;
  let saveDone!: () => void;
  let saveFailed!: (error: Error) => void;
  let kept = 0;
  const device: PackDevice = {
    list: (pack, signal) => {
      calls.push(`list ${pack}`);
      listSignal = signal;
      return new Promise((resolve, reject) => {
        listed = resolve;
        listFailed = reject;
      });
    },
    savedCount: async (urls) => {
      calls.push(`count ${urls.length}`);
      return kept;
    },
    save: (urls, progress, signal) => {
      calls.push(`save ${urls.length}`);
      saveSignal = signal;
      saveProgress = progress;
      return new Promise((resolve, reject) => {
        saveDone = resolve;
        saveFailed = reject;
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    },
  };
  return {
    device,
    calls,
    keep: (count: number) => (kept = count),
    list: () => listSignal!,
    saving: () => saveSignal!,
    listed: (urls: string[]) => listed(urls),
    listFailed: () => listFailed(new Error("offline")),
    progress: (saved: number) => saveProgress(saved),
    saved: () => saveDone(),
    saveFailed: () => saveFailed(new Error("HTTP 503")),
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const urls = ["/a.json", "/b.json", "/c.json"];

test("a pack row counts what is kept, then saves the rest with progress", async () => {
  const stub = stubDevice();
  const shown: PackStatus[] = [];
  const row = packController("text", stub.device, (s) => shown.push(s));
  stub.keep(1);
  stub.listed(urls);
  await tick();
  assert.deepEqual(shown, [{ kind: "ready", saved: 1, total: 3 }]);
  assert.equal(isComplete(shown[0]), false);
  const saving = row.save();
  stub.progress(1);
  stub.progress(2);
  stub.saved();
  await saving;
  assert.deepEqual(shown.slice(1), [
    { kind: "saving", saved: 1, total: 3 },
    { kind: "saving", saved: 2, total: 3 },
    { kind: "ready", saved: 3, total: 3 },
  ]);
  assert.equal(isComplete(shown.at(-1)!), true);
  assert.equal(isComplete({ kind: "ready", saved: 0, total: 0 }), false);
  assert.deepEqual(stub.calls, ["list text", "count 3", "save 3"]);
});

test("a failed check or save says so; a cancelled save shows what is kept", async () => {
  let stub = stubDevice();
  let shown: PackStatus[] = [];
  packController("study", stub.device, (s) => shown.push(s));
  stub.listFailed();
  await tick();
  assert.deepEqual(shown, [{ kind: "error", message: CHECK_FAILED }]);

  stub = stubDevice();
  shown = [];
  let row = packController("study", stub.device, (s) => shown.push(s));
  stub.listed(urls);
  await tick();
  let saving = row.save();
  stub.saveFailed();
  await saving;
  assert.deepEqual(shown.at(-1), { kind: "error", message: SAVE_FAILED });

  stub = stubDevice();
  shown = [];
  row = packController("study", stub.device, (s) => shown.push(s));
  stub.listed(urls);
  await tick();
  saving = row.save();
  stub.keep(2);
  row.cancel();
  await saving;
  assert.equal(stub.saving().aborted, true);
  assert.deepEqual(shown.at(-1), { kind: "ready", saved: 2, total: 3 });
});

test("closing a row stops its check or save and shows nothing more", async () => {
  let stub = stubDevice();
  let shown: PackStatus[] = [];
  let row = packController("study", stub.device, (s) => shown.push(s));
  row.close();
  assert.equal(stub.list().aborted, true);
  stub.listed(urls);
  await tick();
  assert.deepEqual(shown, []);

  stub = stubDevice();
  shown = [];
  row = packController("text", stub.device, (s) => shown.push(s));
  stub.listed(urls);
  await tick();
  const saving = row.save();
  row.close();
  await saving;
  assert.equal(stub.saving().aborted, true);
  assert.deepEqual(shown, [{ kind: "ready", saved: 0, total: 3 }]);
});
