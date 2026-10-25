import { isChronologyId } from "../chronology/types.ts";
import { isPlanDay } from "../plan/schedule.ts";
import type {
  AnyReadingLocation,
  BibleBook,
  BibleLocation,
  ChronologicalLocation,
  ReadingLocation,
} from "./types.ts";

export const findBibleBook = (catalog: readonly BibleBook[], code: string) =>
  catalog.find((book) => book.usfm === code);

const validVerse = (verse: unknown) =>
  verse === undefined ||
  (Number.isSafeInteger(verse) && (verse as number) >= 1);

export function validBibleLocation(
  catalog: readonly BibleBook[],
  location: BibleLocation,
): boolean {
  const book = findBibleBook(catalog, location.book);
  return !!(
    book &&
    Number.isInteger(location.chapter) &&
    location.chapter >= 1 &&
    location.chapter <= book.chapters &&
    (location.verse === undefined ||
      (Number.isInteger(location.verse) &&
        location.verse >= 1 &&
        location.verse <= book.verseCounts[location.chapter - 1]))
  );
}

/**
 * The shape of a chronological place. Whether the id exists in its testament's
 * catalog is checked when the reading loads, so no catalog is needed here.
 */
export function validChronologicalLocation(
  location: unknown,
): location is ChronologicalLocation {
  if (!location || typeof location !== "object") return false;
  const value = location as ChronologicalLocation;
  return (
    value.mode === "chronological" &&
    (value.testament === "OT" || value.testament === "NT") &&
    isChronologyId(value.readingId) &&
    validVerse(value.verse)
  );
}

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

const integer = (value: string | null) =>
  value !== null && /^\d+$/.test(value) ? Number(value) : NaN;

/**
 * Parse and validate canonical, chronological (`?mode=chronological&
 * testament=OT&reading=id`) and the existing `?day=N` links.
 */
export function parseAnyReadingLocation(
  search: string,
  catalog: readonly BibleBook[],
): AnyReadingLocation | undefined {
  const query = new URLSearchParams(search);
  const verse = query.has("verse") ? integer(query.get("verse")) : undefined;
  if (verse !== undefined && (!Number.isSafeInteger(verse) || verse < 1))
    return;
  const withVerse = verse === undefined ? {} : { verse };
  const mode = query.get("mode");
  if (mode === "bible") {
    const location: BibleLocation = {
      mode: "bible",
      book: query.get("book") || "",
      chapter: integer(query.get("chapter")),
      ...withVerse,
    };
    return validBibleLocation(catalog, location) ? location : undefined;
  }
  if (mode === "chronological") {
    const location = {
      mode,
      testament: query.get("testament"),
      readingId: query.get("reading"),
      ...withVerse,
    };
    return validChronologicalLocation(location) ? location : undefined;
  }
  if (query.has("mode") && mode !== "plan") return;
  const day = integer(query.get("day"));
  if (isPlanDay(day)) return { mode: "plan", day, ...withVerse };
}

/** Plan and canonical links only, for readers without chronology. */
export function parseReadingLocation(
  search: string,
  catalog: readonly BibleBook[],
): ReadingLocation | undefined {
  const location = parseAnyReadingLocation(search, catalog);
  return location?.mode === "chronological" ? undefined : location;
}

export function readingSearch(location: AnyReadingLocation): string {
  const query = new URLSearchParams();
  if (location.mode === "bible") {
    query.set("mode", "bible");
    query.set("book", location.book);
    query.set("chapter", String(location.chapter));
  } else if (location.mode === "chronological") {
    query.set("mode", "chronological");
    query.set("testament", location.testament);
    query.set("reading", location.readingId);
  } else query.set("day", String(location.day));
  if (location.verse !== undefined) query.set("verse", String(location.verse));
  return `?${query}`;
}
