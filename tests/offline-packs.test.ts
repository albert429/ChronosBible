import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { packUrls } from "../src/features/offline/offline.ts";

// Characterizes how the study pack reads the build's inventory
// (/study/v2/inventory.json) before its enumeration is separated.
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

test("an inventory without a file table is refused", async () => {
  for (const body of [{ v: 2 }, { v: 2, files: null }, { v: 2, files: 1 }]) {
    inventory(body);
    await assert.rejects(packUrls("study"), /Invalid study inventory/);
  }
  inventory("not json");
  await assert.rejects(packUrls("study"), SyntaxError);
});

test("characterized: any listed path except lex/ is saved as it is written", async () => {
  inventory({
    files: {
      "GEN/1/index.json": "a",
      "GEN/1/notes.txt": "b",
      "../readings/1.json": "c",
      "/GEN/1/index.json": "d",
      "lex/H00.json": "e",
      "LEX/H01.json": "f",
    },
  });
  assert.deepEqual(await packUrls("study"), [
    "/study/v2/GEN/1/index.json",
    "/study/v2/GEN/1/notes.txt",
    "/study/v2/../readings/1.json",
    "/study/v2//GEN/1/index.json",
    "/study/v2/LEX/H01.json",
  ]);
  // A list instead of a table is read by position.
  inventory({ v: 2, files: ["GEN/1/index.json"] });
  assert.deepEqual(await packUrls("study"), ["/study/v2/0"]);
});

test("characterized: the inventory request cannot be cancelled", async () => {
  let signal: AbortSignal | null | undefined = null;
  inventory({ v: 2, files: { "GEN/1/index.json": "a" } }, (init) => {
    signal = init?.signal;
  });
  assert.deepEqual(await packUrls("study"), ["/study/v2/GEN/1/index.json"]);
  assert.equal(signal, undefined);
});
