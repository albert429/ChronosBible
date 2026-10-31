import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DATA_CACHE,
  SAVE_HEADER,
  dataFolder,
  isShellCache,
  route,
  shellCache,
  staleData,
} from "../src/pwa/rules.ts";

const ORIGIN = "https://chronosbible.com";
const shell = new Set(["/", "/assets/index-abc.js", "/manifest.json"]);
const request = (
  path: string,
  { method = "GET", mode = "cors", headers = new Headers() } = {},
) => ({ method, mode, headers, url: new URL(path, ORIGIN).href });

test("pages come from the build, hashed files from its cache", () => {
  assert.equal(
    route(request("/?mode=bible", { mode: "navigate" }), ORIGIN, shell),
    "page",
  );
  assert.equal(route(request("/assets/index-abc.js"), ORIGIN, shell), "shell");
  assert.equal(route(request("/manifest.json"), ORIGIN, shell), "shell");
  assert.equal(
    route(
      request("/licenses/study-data.txt", { mode: "navigate" }),
      ORIGIN,
      shell,
    ),
    "network",
  );
  // A file from another build is not the shell's; the network decides.
  assert.equal(
    route(request("/assets/index-old.js"), ORIGIN, shell),
    "network",
  );
});

test("only versioned Scripture data is kept; everything else passes", () => {
  assert.equal(
    route(request("/bible/GEN/1.json?v=abc"), ORIGIN, shell),
    "data",
  );
  assert.equal(
    route(request("/study/3.lex.json?v=abc"), ORIGIN, shell),
    "data",
  );
  for (const path of [
    "/bible/GEN/1.json",
    "/audio/1.json",
    "/audio/chapters/GEN/1.json",
    "/sw.js",
  ])
    assert.equal(route(request(path), ORIGIN, shell), "network", path);
  assert.equal(
    route(request("https://audio.chronosbible.com/a.m4a"), ORIGIN, shell),
    "network",
  );
  assert.equal(
    route(
      request("/bible/GEN/1.json?v=abc", { method: "POST" }),
      ORIGIN,
      shell,
    ),
    "network",
  );
  // The page's own offline downloads write the cache themselves.
  assert.equal(
    route(
      request("/bible/GEN/1.json?v=abc", {
        headers: new Headers({ [SAVE_HEADER]: "1" }),
      }),
      ORIGIN,
      shell,
    ),
    "network",
  );
});

test("a regenerated folder's older files are stale; other folders are kept", () => {
  const versions = { bible: "new", readings: "same" };
  const url = (path: string) => new URL(path, ORIGIN);
  assert.equal(staleData(url("/bible/GEN/1.json?v=old"), versions), true);
  assert.equal(staleData(url("/bible/GEN/1.json?v=new"), versions), false);
  assert.equal(staleData(url("/readings/1.json?v=same"), versions), false);
  assert.equal(staleData(url("/audio/1.json"), versions), false);
  assert.equal(dataFolder(url("/chronology/OT/gen-1.json?v=x")), "chronology");
  assert.equal(dataFolder(url("/bible/GEN/1.txt?v=x")), undefined);
});

test("cache names separate builds from data", () => {
  assert.equal(shellCache("abc"), "chronos-shell-abc");
  assert.equal(isShellCache(shellCache("abc")), true);
  assert.equal(isShellCache(DATA_CACHE), false);
});
