/**
 * Scripture primitives shared by every reading track, study and audio. Pure
 * types: nothing here loads, stores or renders text.
 */
export type Testament = "OT" | "NT";

export type BibleBook = {
  usfm: string;
  name: string;
  testament: Testament;
  chapters: number;
  verseCounts: number[];
};

export type Verse = { number: number; text: string; heading?: string };

/** A verse range `start`–`end` in one chapter. */
export type PassageRef = {
  book: string;
  chapter: number;
  start: number;
  end: number;
};
export type Passage = PassageRef & { verses: Verse[] };

/** A source block anchored before a verse, or at a Unicode codepoint within it. */
export type BibleBlock = {
  kind: "heading" | "superscription" | "acrostic" | "paragraph" | "poetry";
  marker: string;
  verse: number;
  offset: number;
  text?: string;
};
