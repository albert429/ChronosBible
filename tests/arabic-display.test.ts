import assert from "node:assert/strict";
import { test } from "node:test";
import {
  displayArabic,
  stripArabicDiacritics,
} from "../src/lib/arabicDisplay.ts";

test("strips vowel marks, tanwin, shadda, sukun and superscript alef", () => {
  assert.equal(stripArabicDiacritics("فِي ٱلْبَدْءِ"), "في ٱلبدء");
  assert.equal(
    stripArabicDiacritics("كَلِمَةً وَكُتُبٌ بِرٍّ"),
    "كلمة وكتب بر",
  );
  assert.equal(stripArabicDiacritics("ٱلرَّحْمَٰنِ"), "ٱلرحمن");
  for (let code = 0x64b; code <= 0x652; code++)
    assert.equal(stripArabicDiacritics(`ب${String.fromCharCode(code)}`), "ب");
});

test("keeps letters, hamza and maddah, precomposed and combining", () => {
  const kept = "آ أ إ ؤ ئ ء ٱ ة ى";
  assert.equal(stripArabicDiacritics(kept), kept);
  // Combining maddah, hamza above and hamza below are meaningful.
  const combining = "آ أ إ ؤ";
  assert.equal(stripArabicDiacritics(combining), combining);
  assert.equal(stripArabicDiacritics("أَنَّ إِلَىٰ آمَنَ"), "أن إلى آمن");
});

test("leaves punctuation, digits, Latin and other marks alone", () => {
  const text = "٣ ، ؟ abc 1:2 é";
  assert.equal(stripArabicDiacritics(text), text);
});

test("displayArabic only transforms when marks are hidden", () => {
  const source = "ٱللَّهُ";
  assert.equal(displayArabic(source, true), source);
  assert.equal(displayArabic(source, false), "ٱلله");
  assert.equal(source, "ٱللَّهُ");
});
