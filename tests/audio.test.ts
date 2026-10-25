import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  readingHash,
  readingTranscript,
  matchesReading,
  validManifest,
  cueAt,
  type LegacyAudioManifest,
  type Cue,
} from "../src/audio/manifest.ts";
import { audioUrl } from "../src/audio/url.ts";
import type { Day } from "../src/plan/readings.ts";

const reading: Day = {
  day: 1,
  verseCount: 3,
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
    {
      book: "لوقا",
      chapter: 1,
      start: 1,
      end: 1,
      verses: [{ number: 1, text: "أول" }],
    },
  ],
};
const cues: Cue[] = [
  { passage: 0, verse: 1, start: 0.2, end: 2 },
  { passage: 0, verse: 2, start: 3, end: 6 },
  { passage: 1, verse: 1, start: 6.5, end: 8 },
];
const manifest = async (): Promise<LegacyAudioManifest> => ({
  version: 1,
  day: 1,
  readingHash: await readingHash(reading),
  src: "/audio/days/001-abc123.m4a",
  duration: 9,
  cues,
});

test("The transcript and hash match the golden fixture shared with the Python tools", async () => {
  const golden = JSON.parse(
    readFileSync(
      new URL("./fixtures/transcript.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(readingTranscript(golden.day), golden.transcript);
  assert.equal(await readingHash(golden.day), golden.readingHash);
});

test("Audio matches the precise reading, including repeated passages", async () => {
  const m = await manifest();
  assert.equal(validManifest(m, "1"), true);
  assert.equal(await matchesReading(m, reading), true);
  assert.equal(
    await matchesReading({ ...m, cues: [...cues].reverse() }, reading),
    false,
  );
  assert.equal(
    await matchesReading({ ...m, cues: cues.slice(0, 2) }, reading),
    false,
  );
  const changed = structuredClone(reading);
  changed.passages[0].verses![0].text += " مصحح";
  assert.equal(await matchesReading(m, changed), false);
});

test("Reject wrong days, unsafe asset URLs, overlaps, and out-of-range cues", async () => {
  const m = await manifest();
  assert.equal(validManifest(m, "2"), false);
  for (const src of [
    "javascript:alert(1)",
    "//evil.test/file.mp3",
    "/audio/days/../../file.mp3",
    "https://evil.test/file.mp3",
  ])
    assert.equal(validManifest({ ...m, src }, "1"), false);
  for (const cue of [
    null,
    "invalid",
    { ...cues[1], start: 1 },
    { ...cues[1], end: 10 },
    { ...cues[1], start: NaN },
    { ...cues[1], verse: 0 },
  ])
    assert.equal(
      validManifest({ ...m, cues: [cues[0], cue, cues[2]] }, "1"),
      false,
    );
});

test("Cue lookup respects silence, exact starts, repeated verses and boundaries", () => {
  for (const [time, expected] of [
    [0, 0],
    [2.8, 0],
    [3, 1],
    [6.49, 1],
    [6.5, 2],
    [999, 2],
  ])
    assert.equal(cueAt(cues, time), expected);
});

test("Static hosting and an HTTPS CDN use the same immutable asset path", () => {
  const path = "/audio/days/001-abc.m4a";
  assert.equal(audioUrl(path), path);
  assert.equal(audioUrl(path, "/"), path);
  assert.equal(
    audioUrl(path, "https://audio.example.org"),
    "https://audio.example.org" + path,
  );
  for (const base of [
    "http://audio.example.org",
    "//audio.example.org",
    "/audio",
    "https://user:secret@audio.example.org",
    "https://audio.example.org/private",
    "https://audio.example.org?key=secret",
  ])
    assert.throws(() => audioUrl(path, base));
});

// The production catalog is independently checked without needing media binaries.
test("Every prepared day matches Scripture and has ordered, complete cues", async () => {
  const plan: Day[] = JSON.parse(
    readFileSync(new URL("../data/plan.json", import.meta.url), "utf8"),
  );
  const { days }: { days: number[] } = JSON.parse(
    readFileSync(
      new URL("../data/audio/catalog.json", import.meta.url),
      "utf8",
    ),
  );
  assert.ok(days.length > 0);
  assert.deepEqual(
    [...new Set(days)].sort((a, b) => a - b),
    days,
  );
  for (const day of days) {
    const manifest = JSON.parse(
      readFileSync(
        new URL(`../data/audio/manifests/${day}.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.ok(
      validManifest(manifest, String(day)),
      `Invalid day ${day} timings`,
    );
    const reading = plan.find((r) => r.day === day);
    assert.ok(reading, `Day ${day} is not in the plan`);
    assert.ok(
      await matchesReading(manifest, reading),
      `Stale/incomplete day ${day}`,
    );
  }
});
