import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answerKey,
  CACHE_KEY,
  isTurnedOff,
  OFF_KEY,
  turnOff,
  turnOn,
  MAX_ENTRIES,
  readAnswer,
  saveAnswer,
} from "../cache.ts";

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const touched = new Set<string>();
  return {
    map,
    touched,
    getItem: (k: string) => (touched.add(k), map.get(k) ?? null),
    setItem: (k: string, v: string) => void (touched.add(k), map.set(k, v)),
    removeItem: (k: string) => void (touched.add(k), map.delete(k)),
  };
}

test("Answers are cached per verse, chip and prompt version with LRU eviction", () => {
  const s = memory();
  for (let i = 0; i < MAX_ENTRIES + 5; i++)
    saveAnswer(
      s,
      answerKey(`MAT.1.${i}`, "explain", 1),
      { text: `a${i}`, model: "m" },
      1,
    );
  assert.equal(readAnswer(s, answerKey("MAT.1.0", "explain", 1)), undefined);
  assert.deepEqual(readAnswer(s, answerKey("MAT.1.5", "explain", 1)), {
    text: "a5",
    model: "m",
  });
  // Reading moved 1.5 to the end, so the next eviction removes 1.6 instead.
  saveAnswer(
    s,
    answerKey("MAT.2.1", "words", 1),
    { text: "w", model: "m", truncated: true },
    1,
  );
  assert.ok(readAnswer(s, answerKey("MAT.1.5", "explain", 1)));
  assert.equal(readAnswer(s, answerKey("MAT.1.6", "explain", 1)), undefined);
  assert.deepEqual(readAnswer(s, answerKey("MAT.2.1", "words", 1)), {
    text: "w",
    model: "m",
    truncated: true,
  });
});

test("A new prompt version drops older answers; total size is bounded", () => {
  const s = memory();
  saveAnswer(
    s,
    answerKey("MAT.1.1", "explain", 1),
    { text: "old", model: "m" },
    1,
  );
  saveAnswer(
    s,
    answerKey("MAT.1.1", "explain", 2),
    { text: "new", model: "m" },
    2,
  );
  assert.equal(readAnswer(s, answerKey("MAT.1.1", "explain", 1)), undefined);
  for (let i = 0; i < 40; i++)
    saveAnswer(
      s,
      answerKey(`JHN.1.${i}`, "explain", 2),
      { text: "x".repeat(6000), model: "m" },
      2,
    );
  const stored: [string, string][] = JSON.parse(s.map.get(CACHE_KEY) ?? "{}").e;
  assert.ok(stored.reduce((n, e) => n + e[1].length, 0) <= 200000);
});

test("Malformed, tampered, blocked or full storage never throws", () => {
  for (const value of ["{", "null", '{"v":1,"e":[[1,2,3]]}', '{"v":2,"e":[]}'])
    assert.equal(readAnswer(memory({ [CACHE_KEY]: value }), "k"), undefined);
  const full = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceeded");
    },
    removeItem: () => {},
  };
  saveAnswer(full, "k|explain|1", { text: "t", model: "m" }, 1);
  assert.equal(readAnswer(null, "k"), undefined);
  saveAnswer(null, "k", { text: "t", model: "m" }, 1);
  assert.equal(isTurnedOff(null), false);
  const throwing = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(readAnswer(throwing, "k"), undefined);
  assert.equal(isTurnedOff(throwing), false);
  turnOff(throwing);
  turnOn(throwing);
});

test("The feature starts on; turning it off removes answers but never progress", () => {
  const s = memory({
    "nt-reading-progress-v1": "{}",
    "nt-ai-consent-v1": "1",
  });
  assert.equal(isTurnedOff(s), false);
  saveAnswer(
    s,
    answerKey("MAT.1.1", "explain", 1),
    { text: "a", model: "m" },
    1,
  );
  turnOff(s);
  assert.equal(s.map.get(OFF_KEY), "1");
  assert.equal(isTurnedOff(s), true);
  assert.equal(s.map.has(CACHE_KEY), false);
  assert.equal(s.map.has("nt-ai-consent-v1"), false);
  assert.equal(s.map.get("nt-reading-progress-v1"), "{}");
  assert.equal(s.touched.has("nt-reading-progress-v1"), false);
  turnOn(s);
  assert.equal(isTurnedOff(s), false);
  assert.equal(s.map.has(OFF_KEY), false);
});

test("Without working storage, the off switch still holds for the session", () => {
  const full = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceeded");
    },
    removeItem: () => {},
  };
  for (const storage of [null, full]) {
    assert.equal(isTurnedOff(storage), false);
    turnOff(storage);
    assert.equal(isTurnedOff(storage), true);
    turnOn(storage);
    assert.equal(isTurnedOff(storage), false);
  }
  // Each storage is separate; a working one keeps the switch only in storage,
  // so turning it back on elsewhere (another tab) takes effect.
  const s = memory();
  turnOff(s);
  s.map.delete(OFF_KEY);
  assert.equal(isTurnedOff(s), false);
});
