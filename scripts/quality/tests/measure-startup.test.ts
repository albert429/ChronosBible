import assert from "node:assert/strict";
import { test } from "node:test";
import { compare, normalize } from "../measure-startup.mjs";

const place = (paths: string[]) => ({
  count: paths.length,
  bytes: paths.length * 10,
  requests: paths.map((path) => ({
    method: "GET",
    path,
    type: "script",
    status: 200,
    bytes: 10,
  })),
});

test("Startup request paths compare without content hashes", () => {
  assert.equal(normalize("/assets/index-DWxLYBnj.js"), "/assets/index.js");
  assert.equal(
    normalize("/assets/noto-arabic-semibold-a1B2c3D4.woff2"),
    "/assets/noto-arabic-semibold.woff2",
  );
  assert.equal(
    normalize("/readings/1.json?v=d3ba836b4b"),
    "/readings/1.json?v=d3ba836b4b",
  );
});

test("Startup comparison reports added and removed requests and fails on growth", () => {
  const before = { places: { a: place(["/x.js", "/y.js"]) } };
  const same = compare(before, { places: { a: place(["/y.js", "/x.js"]) } });
  assert.deepEqual(same.failures, []);

  const swapped = compare(before, { places: { a: place(["/x.js", "/z.js"]) } });
  assert.deepEqual(swapped.failures, []);
  assert.ok(swapped.lines.some((line) => line.includes("added:   GET /z.js")));
  assert.ok(swapped.lines.some((line) => line.includes("removed: GET /y.js")));

  const grown = compare(before, {
    places: { a: place(["/x.js", "/y.js", "/z.js"]) },
  });
  assert.match(grown.failures[0], /startup requests grew 2 -> 3/);
  assert.match(compare(before, { places: {} }).failures[0], /missing/);
});
