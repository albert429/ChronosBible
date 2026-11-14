import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { validManifest } from "../domain/manifest.ts";
import type { AudioManifestV2, AudioManifestV3 } from "../domain/types.ts";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("All 1189 chapters expose the source's 31104 verses and explicit openings", () => {
  const source = JSON.parse(
    gunzipSync(readFileSync("data/bible/source.json.gz")).toString(),
  );
  let chapters = 0;
  let verses = 0;
  for (const book of source.books) {
    for (const chapter of book.chapters) {
      const identity = `bible:${book.usfm}:${chapter.chapter}`;
      const manifest: AudioManifestV2 = json(
        `data/audio/chapters/${book.usfm}/${chapter.chapter}.json`,
      );
      assert.ok(validManifest(manifest, identity), identity);
      assert.equal(manifest.alignment, "verse", identity);
      assert.deepEqual(
        manifest.cues.map((c) => [c.passage, c.verse]),
        chapter.verses.map((v: { number: number }) => [0, v.number]),
        identity,
      );
      const opening = manifest.cues[0].start;
      assert.deepEqual(
        manifest.announcements.map((a) => [a.start, a.end, a.kind]),
        opening ? [[0, opening, "source"]] : [],
        identity,
      );
      chapters++;
      verses += manifest.cues.length;
    }
  }
  assert.equal(chapters, 1189);
  assert.equal(verses, 31104);
});

test("All daily occurrences retain displayed passage and verse order", () => {
  const plan = json("data/plan.json");
  assert.equal(plan.length, 150);
  for (const day of plan) {
    const manifest = json(`data/audio/manifests/${day.day}.json`);
    assert.deepEqual(
      manifest.cues.map((cue: { passage: number; verse: number }) => [
        cue.passage,
        cue.verse,
      ]),
      day.passages.flatMap(
        (p: { verses: { number: number }[] }, index: number) =>
          p.verses.map((v) => [index, v.number]),
      ),
      `day ${day.day}`,
    );
  }
});

test("All 553 playlists retain full verse coverage, including partial passages", () => {
  const catalog = json("data/audio/reading-catalog.json").readings as string[];
  assert.equal(catalog.filter((id) => id.startsWith("chrono:OT:")).length, 412);
  assert.equal(catalog.filter((id) => id.startsWith("chrono:NT:")).length, 141);
  for (const identity of catalog) {
    const [, testament, id] = identity.split(":");
    const manifest: AudioManifestV3 = json(
      `data/audio/readings/${testament}/${id}.json`,
    );
    assert.ok(validManifest(manifest, identity), identity);
    for (const [index, entry] of manifest.entries.entries()) {
      assert.equal(entry.passage, index, identity);
      assert.equal(entry.alignment, "verse", identity);
      assert.deepEqual(
        entry.cues.map((c) => c.verse),
        Array.from(
          { length: entry.to - entry.from + 1 },
          (_, i) => entry.from + i,
        ),
        identity,
      );
      if (entry.src.startsWith("/audio/chapters/")) {
        const chapter: AudioManifestV2 = json(
          `data/audio/chapters/${entry.book}/${entry.chapter}.json`,
        );
        assert.deepEqual(
          entry.cues,
          chapter.cues.map(({ verse, start, end }) => ({ verse, start, end })),
          identity,
        );
      }
    }
  }
});
