import type { GreekToken, WordToken } from "./types.ts";

export const tokens = (text: string) => text.split(" ");

/**
 * A Greek token without editorial marks or punctuation ("λόγος," → "λόγος"):
 * ASCII and Greek stops (U+0387 ano teleia, U+037E question mark), pilcrows,
 * brackets. Elision marks (U+1FBD, U+2019) belong to the word and stay.
 */
export const greekWord = (word: string) =>
  word
    .replace(/^[[\]]+/, "")
    .replace(/[\s,.;:\u00b7\u0387\u037e\u00b6\u00ac[\]]+$/u, "");
/** An English gloss without a trailing full stop. */
export const gloss = (value: string) => value.replace(/\.$/, "");

/** The Van Dyck words a0..a1, without trailing punctuation or quote marks. */
export function span(text: string, a0: number, a1: number) {
  return tokens(text)
    .slice(a0, a1 + 1)
    .join(" ")
    .replace(/^[«"]+/, "")
    .replace(/[،.:؛!؟,»"]+$/, "");
}

export type GreekGroup<T extends GreekToken | WordToken = GreekToken> = {
  a0: number | null;
  a1: number | null;
  tokens: T[];
};

/** Consecutive tokens translated by the same Arabic words; unaligned tokens stay single. */
export function groupRows<T extends GreekToken | WordToken>(
  g: T[],
): GreekGroup<T>[] {
  const groups: GreekGroup<T>[] = [];
  for (const token of g) {
    const [, , , , , a0, a1] = token;
    const last = groups.at(-1);
    if (last && a0 !== null && last.a0 === a0 && last.a1 === a1)
      last.tokens.push(token);
    else groups.push({ a0, a1, tokens: [token] });
  }
  return groups;
}

// Nouns, verbs, adjectives and interjections carry a verse's meaning; articles,
// pronouns, prepositions, conjunctions, particles and adverbs are left out.
const KEY_MORPH = /^(?:N|V|A|INJ)\b/;

/** Key words only, each Greek word (by Strong's number) listed once per verse. */
export function keyGroups<T extends GreekToken | WordToken>(
  g: T[],
): GreekGroup<T>[] {
  const seen = new Set<string>();
  const result: GreekGroup<T>[] = [];
  for (const group of groupRows(g)) {
    const tokens = group.tokens.filter(([, , strong, morph]) => {
      const key = strong.slice(0, 5);
      if (!KEY_MORPH.test(morph) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (tokens.length) result.push({ ...group, tokens });
  }
  return result;
}

/** Hebrew/Aramaic affixes carry meaning; do not apply Greek part-of-speech filters. */
export function wordGroups(words: WordToken[]) {
  return words.every((word) => word[7] === "grc")
    ? keyGroups(words)
    : groupRows(words);
}

// The OT's Hebrew/Aramaic content words: nouns, verbs and adjectives after the
// language letter (HNcmsa, AVqp3ms); prefixes, particles and suffixes are not.
const OT_CONTENT = /^[HA][NVA]/;

/**
 * Up to `limit` groups that carry a verse's meaning, for an explanation's
 * context: Greek key words, or Hebrew/Aramaic rows with a content word (kept
 * whole, with their affixes, so each Arabic span is explained in full).
 */
export function meaningGroups(words: WordToken[], limit: number) {
  const groups = words.every((word) => word[7] === "grc")
    ? keyGroups(words)
    : groupRows(words).filter((group) =>
        group.tokens.some(([, , , morph]) => OT_CONTENT.test(morph)),
      );
  return groups.slice(0, limit);
}

/**
 * Where Daniel, Ezra and Jeremiah turn to Aramaic in the Leningrad text, by
 * Arabic/KJV reference; Daniel 2:4 changes mid-verse.
 */
const ARAMAIC: [book: string, from: [number, number], to: [number, number]][] =
  [
    ["DAN", [2, 5], [7, 28]],
    ["EZR", [4, 8], [6, 18]],
    ["EZR", [7, 12], [7, 26]],
    ["JER", [10, 11], [10, 11]],
  ];
const atOrAfter = (a: [number, number], b: [number, number]) =>
  a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1]);

/** The words section's title for a verse, known before its words load. */
export function verseWordsTitle(id: string, oldTestament: boolean) {
  if (!oldTestament) return "الكلمات اليونانية";
  if (id === "DAN.2.4") return "الكلمات العبرية والآرامية";
  const [book, chapter, verse] = id.split(".");
  const at: [number, number] = [Number(chapter), Number(verse)];
  return ARAMAIC.some(
    ([name, from, to]) =>
      name === book && atOrAfter(at, from) && atOrAfter(to, at),
  )
    ? "الكلمات الآرامية"
    : "الكلمات العبرية";
}

/** The same title from loaded words (an explanation names their language). */
export function wordsTitle(words: WordToken[]) {
  const languages = new Set(words.map((word) => word[7]));
  if (languages.has("he") && languages.has("arc"))
    return "الكلمات العبرية والآرامية";
  if (languages.has("arc")) return "الكلمات الآرامية";
  if (languages.has("he")) return "الكلمات العبرية";
  return "الكلمات اليونانية";
}

export const originalWord = (word: WordToken) =>
  word[7] === "grc" ? greekWord(word[0]) : word[0];
