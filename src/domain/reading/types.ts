import type {
  BibleBlock,
  Passage,
  PassageRef,
  Testament,
} from "../scripture/types.ts";
import type { ChronologicalReading } from "./chronology.ts";

/** A youth-plan day in the plan index: its passages, without text. */
export type PlanEntry = {
  day: number;
  verseCount: number;
  passages: PassageRef[];
};
/** A fetched youth-plan day with its Scripture text. */
export type Day = Omit<PlanEntry, "passages"> & { passages: Passage[] };

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
