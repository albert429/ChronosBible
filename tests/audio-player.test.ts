import { test } from "node:test";
import assert from "node:assert/strict";
import { scrollDelta } from "../src/features/audio/highlightScroll.ts";
import {
  initialMediaState,
  isPlaying,
  isWaiting,
  mediaReducer,
  type MediaAction,
  type MediaState,
  type MediaStatus,
} from "../src/features/audio/mediaStatus.ts";
import { nextRate } from "../src/features/audio/speed.ts";

const run = (actions: MediaAction[], from: MediaState = initialMediaState) =>
  actions.reduce(mediaReducer, from);
const at = (status: MediaStatus, error = ""): MediaState => ({
  status,
  error,
});

test("nextRate cycles through the speeds and wraps", () => {
  assert.equal(nextRate(0.75), 1);
  assert.equal(nextRate(1), 1.25);
  assert.equal(nextRate(1.25), 1.5);
  assert.equal(nextRate(1.5), 0.75);
  assert.equal(nextRate(2), 0.75);
});

const view = { viewportHeight: 800 };

test("scrollDelta leaves a verse that is already in view", () => {
  assert.equal(
    scrollDelta({
      verseTop: 200,
      verseBottom: 300,
      topbarBottom: 56,
      playerTop: 700,
      ...view,
    }),
    null,
  );
});

test("scrollDelta brings a verse above the top bar to just below it", () => {
  assert.equal(
    scrollDelta({
      verseTop: 10,
      verseBottom: 90,
      topbarBottom: 56,
      playerTop: 700,
      ...view,
    }),
    10 - 72,
  );
});

test("scrollDelta scrolls a verse hidden behind the player", () => {
  assert.equal(
    scrollDelta({
      verseTop: 650,
      verseBottom: 720,
      topbarBottom: 56,
      playerTop: 700,
      ...view,
    }),
    650 - 72,
  );
});

test("scrollDelta keeps a 24px gap above the player", () => {
  const input = {
    verseTop: 400,
    topbarBottom: 56,
    playerTop: 700,
    ...view,
  };
  assert.equal(scrollDelta({ ...input, verseBottom: 676 }), null);
  assert.equal(scrollDelta({ ...input, verseBottom: 677 }), 400 - 72);
});

test("scrollDelta falls back to fixed geometry when the bars are missing", () => {
  const input = { verseTop: 100, verseBottom: 200, ...view };
  assert.equal(scrollDelta(input), null);
  assert.equal(scrollDelta({ ...input, verseTop: 60 }), 60 - 64);
  assert.equal(scrollDelta({ ...input, verseBottom: 777 }), 100 - 64);
  assert.equal(scrollDelta({ ...input, verseBottom: 776 }), null);
  assert.equal(
    scrollDelta({ ...input, topbarBottom: 0, playerTop: 0, verseTop: 60 }),
    60 - 64,
  );
});

test("status helpers map each status to playing and waiting", () => {
  const flags = (s: MediaStatus) => [isPlaying(s), isWaiting(s)];
  assert.deepEqual(flags("idle"), [false, false]);
  assert.deepEqual(flags("loading"), [false, true]);
  assert.deepEqual(flags("playing"), [true, false]);
  assert.deepEqual(flags("buffering"), [true, true]);
  assert.deepEqual(flags("ended"), [false, false]);
});

test("a normal play goes idle, loading, playing", () => {
  assert.equal(run([{ type: "request" }]).status, "loading");
  assert.equal(
    run([{ type: "request" }, { type: "playing" }, { type: "started" }]).status,
    "playing",
  );
});

test("a request clears the error and keeps playing audio buffering", () => {
  assert.deepEqual(mediaReducer(at("idle", "boom"), { type: "request" }), {
    status: "loading",
    error: "",
  });
  assert.equal(
    mediaReducer(at("playing"), { type: "request" }).status,
    "buffering",
  );
  assert.equal(
    mediaReducer(at("ended"), { type: "request" }).status,
    "loading",
  );
});

test("a stall while playing buffers, and playing resumes it", () => {
  const stalled = run([{ type: "waiting" }], at("playing"));
  assert.equal(stalled.status, "buffering");
  assert.equal(mediaReducer(stalled, { type: "playing" }).status, "playing");
  assert.equal(mediaReducer(at("idle"), { type: "waiting" }).status, "loading");
});

test("a stall after the recording ended is ignored", () => {
  const ended = at("ended");
  assert.equal(mediaReducer(ended, { type: "waiting" }), ended);
});

test("pausing stops playing and waiting but keeps an existing error", () => {
  assert.deepEqual(mediaReducer(at("buffering", "old"), { type: "paused" }), {
    status: "idle",
    error: "old",
  });
  assert.deepEqual(
    mediaReducer(at("loading"), { type: "paused", message: "failed" }),
    { status: "idle", error: "failed" },
  );
});

test("the pause event that precedes ended does not undo the ended state", () => {
  const state = run([{ type: "paused" }, { type: "ended" }], at("playing"));
  assert.equal(state.status, "ended");
  assert.equal(mediaReducer(state, { type: "paused" }).status, "ended");
});

test("seeking leaves the ended state; elsewhere it changes nothing", () => {
  assert.equal(mediaReducer(at("ended"), { type: "seeked" }).status, "idle");
  const playing = at("playing");
  assert.equal(mediaReducer(playing, { type: "seeked" }), playing);
});

test("a resolved play settles waiting without claiming playback", () => {
  assert.equal(
    mediaReducer(at("buffering"), { type: "started" }).status,
    "playing",
  );
  assert.equal(mediaReducer(at("loading"), { type: "started" }).status, "idle");
});

test("clearError drops the message only", () => {
  assert.deepEqual(
    mediaReducer(at("idle", "x"), { type: "clearError" }),
    at("idle"),
  );
});
