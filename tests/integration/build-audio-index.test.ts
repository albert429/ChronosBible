// buildAudioIndex reads a scratch repository and writes a scratch directory, so
// these tests never touch public/.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAudioIndex } from "../../scripts/data/build-audio-index.js";
import { readingHash } from "../../src/features/audio/domain/compatibility.ts";
import type { Day } from "../../src/core/reading/types.ts";

const reading: Day = {
  day: 1,
  verseCount: 2,
  passages: [
    {
      book: "لوقا",
      chapter: 1,
      start: 1,
      end: 2,
      verses: [
        { number: 1, text: "أول" },
        { number: 2, text: "ثان" },
      ],
    },
  ],
};
const manifest = (readingHash: string) => ({
  version: 1,
  day: 1,
  readingHash,
  src: "/audio/days/001-abc123.m4a",
  duration: 9,
  cues: [{ passage: 0, verse: 1, start: 0, end: 2 }],
});

function repository(days: number[], hash: string) {
  const root = mkdtempSync(join(tmpdir(), "audio-index-"));
  mkdirSync(join(root, "data/audio/manifests"), { recursive: true });
  writeFileSync(join(root, "data/plan.json"), JSON.stringify([reading]));
  writeFileSync(
    join(root, "data/audio/catalog.json"),
    JSON.stringify({ days }),
  );
  writeFileSync(
    join(root, "data/audio/manifests/1.json"),
    JSON.stringify(manifest(hash)),
  );
  return root;
}
const build = (root: string) =>
  buildAudioIndex({ root, out: join(root, "public/audio") });

test("A manifest whose hash matches the Scripture is published to public/audio", async () => {
  const hash = await readingHash(reading);
  const root = repository([1], hash);
  try {
    assert.match(build(root), /Prepared 1 audio manifests/);
    assert.deepEqual(
      JSON.parse(readFileSync(join(root, "public/audio/1.json"), "utf8")),
      manifest(hash),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("A stale manifest hash fails the build and publishes nothing", () => {
  const root = repository([1], "0".repeat(64));
  try {
    assert.throws(() => build(root), /Audio for day 1 is stale/);
    assert.equal(existsSync(join(root, "public/audio/1.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("A malformed manifest fails the build instead of the player", async () => {
  const hash = await readingHash(reading);
  const root = repository([1], hash);
  writeFileSync(
    join(root, "data/audio/manifests/1.json"),
    JSON.stringify({ ...manifest(hash), cues: [] }),
  );
  try {
    assert.throws(() => build(root), /manifest for day 1 is malformed/);
    assert.equal(existsSync(join(root, "public/audio/1.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("A catalog day that is not in the plan fails the build", async () => {
  const root = repository([2], await readingHash(reading));
  try {
    assert.throws(() => build(root), /Invalid audio day 2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("A manifest dropped from the catalog leaves public/audio on the next build; media stays", async () => {
  const hash = await readingHash(reading);
  const root = repository([1], hash);
  const out = join(root, "public/audio");
  const inventory = join(root, "artifacts/generated-output/audio.json");
  try {
    buildAudioIndex({ root, out, inventory });
    assert.ok(existsSync(join(out, "1.json")));
    // Local recordings and unrelated files share the folder.
    mkdirSync(join(out, "days"), { recursive: true });
    writeFileSync(join(out, "days/001-abc123.m4a"), "media");
    writeFileSync(join(out, "notes.txt"), "mine");
    writeFileSync(
      join(root, "data/audio/catalog.json"),
      JSON.stringify({ days: [] }),
    );
    assert.match(
      buildAudioIndex({ root, out, inventory }),
      /Prepared 0 audio manifests/,
    );
    assert.equal(existsSync(join(out, "1.json")), false);
    assert.equal(
      readFileSync(join(out, "days/001-abc123.m4a"), "utf8"),
      "media",
    );
    assert.equal(readFileSync(join(out, "notes.txt"), "utf8"), "mine");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
