import { test } from "node:test";
import assert from "node:assert/strict";
import type { WordToken } from "../src/study/types.ts";
import {
  originalWord,
  verseWordsTitle,
  wordGroups,
  wordsTitle,
} from "../src/study/verse.ts";
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
});

test("the words title is known from the reference before the words load", () => {
  const hebrewTitle = "الكلمات العبرية";
  const aramaicTitle = "الكلمات الآرامية";
  for (const [id, title] of [
    ["GEN.1.1", hebrewTitle],
    ["GEN.31.47", hebrewTitle],
    ["DAN.2.3", hebrewTitle],
    ["DAN.2.4", "الكلمات العبرية والآرامية"],
    ["DAN.2.5", aramaicTitle],
    ["DAN.4.1", aramaicTitle],
    ["DAN.7.28", aramaicTitle],
    ["DAN.8.1", hebrewTitle],
    ["EZR.4.7", hebrewTitle],
    ["EZR.4.8", aramaicTitle],
    ["EZR.6.18", aramaicTitle],
    ["EZR.6.19", hebrewTitle],
    ["EZR.7.11", hebrewTitle],
    ["EZR.7.12", aramaicTitle],
    ["EZR.7.26", aramaicTitle],
    ["EZR.7.27", hebrewTitle],
    ["JER.10.10", hebrewTitle],
    ["JER.10.11", aramaicTitle],
    ["JER.10.12", hebrewTitle],
  ])
    assert.equal(verseWordsTitle(id, true), title, id);
  assert.equal(verseWordsTitle("MAT.1.1", false), "الكلمات اليونانية");
});

test("optional AI context labels OT originals correctly and keeps affix meanings", () => {
  const verse = { number: 4, text: "في البدء الملك" };
  const beginning: WordToken = [
    "רֵאשִׁית",
    "re.shit",
    "H7225G",
    "HNcfsa",
    "beginning",
    0,
    1,
    "he",
  ];
  const prompt = buildPrompt("words", {
    book: "دانيال",
    passage: { book: "دانيال", chapter: 2, start: 4, end: 4, verses: [verse] },
    verse,
    words: [hebrew, beginning, aramaic],
  });
  assert.match(prompt.prompt, /الكلمات العبرية والآرامية المهمة/);
  // The preposition stays with the noun it is prefixed to.
  assert.match(prompt.prompt, /H9003: in؛ re.shit، H7225G: beginning/);
  assert.match(prompt.prompt, /H4430: king/);
  assert.doesNotMatch(prompt.prompt + prompt.system, /اليونانية|العهد الجديد/);
});

test("AI context reaches OT content words past the first ten rows", () => {
  const verse = { number: 4, text: Array(13).fill("كلمة").join(" ") };
  // Twelve particle-only rows (as in Psalm 23:4) precede the noun.
  const particles = Array.from({ length: 12 }, (_, index): WordToken => [
    "כִּי",
    "ki",
    "H3588A",
    "HTc",
    "for",
    index,
    index,
    "he",
  ]);
  const staff: WordToken = [
    "מִשְׁעֶנֶת",
    "mish.e.net",
    "H4938",
    "HNcfsc",
    "staff",
    12,
    12,
    "he",
  ];
  const prompt = buildPrompt("words", {
    book: "المزامير",
    passage: {
      book: "المزامير",
      chapter: 23,
      start: 4,
      end: 4,
      verses: [verse],
    },
    verse,
    words: [...particles, staff],
  });
  assert.match(prompt.prompt, /H4938: staff/);
  assert.doesNotMatch(prompt.prompt, /H3588A/);
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
