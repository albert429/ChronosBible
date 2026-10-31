import { catalog, findBibleBook } from "../scripture/catalog.ts";
import { isChronologyId } from "./chronology.ts";
import { isPlanDay } from "./schedule.ts";
import type {
  AnyReadingLocation,
  BibleLocation,
  ChronologicalLocation,
  ReadingLocation,
} from "./types.ts";
import type { BibleBook } from "../scripture/types.ts";

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

export function validLocation(value: unknown): value is ReadingLocation {
  if (!value || typeof value !== "object") return false;
  const location = value as ReadingLocation;
  if (location.mode === "bible") return validBibleLocation(catalog, location);
  return (
    location.mode === "plan" &&
    isPlanDay(location.day) &&
    (location.verse === undefined ||
      (Number.isSafeInteger(location.verse) && location.verse > 0))
  );
}
export const validAnyLocation = (value: unknown): value is AnyReadingLocation =>
  validLocation(value) || validChronologicalLocation(value);

export const copyLocation = (
  location: AnyReadingLocation,
): AnyReadingLocation =>
  location.mode === "plan"
    ? { mode: "plan", day: location.day, ...verseOf(location) }
    : location.mode === "bible"
      ? {
          mode: "bible",
          book: location.book,
          chapter: location.chapter,
          ...verseOf(location),
        }
      : {
          mode: "chronological",
          testament: location.testament,
          readingId: location.readingId,
          ...verseOf(location),
        };
const verseOf = (location: AnyReadingLocation) =>
  location.verse === undefined ? {} : { verse: location.verse };

/**
 * The address for a place reached inside the app. Canonical chapters get a
 * shareable static link. Plan days stay at the bare app URL, so a home-screen
 * shortcut cannot pin one day; the stored place reopens it instead. An
 * explicit ?day= link is kept while it is current.
 */
export const locationSearch = (location: AnyReadingLocation) =>
  location.mode === "plan" ? "" : readingSearch(location);
