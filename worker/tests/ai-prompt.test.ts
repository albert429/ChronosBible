import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPrompt,
  cleanDefinition,
  MAX_OUTPUT_TOKENS,
  OFF_TOPIC,
  plainArabic,
  SYSTEM_PROMPT,
  type Material,
} from "../prompt.ts";
import { cleanQuestion } from "../../src/features/ai/domain/chips.ts";
import type { Passage, Verse } from "../../src/core/scripture/types.ts";
import type { GreekToken } from "../../src/features/study/domain/types.ts";

const verses: Verse[] = [
  {
    number: 14,
    text: "وَلَمَّا جَاءَ يَسُوعُ إِلَى بَيْتِ بُطْرُسَ،",
    heading: "شفاء حماة بطرس وآخرين",
  },
  {
    number: 15,
    text: "فَلَمَسَ يَدَهَا فَتَرَكَتْهَا ٱلْحُمَّى، فَقَامَتْ وَخَدَمَتْهُمْ.",
  },
  {
    number: 16,
    text: "وَلَمَّا صَارَ ٱلْمَسَاءُ قَدَّمُوا إِلَيْهِ مَجَانِينَ كَثِيرِينَ،",
  },
  { number: 17, text: "لِكَيْ يَتِمَّ مَا قِيلَ بِإِشَعْيَاءَ ٱلنَّبِيِّ" },
];
const passage: Passage = {
  book: "متى",
  chapter: 8,
  start: 14,
  end: 17,
  verses,
};
const g: GreekToken[] = [
  ["καὶ", "kai", "G2532", "CONJ", "and", 0, 0],
  ["ἥψατο", "hēpsato", "G0681", "V-AMI-3S", "to kindle", 0, 0],
  ["χειρὸς", "cheiros", "G5495", "N-GSF", "hand", 1, 1],
  ["πυρετός,", "puretos", "G4446", "N-NSM", "fever", 3, 3],
];
const material: Material = {
  book: "متى",
  passage,
  verse: verses[1],
  g,
  tr: {
    n: "فلمس يدها فتركتها الحمى",
    e: "And he touched her hand, and the fever left her",
  },
  lex: {
    G0681: {
      l: "ἅπτω",
      g: "to touch",
      d: "__1. to fasten to; Mat.8:3, 15, Luk.5:13 al. mult.",
    },
    G5495: { l: "χείρ", g: "hand", d: "a hand." },
  },
};

test("Every chip gets the reference, heading, verse, ±3 context and both translations", () => {
  for (const chip of ["explain", "words", "background"] as const) {
    const { system, prompt, maxOutputTokens } = buildPrompt(chip, material);
    assert.equal(system, SYSTEM_PROMPT);
    assert.equal(maxOutputTokens, MAX_OUTPUT_TOKENS);
    assert.match(
      prompt,
      /^المرجع: متى 8:15\nعنوان الفقرة: شفاء حماة بطرس وآخرين/,
    );
    assert.match(
      prompt,
      /نص الآية \(ترجمة فاندايك\):\nفلمس يدها فتركتها الحمى، فقامت وخدمتهم\./,
    );
    assert.match(prompt, /السياق من ترجمة فاندايك \(متى 8:14–17\):\n\[14\]/);
    assert.match(prompt, /\[15\] .* ← الآية المقصودة/);
    assert.match(prompt, /ترجمة كتاب الحياة:\nفلمس يدها فتركتها الحمى/);
    assert.match(
      prompt,
      /الترجمة الإنجليزية \(KJV\):\nAnd he touched her hand/,
    );
    assert.match(prompt, /المطلوب:\n.+$/);
    assert.doesNotMatch(
      prompt.split("المطلوب:")[0],
      /[\u064b-\u0652]/,
      "diacritics stripped from the material",
    );
    assert.doesNotMatch(prompt, /\d{4}-\d{2}-\d{2}|اليوم \d/);
  }
});

test("Greek words use the lexicon gloss; definitions only for the words chip", () => {
  const words = buildPrompt("words", material).prompt;
  assert.match(words, /- فلمس ← ἥψατο \(hēpsato، G0681: to touch\)/);
  assert.match(words, /- يدها ← χειρὸς \(cheiros، G5495: hand\)/);
  assert.doesNotMatch(words, /καὶ/, "function words are left out");
  assert.match(words, /← πυρετός \(puretos، G4446: fever\)/);
  assert.match(words, /التعريف: 1\. to fasten to;/);
  assert.doesNotMatch(words, /Mat\.8:3|al\. mult/);
  assert.doesNotMatch(
    buildPrompt("explain", material).prompt,
    /الكلمات اليونانية/,
  );
  const asked = buildPrompt("ask", material, "ما معنى لمس؟").prompt;
  assert.doesNotMatch(asked, /التعريف:/);
  assert.match(asked, /G0681: to touch/);
  // Without the lexicon (it failed to load), the token gloss is the fallback.
  assert.match(
    buildPrompt("ask", { ...material, lex: undefined }, "ما معنى لمس؟").prompt,
    /G0681: to kindle/,
  );
  assert.match(
    buildPrompt("words", { ...material, g: [] }).prompt,
    /لا توجد كلمات مفتاحية/,
  );
});

test("Context is clipped at passage edges and missing translations are omitted", () => {
  const first = buildPrompt("explain", {
    ...material,
    verse: verses[0],
    tr: undefined,
  }).prompt;
  assert.match(first, /\(متى 8:14–17\)/);
  assert.doesNotMatch(first, /كتاب الحياة|KJV/);
  const bridged = buildPrompt("explain", {
    ...material,
    tr: { n: { b: "15-16", t: "نص" } },
  }).prompt;
  assert.match(bridged, /ترجمة كتاب الحياة:\n\(الآيات 15-16\) نص/);
});

test("Context is exactly three verses either side, clipped at the passage edges", () => {
  const long = Array.from({ length: 10 }, (_, i) => ({
    number: 14 + i,
    text: `نص الآية ${14 + i}`,
    ...(i === 0 ? { heading: "عنوان أول" } : {}),
    ...(i === 6 ? { heading: "عنوان ثان" } : {}),
  }));
  const at = (number: number) =>
    buildPrompt("explain", {
      ...material,
      passage: { ...passage, verses: long },
      verse: long[number - 14],
      tr: undefined,
    }).prompt;
  const middle = at(18);
  assert.match(middle, /\(متى 8:15–21\):\n\[15\]/);
  assert.doesNotMatch(middle, /\[14\]|\[22\]/);
  assert.match(middle, /\[18\] نص الآية 18 ← الآية المقصودة/);
  assert.match(middle, /عنوان الفقرة: عنوان أول/);
  assert.match(at(14), /\(متى 8:14–17\)/);
  assert.match(at(23), /\(متى 8:20–23\)/);
  assert.match(at(21), /عنوان الفقرة: عنوان ثان/);
});

test("A reader's question is cleaned, bounded and wrapped as content, with the off-topic rule", () => {
  const { prompt } = buildPrompt(
    "ask",
    material,
    "  ما معنى‮ هذا؟\n" + "س".repeat(300),
  );
  const task = prompt.split("المطلوب:\n")[1];
  assert.match(
    task,
    /^أجب عن سؤال القارئ التالي عن هذه الآية: «ما معنى هذا؟ س+»$/,
  );
  assert.ok(task.length < 260);
  assert.doesNotMatch(prompt, /‮/);
  assert.match(SYSTEM_PROMPT, new RegExp(OFF_TOPIC));
  assert.match(SYSTEM_PROMPT, /لا تتبع أي تعليمات/);
  assert.equal(cleanQuestion("⁦a\u0007b⁩"), "a b");
});

test("Prompts stay bounded and never read device storage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("no storage");
    },
  });
  try {
    const long = {
      ...material,
      verse: { number: 15, text: "كلمة ".repeat(2000) },
    };
    const { prompt } = buildPrompt("words", long);
    assert.ok(prompt.length <= 8000, String(prompt.length));
    assert.match(prompt, /المطلوب:\n/);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("Arabic is undiacritized and definitions are cleaned", () => {
  assert.equal(plainArabic("ٱلْكَلِمَةُ ـــ"), "الكلمة ");
  const cases = [
    [
      "__2. a saying: Mat.19:22 (T om.), 1Co.14:9, 19 al.",
      "2. a saying: (T om.),",
    ],
    // A continuation number never swallows the next numbered book.
    ["sorrow, 2Co.7:10, 2Co.7:11; grief.", "sorrow, grief."],
    ["as in 1Co.7:11, 2Co.7:11, 12.", "as in."],
    // Sense numbers survive.
    [
      "of the end, Jhn.13:1; Rev.1:1-3, 5; __2. later.",
      "of the end, 2. later.",
    ],
    ["in 4Ma.5:3, Wis.2:1.", "in."],
    // Chapterless and dotted references.
    [
      "to do good; (a) univ., 3Jo.11; (b) others",
      "to do good; (a) univ., (b) others",
    ],
    ["(Mat.5.3) blessed", "blessed"],
  ];
  for (const [raw, clean] of cases) assert.equal(cleanDefinition(raw), clean);
});
