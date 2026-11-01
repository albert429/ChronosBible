import { catalog } from "../scripture/catalog.ts";
import type { BibleBook } from "../scripture/types.ts";
import { validBibleLocation } from "./location.ts";
import type { ReadingLocation, BibleLocation } from "./types.ts";
import { adjacentChronologicalLocation } from "./chronologyCatalog.ts";
import type { ChronologyCatalog } from "./chronology.ts";
import { PLAN_DAYS } from "./schedule.ts";

/** Returns undefined at Genesis 1 / Revelation 22 instead of wrapping around. */
export function adjacentChapter(
  catalog: readonly BibleBook[],
  location: BibleLocation,
  direction: -1 | 1,
): BibleLocation | undefined {
  if (!validBibleLocation(catalog, location)) return;
  const index = catalog.findIndex((book) => book.usfm === location.book);
  const book = catalog[index];
  const chapter = location.chapter + direction;
  if (chapter >= 1 && chapter <= book.chapters)
    return { mode: "bible", book: book.usfm, chapter };
  const next = catalog[index + direction];
  if (next)
    return {
      mode: "bible",
      book: next.usfm,
      chapter: direction === 1 ? 1 : next.chapters,
    };
}

/**
 * The previous (-1) or next (1) place in the same mode: never crosses into
 * another mode, and undefined at either end or before a chronology loads.
 */
export function adjacentLocation(
  location: ReadingLocation,
  direction: -1 | 1,
  chronology?: ChronologyCatalog,
): ReadingLocation | undefined {
  if (location.mode === "bible")
    return adjacentChapter(catalog, location, direction);
  if (location.mode === "chronological")
    return chronology
      ? adjacentChronologicalLocation(chronology, location, direction)
      : undefined;
  const day = location.day + direction;
  return day >= 1 && day <= PLAN_DAYS ? { mode: "plan", day } : undefined;
}
