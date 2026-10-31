// Version-3 playlists: validation against the displayed chronological
// reading, one timeline for every manifest version, and the controller that
// drives one persistent media element through native `ended` events.
import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog } from "../src/bible/catalog.ts";
import type { ChronologicalReading } from "../src/chronology/types.ts";
import {
  activeCueIndex,
  announcementAt,
  audioManifestUrl,
  entryAt,
  matchesReading,
  readingHash,
  stepCueIndex,
  toTimeline,
  validManifest,
  type AudioManifestV2,
  type AudioManifestV3,
  type LegacyAudioManifest,
} from "../src/audio/manifest.ts";
import {
  PlaylistController,
  type MediaLike,
} from "../src/audio/playlistController.ts";
import { audioAvailable } from "../src/audio/availability.ts";
import { constrainedConnection } from "../src/audio/useNextManifest.ts";

const GEN = catalog.find((book) => book.usfm === "GEN")!;
const verses = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    number: from + i,
    text: `نص ${from + i}`,
  }));
const KEY = "chrono:OT:creation";
const reading: ChronologicalReading = {
  mode: "chronological",
  testament: "OT",
  id: "creation",
  stageId: "beginnings",
  title: "الخلق",
  estimatedMinutes: 10,
  verseCount: 34,
  passages: [
    {
      occurrenceId: "o1",
      book: GEN.name,
      chapter: 1,
      start: 1,
      end: 31,
      verses: verses(1, 31),
    },
    {
      occurrenceId: "o2",
      book: GEN.name,
      chapter: 2,
      start: 1,
      end: 3,
      verses: verses(1, 3),
    },
  ],
};
const full = {
  passage: 0,
  book: "GEN",
  chapter: 1,
  from: 1,
  to: 31,
  src: "/audio/chapters/assets/GEN-1-c4e1aeecbd85496dd30e.m4a",
  duration: 376.686,
  alignment: "chapter" as const,
  cues: [],
  announcements: [],
};
const clip = {
  passage: 1,
  book: "GEN",
  chapter: 2,
  from: 1,
  to: 3,
  src: "/audio/clips/GEN-2-1-3-0a1b2c.m4a",
  duration: 30,
  alignment: "verse" as const,
  cues: [
    { verse: 1, start: 0.5, end: 9 },
    { verse: 2, start: 9.5, end: 19 },
    { verse: 3, start: 19.5, end: 29.5 },
  ],
  announcements: [],
};
const playlist = async (): Promise<AudioManifestV3> => ({
  version: 3,
  identity: KEY,
  readingHash: await readingHash(reading),
  duration: full.duration + clip.duration,
  entries: [full, clip],
});

test("A v3 playlist matches its chronological reading exactly", async () => {
  const m = await playlist();
  assert.ok(validManifest(m, KEY));
  assert.ok(await matchesReading(m, reading));
  assert.equal(audioManifestUrl(KEY), "/audio/chrono/OT/creation.json");
  assert.throws(() => audioManifestUrl("chrono:OT:Bad_Id"));
});

test("Invalid or stale playlists are refused", async () => {
  const m = await playlist();
  const entry = (patch: object, index = 1) => ({
    ...m,
    entries: m.entries.map((e, i) => (i === index ? { ...e, ...patch } : e)),
  });
  for (const [label, broken] of [
    ["identity", { ...m, identity: "chrono:OT:other" }],
    ["duration", { ...m, duration: m.duration + 5 }],
    ["empty", { ...m, entries: [], duration: 1 }],
    ["passage index", entry({ passage: 0 })],
    ["clip range in name", entry({ to: 2 })],
    ["foreign clip", entry({ src: "/audio/clips/EXO-2-1-3-0a.m4a" })],
    ["unsafe src", entry({ src: "/audio/clips/../x.m4a" })],
    ["missing verse cue", entry({ cues: clip.cues.slice(0, 2) })],
    ["cue order", entry({ cues: [...clip.cues].reverse() })],
    ["chapter timing with cues", entry({ alignment: "chapter" })],
    ["cue past end", entry({ duration: 20 })],
    [
      "inserted reference",
      entry({
        announcements: [
          { start: 0, end: 0.4, reference: "x", kind: "reference" },
        ],
      }),
    ],
  ] as const)
    assert.equal(validManifest(broken, KEY), false, label);
  // Version mix-ups: a playlist only for chronological keys and vice versa.
  assert.equal(validManifest(m, "bible:GEN:1"), false);
  const chapter: AudioManifestV2 = {
    version: 2,
    identity: "bible:GEN:1",
    book: "GEN",
    chapter: 1,
    readingHash: m.readingHash,
    src: full.src,
    duration: full.duration,
    alignment: "chapter",
    cues: [],
    announcements: [],
  };
  assert.equal(validManifest({ ...chapter, identity: KEY }, KEY), false);

  // Valid shape, but not this reading.
  const changed = structuredClone(reading);
  changed.passages[1].verses[0].text = "نص آخر";
  assert.equal(await matchesReading(m, changed), false, "transcript hash");
  const shorter = structuredClone(reading);
  shorter.passages[0].end = 30;
  shorter.passages[0].verses.pop();
  assert.equal(
    await matchesReading(
      { ...m, entries: [{ ...full, to: 30 }, clip] },
      shorter,
    ),
    false,
    "a whole-chapter file cannot stand for part of a chapter",
  );
  const renamed = structuredClone(reading);
  renamed.passages[0].book = "الخروج";
  assert.equal(await matchesReading(m, renamed), false, "book");
  assert.equal(
    await matchesReading(m, { ...reading, id: "other" }),
    false,
    "identity",
  );
});

test("Every manifest version becomes one timeline", async () => {
  const timeline = toTimeline(await playlist(), KEY);
  assert.deepEqual(
    timeline.entries.map((e) => [e.offset, e.firstCue, e.cueCount]),
    [
      [0, 0, 0],
      [full.duration, 0, 3],
    ],
  );
  assert.equal(timeline.duration, full.duration + clip.duration);
  assert.deepEqual(timeline.cues[0], {
    passage: 1,
    verse: 1,
    start: full.duration + 0.5,
    end: full.duration + 9,
  });
  assert.match(timeline.source, /^playlist:chrono:OT:creation:[0-9a-f]{8}$/);
  // Rebuilt media gets a new resume key; the same media keeps it.
  const again = toTimeline(await playlist(), KEY);
  assert.equal(again.source, timeline.source);
  const rebuilt = await playlist();
  rebuilt.entries[1] = { ...clip, src: "/audio/clips/GEN-2-1-3-ffff.m4a" };
  assert.notEqual(toTimeline(rebuilt, KEY).source, timeline.source);

  const day: LegacyAudioManifest = {
    version: 1,
    day: 1,
    readingHash: "a".repeat(64),
    src: "/audio/days/001-abc.m4a",
    duration: 9,
    cues: [{ passage: 0, verse: 1, start: 0.2, end: 2 }],
  };
  const single = toTimeline(day, "1");
  assert.equal(single.source, day.src, "saved v1/v2 positions keep working");
  assert.equal(single.identity, "plan:1");
  assert.equal(single.entries.length, 1);
  assert.deepEqual(single.announcements, []);
});

test("Verse tracking follows the entry that is playing", async () => {
  const timeline = toTimeline(await playlist(), KEY);
  const at = (t: number) => activeCueIndex(timeline, t);
  // The whole chapter has no verse timing: nothing highlighted, honestly.
  assert.equal(at(10), -1);
  assert.equal(at(full.duration - 0.01), -1);
  // The clip's lead-in shows its first verse, never the previous entry's.
  assert.equal(at(full.duration + 0.1), 0);
  assert.equal(at(full.duration + 10), 1);
  assert.equal(entryAt(timeline, full.duration), 1);
  assert.equal(entryAt(timeline, 10_000), 1);
  // Next verse from the untimed chapter lands on the clip's first verse.
  assert.equal(stepCueIndex(timeline, 10, 1), 0);
  assert.equal(stepCueIndex(timeline, 10, -1), -1);
  assert.equal(announcementAt(timeline, 10), undefined);
});

/** Enough of HTMLMediaElement's load algorithm to exercise the controller. */
class FakeMedia implements MediaLike {
  private source = "";
  currentTime = 0;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  paused = true;
  ended = false;
  error: unknown = null;
  readyState = 0;
  plays = 0;
  sources: string[] = [];
  reject?: Error;
  get src() {
    return this.source;
  }
  set src(value: string) {
    this.source = value;
    this.sources.push(value);
    this.load();
  }
  load() {
    this.currentTime = 0;
    this.ended = false;
    this.error = null;
    this.readyState = 0;
    this.paused = true;
    this.playbackRate = this.defaultPlaybackRate;
  }
  play() {
    this.plays += 1;
    if (this.reject) return Promise.reject(this.reject);
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute(name: string) {
    if (name === "src") this.source = "";
  }
  metadata() {
    this.readyState = 1;
  }
  finish(duration: number) {
    this.currentTime = duration;
    this.paused = true;
    this.ended = true;
  }
}
async function controller() {
  const media = new FakeMedia();
  const player = new PlaylistController((src) => `https://host${src}`);
  player.attach(media);
  const timeline = toTimeline(await playlist(), KEY);
  return { media, player, timeline };
}

test("Native ended advances to the next file in the same task, exactly once", async () => {
  const { media, player, timeline } = await controller();
  player.setTimeline(timeline, 0);
  assert.deepEqual(media.sources, [`https://host${full.src}`]);
  await player.play();
  media.metadata();
  media.finish(full.duration);
  assert.equal(player.ended(), "next");
  // Switched synchronously; the caller plays it once from the same task.
  assert.equal(media.src, `https://host${clip.src}`);
  assert.equal(media.plays, 1, "the controller never plays by itself");
  await player.play();
  assert.equal(media.plays, 2);
  assert.equal(player.entry, 1);
  assert.equal(player.time(), full.duration);
  // A duplicate or late ended for the previous file is ignored.
  assert.equal(player.ended(), "ignored");
  assert.equal(media.sources.length, 2);
  media.metadata();
  media.finish(clip.duration);
  assert.equal(player.ended(), "finished");
  assert.equal(player.ended(), "ignored", "the end is reported once");
  // Play after the end starts the reading again from its first file.
  await player.play();
  assert.equal(media.src, `https://host${full.src}`);
  assert.equal(player.time(), 0);
});

test("Replaying an ended single-file reading loads its file afresh", async () => {
  const media = new FakeMedia();
  const player = new PlaylistController((src) => `https://host${src}`);
  player.attach(media);
  const day: LegacyAudioManifest = {
    version: 1,
    day: 1,
    readingHash: "a".repeat(64),
    src: "/audio/days/001-abc.m4a",
    duration: 9,
    cues: [{ passage: 0, verse: 1, start: 0.2, end: 2 }],
  };
  player.setTimeline(toTimeline(day, "1"), 0);
  await player.play();
  media.metadata();
  media.finish(day.duration);
  assert.equal(player.ended(), "finished");
  // Not a seek back on the ended file (WebKit may stall there).
  await player.play();
  assert.deepEqual(media.sources, [
    `https://host${day.src}`,
    `https://host${day.src}`,
  ]);
  assert.equal(media.ended, false);
  assert.equal(player.time(), 0);
  assert.equal(media.plays, 2);
});

test("Seeks cross files, apply after metadata, and keep the speed", async () => {
  const media = new FakeMedia();
  const player = new PlaylistController((src) => `https://host${src}`);
  const timeline = toTimeline(await playlist(), KEY);
  // The speed was chosen before this element existed (or it was replaced).
  player.setRate(1.5);
  player.attach(media);
  player.setTimeline(timeline, 0);
  await player.play();
  media.metadata();
  player.seek(full.duration + 12);
  assert.equal(media.src, `https://host${clip.src}`);
  assert.equal(media.playbackRate, 1.5, "loading resets the rate");
  assert.equal(media.defaultPlaybackRate, 1.5);
  assert.equal(player.time(), full.duration + 12, "pending target shown");
  assert.equal(media.currentTime, 0);
  media.metadata();
  player.loadedMetadata();
  assert.equal(media.currentTime, 12);
  // A seek inside the loaded file moves in place, without reloading.
  player.seek(full.duration + 20);
  assert.equal(media.sources.length, 2);
  assert.equal(media.currentTime, 20);
  // Positions are clamped to the reading.
  player.seek(-5);
  assert.equal(player.time(), 0);
  player.seek(1e9);
  assert.ok(player.time() < timeline.duration);
});

test("Resume restores the saved timeline position in the right file", async () => {
  const { media, player, timeline } = await controller();
  player.setTimeline(timeline, full.duration + 15);
  assert.equal(media.src, `https://host${clip.src}`);
  assert.equal(player.time(), full.duration + 15);
  media.metadata();
  player.loadedMetadata();
  assert.equal(media.currentTime, 15);
});

test("Retry after a network error reloads the same file at the same place", async () => {
  const { media, player, timeline } = await controller();
  player.setTimeline(timeline, 0);
  await player.play();
  media.metadata();
  player.seek(full.duration + 14);
  media.metadata();
  player.loadedMetadata();
  media.currentTime = 16.5;
  player.timeUpdate();
  // The connection drops: the element reports an error and position 0.
  media.error = { code: 2 };
  media.currentTime = 0;
  assert.equal(player.time(), full.duration + 16.5, "known place kept");
  const before = media.sources.length;
  await player.play();
  assert.equal(media.sources.length, before + 1, "reloaded once");
  assert.equal(media.src, `https://host${clip.src}`);
  assert.equal(player.entry, 1);
  assert.equal(player.time(), full.duration + 16.5);
  media.metadata();
  player.loadedMetadata();
  assert.equal(media.currentTime, 16.5);
});

test("A rejected next-entry play keeps the place and a retry reuses the element", async () => {
  const { media, player, timeline } = await controller();
  player.setTimeline(timeline, 0);
  await player.play();
  media.metadata();
  media.finish(full.duration);
  assert.equal(player.ended(), "next");
  media.reject = new Error("blocked");
  await assert.rejects(player.play(), /blocked/);
  assert.equal(player.entry, 1);
  assert.equal(media.src, `https://host${clip.src}`);
  assert.equal(player.time(), full.duration);
  assert.equal(player.ended(), "ignored", "a late duplicate ended is stale");
  media.reject = undefined;
  await player.play();
  assert.equal(media.paused, false);
  assert.equal(media.src, `https://host${clip.src}`);
  assert.equal(media.sources.length, 2, "retry loads nothing new");
  assert.equal(player.entry, 1);
});

test("Navigation replaces or releases the reading; stale events do nothing", async () => {
  const { media, player, timeline } = await controller();
  player.setTimeline(timeline, 0);
  await player.play();
  media.finish(full.duration);
  // The reader moved on before the ended event was handled.
  const day = toTimeline(
    {
      version: 1,
      day: 1,
      readingHash: "a".repeat(64),
      src: "/audio/days/001-abc.m4a",
      duration: 9,
      cues: [{ passage: 0, verse: 1, start: 0, end: 9 }],
    },
    "1",
  );
  player.setTimeline(day, 0);
  assert.equal(player.ended(), "ignored");
  assert.equal(media.src, "https://host/audio/days/001-abc.m4a");
  assert.equal(media.paused, true, "a new reading never plays by itself");
  player.detach();
  assert.equal(media.src, "");
  assert.equal(player.ended(), "ignored");
  assert.equal(player.time(), 0);
});

test("Listen availability: chronological readings need a verified playlist", () => {
  const advertised = {
    days: [1, 3],
    chapters: "1" + "0".repeat(1188),
    readings: [KEY],
  };
  assert.ok(audioAvailable({ mode: "plan", day: 1 }, advertised));
  assert.ok(!audioAvailable({ mode: "plan", day: 2 }, advertised));
  assert.ok(
    audioAvailable({ mode: "bible", book: "GEN", chapter: 1 }, advertised),
  );
  assert.ok(
    !audioAvailable({ mode: "bible", book: "GEN", chapter: 2 }, advertised),
  );
  assert.ok(audioAvailable(reading, advertised));
  assert.ok(
    audioAvailable(
      { mode: "chronological", testament: "OT", readingId: "creation" },
      advertised,
    ),
  );
  // Same id in the other testament is a different reading.
  assert.ok(
    !audioAvailable(
      { mode: "chronological", testament: "NT", readingId: "creation" },
      advertised,
    ),
  );
  // A day object (no mode) is a plan reading.
  assert.ok(
    audioAvailable({ day: 3, verseCount: 1, passages: [] }, advertised),
  );
});

test("Metadata prefetch respects Save-Data and very slow connections", () => {
  assert.equal(constrainedConnection(undefined), false);
  assert.equal(constrainedConnection({ effectiveType: "4g" }), false);
  assert.equal(constrainedConnection({ saveData: true }), true);
  assert.equal(constrainedConnection({ effectiveType: "2g" }), true);
  assert.equal(constrainedConnection({ effectiveType: "slow-2g" }), true);
});
