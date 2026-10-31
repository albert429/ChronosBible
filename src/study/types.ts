export type GreekToken = [
  w: string,
  translit: string,
  strong: string,
  morph: string,
  gloss: string,
  a0: number | null,
  a1: number | null,
];
/** A verse's text, or the text of a bridged range ("25-26") it belongs to. */
export type VerseText = string | { b: string; t: string };
/** A Strong's entry: lemma, English gloss and (for Greek) a short definition. */
export type LexEntry = { l: string; g: string; d: string };

/** Original-language token; the first seven fields retain the legacy Greek shape. */
export type WordLanguage = "grc" | "he" | "arc";
export type WordToken = [...GreekToken, language: WordLanguage];
export type StudyRange = { start: number; end: number; key: string };
export type StudyChapterIndex = {
  v: 2;
  book: string;
  chapter: number;
  ranges: StudyRange[];
};
export type StudyWords = {
  v: 2;
  book: string;
  chapter: number;
  start: number;
  end: number;
  verses: Record<string, { w: WordToken[] }>;
};
export type StudyTranslations = {
  v: 2;
  book: string;
  chapter: number;
  start: number;
  end: number;
  verses: Record<string, { n?: VerseText; e?: VerseText }>;
};
export type StudyLexicon = {
  v: 2;
  /** Strong's first three characters, e.g. H00 or G30. */
  shard: string;
  lex: Record<string, LexEntry>;
};
