import assert from "node:assert/strict";
import { test } from "node:test";
import {
  END_ACTION_LABELS,
  endAction,
  nextEndAction,
} from "../src/audio/endAction.ts";

test("repeating wins; otherwise the continuous preference decides", () => {
  assert.equal(endAction(false, false), "stop");
  assert.equal(endAction(false, true), "next");
  assert.equal(endAction(true, true), "repeat");
  assert.equal(endAction(true, false), "repeat");
});

test("the player cycles stop, next, repeat, with a label for each", () => {
  assert.equal(nextEndAction("stop"), "next");
  assert.equal(nextEndAction("next"), "repeat");
  assert.equal(nextEndAction("repeat"), "stop");
  assert.deepEqual(Object.keys(END_ACTION_LABELS).sort(), [
    "next",
    "repeat",
    "stop",
  ]);
});
