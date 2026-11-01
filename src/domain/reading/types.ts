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
/** Plan days and canonical chapters (the non-chronological tracks). */
export type PlanOrBibleReading = Day | BibleChapter;
/** Every fetched reading, including self-paced chronological readings. */
export type ScriptureReading = PlanOrBibleReading | ChronologicalReading;

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
/**
 * The two places that predate chronology: v1 device places and the
 * chronology-off reader still use it. New code takes `ReadingLocation`.
 */
export type PlanOrBibleLocation = PlanLocation | BibleLocation;
/** A place in any of the four tracks: the one location union. */
export type ReadingLocation = PlanOrBibleLocation | ChronologicalLocation;
export type ReadingMode = ReadingLocation["mode"];

export function isBibleChapter(
  reading: ScriptureReading,
): reading is BibleChapter {
  return "mode" in reading && reading.mode === "bible";
}
export function isChronologicalReading(
  reading: ScriptureReading,
): reading is ChronologicalReading {
  return "mode" in reading && reading.mode === "chronological";
}
