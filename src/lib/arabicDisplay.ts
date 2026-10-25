/**
 * Display-only Arabic helpers. Source text is never changed: callers apply
 * these to the final strings they render.
 *
 * Removed: fathatan, dammatan, kasratan, fatha, damma, kasra, shadda, sukun
 * (U+064B–U+0652) and the superscript alef (U+0670). The hamza and maddah
 * combining marks (U+0653–U+0655) are meaningful and are kept, as are the
 * precomposed letters آ أ إ ؤ ئ.
 */
const VOWEL_MARKS = /[ً-ْٰ]/g;

export function stripArabicDiacritics(text: string): string {
  return text.replace(VOWEL_MARKS, "");
}

/** The text as displayed: vowel marks removed unless `show` is true. */
export const displayArabic = (text: string, show: boolean): string =>
  show ? text : stripArabicDiacritics(text);
