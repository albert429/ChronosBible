// The page's early reading (src/features/reader/earlyReading.ts): which
// files index.html fetches before the app runs, and the inline script the
// build makes of it (scripts/build/inline-startup.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  PRELOAD_KEY,
  earlyPaths,
} from "../../src/features/reader/earlyReading.ts";
import {
  LOCATION_KEY,
  PROGRESS_KEY,
  STATE_KEY,
} from "../../src/features/profiles/storage.ts";
import {
  EARLY_READING_MARKER,
  bundleEarlyReading,
  inlineEarlyReading,
} from "../../scripts/build/inline-startup.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const storage = (items: Record<string, string> = {}) => ({
  getItem: (key: string) => items[key] ?? null,
});

test("a link's place is fetched early, whatever is saved", () => {
  const saved = storage({ [PRELOAD_KEY]: '["/bible/GEN/2.json"]' });
  assert.deepEqual(earlyPaths("?mode=bible&book=JHN&chapter=3", saved), [
    "/bible/JHN/3.json",
  ]);
  assert.deepEqual(
    earlyPaths("?mode=chronological&testament=NT&reading=mrk-1-1", saved),
    ["/chronology/NT.json", "/chronology/NT/mrk-1-1.json"],
  );
  assert.deepEqual(earlyPaths("?day=40", saved), ["/readings/40.json"]);
  // A mode this script does not know is left to the app.
  assert.deepEqual(earlyPaths("?mode=plan&day=4", saved), []);
});

test("without a place, the last visit's reading, or Genesis 1 for a new reader", () => {
  assert.deepEqual(earlyPaths("", storage()), ["/bible/GEN/1.json"]);
  assert.deepEqual(
    earlyPaths(
      "",
      storage({
        [PRELOAD_KEY]: JSON.stringify([
          "/chronology/OT.json",
          "/chronology/OT/deu-2-1.json",
          "/bible/DEU/2.json",
        ]),
      }),
    ),
    ["/chronology/OT.json", "/chronology/OT/deu-2-1.json", "/bible/DEU/2.json"],
  );
  // A reader from before the list: their place is unknown here.
  for (const key of [STATE_KEY, LOCATION_KEY, PROGRESS_KEY])
    assert.deepEqual(earlyPaths("", storage({ [key]: "{}" })), [], key);
});

test("only Scripture data files are fetched early", () => {
  const listed = (paths: unknown) =>
    earlyPaths("", storage({ [PRELOAD_KEY]: JSON.stringify(paths) }));
  assert.deepEqual(
    listed([
      "/bible/GEN/1.json",
      "/audio/1.json",
      "/study/v2/GEN/1/index.json",
      "https://example.com/bible/GEN/1.json",
      "/bible/../sw.js",
      "/bible/GEN/1.json?v=1",
      4,
      null,
    ]),
    ["/bible/GEN/1.json"],
  );
  assert.deepEqual(listed({ path: "/bible/GEN/1.json" }), []);
  assert.deepEqual(listed(null), []);
  assert.throws(() => earlyPaths("", storage({ [PRELOAD_KEY]: "[" })));
});

/** Run the inline script as a page would, with this address and storage. */
function runPage(
  code: string,
  search: string,
  items: Record<string, string> | "blocked" = {},
  answer: (href: string) => Promise<Response> = async () => Response.json({}),
) {
  const fetched: string[] = [];
  const page = vm.createContext({
    URLSearchParams,
    location: { search },
    get localStorage() {
      if (items === "blocked") throw new Error("SecurityError");
      return storage(items);
    },
    fetch: (href: string) => {
      fetched.push(href);
      return answer(href);
    },
  });
  vm.runInContext(code, page);
  return {
    fetched,
    early: (page as { __earlyData?: Record<string, Promise<unknown>> })
      .__earlyData,
  };
}

test("the build inlines one classic script that starts the fetches with the page", async () => {
  const { code, modules } = await bundleEarlyReading(ROOT, {
    bible: "b1",
    chronology: "c1",
  });
  assert.doesNotMatch(code, /\bimport\b|\bexport\b/);
  // Only the handoff, the versioned addresses and the storage keys: the
  // rest of the app (and of the modules it reads) stays out.
  assert.ok(code.length < 2048, `${code.length} bytes`);
  assert.deepEqual(modules.map((file) => file.slice(ROOT.length)).sort(), [
    "src/features/profiles/storage.ts",
    "src/features/reader/earlyReading.ts",
    "src/shared/network/dataVersion.ts",
    "src/shared/network/earlyResponses.ts",
  ]);

  let page = runPage(code, "?mode=chronological&testament=OT&reading=gen-1-1");
  // Versioned like the app's own requests; readings has no version here.
  assert.deepEqual(page.fetched, [
    "/chronology/OT.json?v=c1",
    "/chronology/OT/gen-1-1.json?v=c1",
  ]);
  assert.deepEqual(Object.keys(page.early!), page.fetched);
  assert.ok(
    (await page.early!["/chronology/OT.json?v=c1"]) instanceof Response,
  );
  page = runPage(code, "?day=3");
  assert.deepEqual(page.fetched, ["/readings/3.json"]);

  // A failed or refused request leaves undefined, for the app to fetch.
  page = runPage(code, "", {}, async () => new Response("", { status: 404 }));
  assert.deepEqual(page.fetched, ["/bible/GEN/1.json?v=b1"]);
  assert.equal(await page.early!["/bible/GEN/1.json?v=b1"], undefined);
  page = runPage(code, "", {}, () => Promise.reject(new TypeError("offline")));
  assert.equal(await page.early!["/bible/GEN/1.json?v=b1"], undefined);

  // Unreadable storage never breaks the page: nothing starts early.
  for (const items of ["blocked", { [PRELOAD_KEY]: "[" }] as const) {
    page = runPage(code, "", items);
    assert.deepEqual(page.fetched, []);
    assert.equal(page.early, undefined);
  }
});

test("index.html runs the early reading in its head, before the app's module", () => {
  const html = readFileSync(
    new URL("../../index.html", import.meta.url),
    "utf8",
  );
  const page = inlineEarlyReading(html, "start()");
  assert.ok(!page.includes(EARLY_READING_MARKER));
  const script = page.indexOf("<script>start()</script>");
  assert.ok(script > 0 && script < page.indexOf("</head>"));
  assert.ok(script < page.indexOf('<script type="module"'));
  assert.throws(
    () => inlineEarlyReading("<head></head>", "start()"),
    /has no <script>__EARLY_READING__/,
  );
  // Replacement text is taken literally.
  assert.equal(
    inlineEarlyReading("<script>__EARLY_READING__;</script>", "a='$&'"),
    "<script>a='$&'</script>",
  );
});
