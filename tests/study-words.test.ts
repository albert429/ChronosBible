import { test } from "node:test";
import assert from "node:assert/strict";
import type { WordToken } from "../src/study/types.ts";
import { originalWord, wordGroups, wordsTitle } from "../src/study/verse.ts";
import { buildPrompt } from "../src/ai/prompt.ts";

const hebrew: WordToken = ["בְּ", "be", "H9003", "HR", "in", 0, 1, "he"];
const aramaic: WordToken = [
  "מַלְכָּא",
  "malka",
  "H4430",
  "ANcbsd",
  "king",
  2,
  2,
  "arc",
];
const greek: WordToken = [
  "λόγος,",
  "logos",
  "G3056",
  "N-NSM",
  "word",
  0,
  0,
  "grc",
];

test("Hebrew affixes and unaligned words remain; Greek key-word filtering is preserved", () => {
  assert.equal(wordGroups([hebrew, aramaic]).length, 2);
  const unaligned: WordToken = [
    ...hebrew.slice(0, 5),
    null,
    null,
    "he",
  ] as WordToken;
  assert.equal(wordGroups([unaligned, unaligned]).length, 2);
  assert.equal(
    wordGroups([
      greek,
      greek,
      ["ὁ", "ho", "G3588", "T-NSM", "the", 0, 0, "grc"],
    ]).length,
    1,
  );
  assert.equal(originalWord(greek), "λόγος");
  assert.equal(originalWord(hebrew), "בְּ");
});

test("verse headings distinguish Hebrew, Aramaic, mixed verses and Greek", () => {
  assert.equal(wordsTitle([hebrew]), "الكلمات العبرية");
  assert.equal(wordsTitle([aramaic]), "الكلمات الآرامية");
  assert.equal(wordsTitle([hebrew, aramaic]), "الكلمات العبرية والآرامية");
  assert.equal(wordsTitle([greek]), "الكلمات اليونانية");
  assert.equal(wordsTitle([], true), "الكلمات العبرية والآرامية");
});

test("optional AI context labels OT originals correctly and keeps affix meanings", () => {
  const verse = { number: 4, text: "في البدء الملك" };
  const prompt = buildPrompt("words", {
    book: "دانيال",
    passage: { book: "دانيال", chapter: 2, start: 4, end: 4, verses: [verse] },
    verse,
    words: [hebrew, aramaic],
  });
  assert.match(prompt.prompt, /الكلمات العبرية والآرامية المهمة/);
  assert.match(prompt.prompt, /H9003: in/);
  assert.match(prompt.prompt, /H4430: king/);
  assert.doesNotMatch(prompt.prompt + prompt.system, /اليونانية|العهد الجديد/);
});

test("missing original words use a neutral AI heading, never assume OT is Greek", () => {
  const verse = { number: 1, text: "في البدء" };
  const prompt = buildPrompt("words", {
    book: "التكوين",
    passage: { book: "التكوين", chapter: 1, start: 1, end: 1, verses: [verse] },
    verse,
    words: [],
  });
  assert.match(prompt.prompt, /الكلمات الأصلية المهمة/);
  assert.doesNotMatch(prompt.prompt, /اليونانية/);
});
