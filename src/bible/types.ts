import type { Day, Passage } from "../plan/readings.ts";
import type { ChronologicalReading } from "../chronology/types.ts";

export type Testament = "OT" | "NT";

export type BibleBook = {
  usfm: string;
  name: string;
  testament: Testament;
  chapters: number;
  verseCounts: number[];
};

/** A source block anchored before a verse, or at a Unicode codepoint within it. */
export type BibleBlock = {
  kind: "heading" | "superscription" | "acrostic" | "paragraph" | "poetry";
  marker: string;
  verse: number;
  offset: number;
  text?: string;
};

export type BibleChapter = {
  mode: "bible";
  usfm: string;
  book: string;
  chapter: number;
  verseCount: number;
  passages: [Passage];
  structure: BibleBlock[];
};
/** What the current reader renders: youth plan days and canonical chapters. */
export type ScriptureReading = Day | BibleChapter;
/** Every fetched reading, including self-paced chronological readings. */
export type AnyScriptureReading = ScriptureReading | ChronologicalReading;

export type PlanLocation = { mode: "plan"; day: number; verse?: number };
export type BibleLocation = {
  mode: "bible";
  book: string;
  chapter: number;
  verse?: number;
};
/** A place in a self-paced chronology; ids are scoped to their testament. */
export type ChronologicalLocation = {
  mode: "chronological";
  testament: Testament;
  readingId: string;
  verse?: number;
};
/** The two places the current reader UI renders (kept for compatibility). */
export type ReadingLocation = PlanLocation | BibleLocation;
export type AnyReadingLocation = ReadingLocation | ChronologicalLocation;
export type ReadingMode = AnyReadingLocation["mode"];

/**
 * The four reading choices. Each reader keeps a separate place and completion
 * per track: the canonical Bible, the youth 150-day plan, and the self-paced
 * Old and New Testament chronologies.
 */
export const READING_TRACKS = [
  "bible",
  "plan",
  "chrono:OT",
  "chrono:NT",
] as const;
export type ReadingTrack = (typeof READING_TRACKS)[number];
export type ChronologicalTrack = `chrono:${Testament}`;

export const isReadingTrack = (value: unknown): value is ReadingTrack =>
  READING_TRACKS.includes(value as ReadingTrack);
export const chronologicalTrack = (testament: Testament): ChronologicalTrack =>
  `chrono:${testament}`;
export const trackOf = (location: AnyReadingLocation): ReadingTrack =>
  location.mode === "chronological"
    ? chronologicalTrack(location.testament)
    : location.mode;

export function isBibleChapter(
  reading: AnyScriptureReading,
): reading is BibleChapter {
  return "mode" in reading && reading.mode === "bible";
}
export function isChronologicalReading(
  reading: AnyScriptureReading,
): reading is ChronologicalReading {
  return "mode" in reading && reading.mode === "chronological";
}

/**
 * One cache/player/completion identity: `plan:N`, `bible:USFM:N` or
 * `chrono:OT|NT:id`. Readings never masquerade as one another's.
 */
export function readingKey(
  reading: AnyScriptureReading | AnyReadingLocation,
): string {
  if ("mode" in reading && reading.mode === "bible")
    return `bible:${"usfm" in reading ? reading.usfm : reading.book}:${reading.chapter}`;
  if ("mode" in reading && reading.mode === "chronological")
    return `chrono:${reading.testament}:${"readingId" in reading ? reading.readingId : reading.id}`;
  return `plan:${(reading as Day | PlanLocation).day}`;
}
