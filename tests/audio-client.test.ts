// The audio manifest client's URL and validation, with fetch stubbed. Each test
// file runs in its own process, so the global set here stays local.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AudioManifest } from "../src/domain/audio/types.ts";

const requests: string[] = [];
let body: unknown = {};
globalThis.fetch = async (url: RequestInfo | URL) => {
  requests.push(String(url));
  return Response.json(body);
};
const client = await import("../src/features/audio/client.ts");

const manifest: AudioManifest = {
  version: 1,
  day: 5,
  readingHash: "a".repeat(64),
  src: "/audio/days/005-abc123.m4a",
  duration: 10,
  cues: [{ passage: 0, verse: 1, start: 0, end: 5 }],
};

test("Manifests are read from /audio/<day>.json and cached", async () => {
  body = manifest;
  assert.deepEqual(await client.audioManifests.load("5"), manifest);
  assert.deepEqual(await client.audioManifests.load("5"), manifest);
  assert.deepEqual(client.audioManifests.peek("5"), manifest);
  assert.deepEqual(requests, ["/audio/5.json"]);
});

test("A manifest for another day, or with an unsafe source or bad cues, is rejected", async () => {
  for (const [day, broken] of [
    ["6", manifest],
    ["5", { ...manifest, src: "https://evil.test/a.m4a" }],
    ["5", { ...manifest, src: "/audio/days/../x.m4a" }],
    ["5", { ...manifest, readingHash: "xyz" }],
    ["5", { ...manifest, duration: 0 }],
    ["5", { ...manifest, cues: [] }],
    ["5", { ...manifest, cues: [{ ...manifest.cues[0], end: 99 }] }],
  ] as const) {
    client.audioManifests.invalidate(day);
    body = broken;
    await assert.rejects(
      client.audioManifests.load(day),
      /تعذر تحميل التسجيل/,
      JSON.stringify(broken),
    );
    assert.equal(client.audioManifests.peek(day), undefined);
  }
});

test("Invalidating a day makes the next load fetch it again and leaves other days cached", async () => {
  body = manifest;
  requests.length = 0;
  await client.audioManifests.load("5");
  client.audioManifests.invalidate("5");
  assert.equal(client.audioManifests.peek("5"), undefined);
  await client.audioManifests.load("5");
  assert.deepEqual(requests, ["/audio/5.json", "/audio/5.json"]);
  client.audioManifests.invalidate("6");
  assert.deepEqual(client.audioManifests.peek("5"), manifest);
});
