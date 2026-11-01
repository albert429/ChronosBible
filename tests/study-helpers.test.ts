import { test } from "node:test";
import assert from "node:assert/strict";
import {
  greekWord,
  groupRows,
  keyGroups,
  span,
  tokens,
} from "../src/domain/study/words.ts";
import type { GreekToken } from "../src/domain/study/types.ts";

test("Greek words lose punctuation and editorial marks but keep elision", () => {
  const cases = [
    ["λόγος,", "λόγος"],
    ["λέγων\u0387", "λέγων"], // ano teleia
    ["αὐτοῦ\u037e", "αὐτοῦ"], // Greek question mark
    ["θεοῦ\u00b7", "θεοῦ"],
    ["σωθήσομαι.\u00b6", "σωθήσομαι"],
    ["ἔσται\u037e\u00b6", "ἔσται"],
    ["γῆν.]]", "γῆν"],
    ["[[Καὶ", "Καὶ"],
    ["x,\u00b6\u00ac", "x"],
    ["ἐφ\u1fbd", "ἐφ\u1fbd"], // elision stays
    ["δι\u2019", "δι\u2019"],
  ];
  for (const [raw, word] of cases) assert.equal(greekWord(raw), word, raw);
});

test("Spans join Van Dyck tokens without trailing punctuation", () => {
  const text = "فِي ٱلْبَدْءِ كَانَ ٱلْكَلِمَةُ، وَٱلْكَلِمَةُ «يَا سَيِّدُ».";
  assert.equal(tokens(text).length, 7);
  assert.equal(span(text, 0, 1), "فِي ٱلْبَدْءِ");
  assert.equal(span(text, 3, 3), "ٱلْكَلِمَةُ");
  assert.equal(span(text, 5, 6), "يَا سَيِّدُ");
});

test("Rows group consecutive tokens sharing an Arabic span; unaligned stay single", () => {
  const t = (w: string, a0: number | null, a1: number | null): GreekToken => [
    w,
    "",
    "G1",
    "N",
    "",
    a0,
    a1,
  ];
  const groups = groupRows([
    t("ὁ", 3, 3),
    t("λόγος", 3, 3),
    t("καὶ", 4, 4),
    t("x", null, null),
    t("y", null, null),
    t("z", 3, 3),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.a0, g.tokens.map((x) => x[0]).join(" ")]),
    [
      [3, "ὁ λόγος"],
      [4, "καὶ"],
      [null, "x"],
      [null, "y"],
      [3, "z"],
    ],
  );
});

test("Key words drop function words and repeat each Greek word once", () => {
  const t = (
    w: string,
    strong: string,
    morph: string,
    a0: number | null,
  ): GreekToken => [w, "", strong, morph, "", a0, a0];
  // John 1:1, abridged: Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν … θεὸς
  const groups = keyGroups([
    t("Ἐν", "G1722", "PREP", 0),
    t("ἀρχῇ", "G0746", "N-DSF", 1),
    t("ἦν", "G1510", "V-IAI-3S", 2),
    t("ὁ", "G3588", "T-NSM", 3),
    t("λόγος", "G3056", "N-NSM", 3),
    t("καὶ", "G2532", "CONJ", 4),
    t("ὁ", "G3588", "T-NSM", 4),
    t("λόγος", "G3056", "N-NSM", 4),
    t("πρὸς", "G4314", "PREP", 6),
    t("θεόν", "G2316", "N-ASM", 7),
    t("ἀμήν", "G0281", "INJ", null),
    t("θεὸς", "G2316G", "N-NSM", 9),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.a0, g.tokens.map((x) => x[0]).join(" ")]),
    [
      [1, "ἀρχῇ"],
      [2, "ἦν"],
      [3, "λόγος"],
      [7, "θεόν"],
      [null, "ἀμήν"],
    ],
  );
});
