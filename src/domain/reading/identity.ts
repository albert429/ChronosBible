/**
 * Canonical reading identity: the four tracks and one key per reading
 * (`plan:N`, `bible:USFM:N`, `chrono:OT|NT:id`), in both directions.
 */
import { catalog } from "../scripture/catalog.ts";
import type { Testament } from "../scripture/types.ts";
import { isChronologyId } from "./chronology.ts";
import { validBibleLocation } from "./location.ts";
import type {
  ReadingLocation,
  ScriptureReading,
  BibleLocation,
  ChronologicalLocation,
  Day,
  PlanLocation,
} from "./types.ts";

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
export const trackOf = (location: ReadingLocation): ReadingTrack =>
  location.mode === "chronological"
    ? chronologicalTrack(location.testament)
    : location.mode;

/**
 * One cache/player/completion identity: `plan:N`, `bible:USFM:N` or
 * `chrono:OT|NT:id`. Readings never masquerade as one another's.
 */
export function readingKey(
  reading: ScriptureReading | ReadingLocation,
): string {
  if ("mode" in reading && reading.mode === "bible")
    return `bible:${"usfm" in reading ? reading.usfm : reading.book}:${reading.chapter}`;
  if ("mode" in reading && reading.mode === "chronological")
    return `chrono:${reading.testament}:${"readingId" in reading ? reading.readingId : reading.id}`;
  return `plan:${(reading as Day | PlanLocation).day}`;
}

export const isTestament = (value: string): value is Testament =>
  value === "OT" || value === "NT";

/** `bible:USFM:N` back to its location, or undefined if malformed or unknown. */
export function chapterKeyLocation(key: string): BibleLocation | undefined {
  const match = /^bible:([A-Z0-9]{3}):([1-9]\d*)$/.exec(key);
  if (!match) return;
  const location: BibleLocation = {
    mode: "bible",
    book: match[1],
    chapter: Number(match[2]),
  };
  return validBibleLocation(catalog, location) ? location : undefined;
}

/** `chrono:OT|NT:<id>` back to its location, or undefined if malformed. */
export function chronologicalKeyLocation(
  key: string,
): ChronologicalLocation | undefined {
  const match = /^chrono:(OT|NT):(.+)$/.exec(key);
  if (!match || !isTestament(match[1]) || !isChronologyId(match[2])) return;
  return { mode: "chronological", testament: match[1], readingId: match[2] };
}

export const sameLocation = (a?: ReadingLocation, b?: ReadingLocation) =>
  !!a && !!b && readingKey(a) === readingKey(b) && a.verse === b.verse;
