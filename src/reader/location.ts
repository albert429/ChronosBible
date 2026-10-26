import { catalog } from "../bible/catalog.ts";
import {
  parseReadingLocation,
  readingSearch,
  validBibleLocation,
  validChronologicalLocation,
} from "../bible/navigation.ts";
import {
  isReadingTrack,
  readingKey,
  trackOf,
  type AnyReadingLocation,
  type BibleLocation,
  type ChronologicalLocation,
  type PlanLocation,
  type ReadingLocation,
  type ReadingTrack,
} from "../bible/types.ts";
import { isPlanDay } from "../plan/schedule.ts";

/** Legacy (v1) device places; read only to migrate into the v2 state. */
export const LOCATION_KEY = "bible-reader-location-v1";
/** The last mode and place in each mode on this device; never plan progress. */
export type ReaderPreferences = {
  version: 1;
  mode: "plan" | "bible";
  /** Each reader's last plan place, by reader id ("" without a reader). */
  plans: Record<string, PlanLocation>;
  bible: BibleLocation;
  continuous: boolean;
};
const MAX_READERS = 20;
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
const validPlans = (value: unknown) =>
  Object.fromEntries(
    Object.entries(
      value && typeof value === "object" && !Array.isArray(value) ? value : {},
    )
      .filter(
        ([reader, place]) =>
          reader.length <= 100 &&
          validLocation(place) &&
          (place as ReadingLocation).mode === "plan",
      )
      .slice(-MAX_READERS),
  ) as Record<string, PlanLocation>;
export function loadPreferences(raw?: string | null): ReaderPreferences {
  const initial: ReaderPreferences = {
    version: 1,
    mode: "plan",
    plans: {},
    bible: { mode: "bible", book: "GEN", chapter: 1 },
    continuous: false,
  };
  try {
    const saved: unknown = JSON.parse(raw ?? "null");
    if (!saved || typeof saved !== "object") return initial;
    const value = saved as Partial<ReaderPreferences>;
    if (value.version !== 1) return initial;
    return {
      ...initial,
      mode: value.mode === "bible" ? "bible" : "plan",
      plans: validPlans(value.plans),
      bible:
        validLocation(value.bible) && value.bible.mode === "bible"
          ? value.bible
          : initial.bible,
      continuous: value.continuous === true,
    };
  } catch {
    return initial;
  }
}
/** A reader's last plan place, or their scheduled day before they have one. */
export const planLocation = (
  preferences: ReaderPreferences,
  reader: string,
  scheduled: number,
): PlanLocation =>
  // Own properties only: ids such as "constructor" or "__proto__" are valid.
  (Object.prototype.hasOwnProperty.call(preferences.plans, reader)
    ? preferences.plans[reader]
    : undefined) ?? { mode: "plan", day: scheduled };
/** Move to a place; a plan place belongs to the active reader only. */
export function withLocation(
  preferences: ReaderPreferences,
  reader: string,
  location: ReadingLocation,
): ReaderPreferences {
  if (location.mode === "bible")
    return { ...preferences, mode: "bible", bible: location };
  const others = Object.entries(preferences.plans).filter(
    ([id]) => id !== reader,
  );
  return {
    ...preferences,
    mode: "plan",
    plans: {
      ...Object.fromEntries(others.slice(-(MAX_READERS - 1))),
      [reader]: location,
    },
  };
}
export function initialPreferences(
  reader: string,
  search: string,
  raw?: string | null,
) {
  const saved = loadPreferences(raw);
  const linked = parseReadingLocation(search, catalog);
  return linked ? withLocation(saved, reader, linked) : saved;
}
export const sameLocation = (a?: AnyReadingLocation, b?: AnyReadingLocation) =>
  !!a && !!b && readingKey(a) === readingKey(b) && a.verse === b.verse;
/**
 * The address for a place reached inside the app. Canonical chapters get a
 * shareable static link. Plan days stay at the bare app URL, so a home-screen
 * shortcut cannot pin one day; the stored place reopens it instead. An
 * explicit ?day= link is kept while it is current.
 */
export const locationSearch = (location: AnyReadingLocation) =>
  location.mode === "plan" ? "" : readingSearch(location);

/* ---- v2: one place per reading track, per reader ---- */

export const FIRST_CHAPTER: BibleLocation = {
  mode: "bible",
  book: "GEN",
  chapter: 1,
};
/** The last place in each track; a missing track has not been opened yet. */
export type TrackPlaces = {
  bible?: BibleLocation;
  plan?: PlanLocation;
  "chrono:OT"?: ChronologicalLocation;
  "chrono:NT"?: ChronologicalLocation;
};
/** A reader's current reading choice and their place in every track. */
export type ReaderPlaces = { track: ReadingTrack; places: TrackPlaces };
/** No saved state at all: the canonical Bible at Genesis 1. */
export const freshPlaces = (): ReaderPlaces => ({ track: "bible", places: {} });

export const validAnyLocation = (value: unknown): value is AnyReadingLocation =>
  validLocation(value) || validChronologicalLocation(value);

const copyLocation = (location: AnyReadingLocation): AnyReadingLocation =>
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
 * Strictly validated places, rebuilt from known fields only; undefined when
 * anything is unknown, malformed or filed under another track.
 */
export function parseTrackPlaces(value: unknown): TrackPlaces | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const places: TrackPlaces = {};
  for (const [track, place] of Object.entries(value)) {
    if (
      !isReadingTrack(track) ||
      !validAnyLocation(place) ||
      trackOf(place) !== track
    )
      return;
    Object.assign(places, { [track]: copyLocation(place) });
  }
  return places;
}
export function parseReaderPlaces(value: unknown): ReaderPlaces | undefined {
  if (!value || typeof value !== "object") return;
  const { track, places } = value as Partial<ReaderPlaces>;
  const parsed = parseTrackPlaces(places);
  if (!isReadingTrack(track) || !parsed) return;
  return { track, places: parsed };
}

/**
 * The saved place in a track. The youth plan opens on the reader's scheduled
 * day and the Bible at Genesis 1 until visited; a chronology has no place
 * until one of its readings is opened (callers supply the catalog's first).
 */
export function trackPlace(
  reader: ReaderPlaces,
  track: ReadingTrack,
  scheduled: number,
): AnyReadingLocation | undefined {
  const saved = reader.places[track];
  if (saved) return saved;
  if (track === "plan") return { mode: "plan", day: scheduled };
  if (track === "bible") return FIRST_CHAPTER;
}
/**
 * Where the reader is now. Without chronology support, or before a
 * chronology has a place, the Bible place stands in.
 */
export function currentPlace(
  reader: ReaderPlaces,
  scheduled: number,
  chronological = true,
): AnyReadingLocation {
  const track =
    !chronological && reader.track.startsWith("chrono:")
      ? "bible"
      : reader.track;
  return (
    trackPlace(reader, track, scheduled) ??
    (trackPlace(reader, "bible", scheduled) as BibleLocation)
  );
}
/** Move within, or switch to, the location's own track. */
export const withPlace = (
  reader: ReaderPlaces,
  location: AnyReadingLocation,
): ReaderPlaces => ({
  track: trackOf(location),
  places: { ...reader.places, [trackOf(location)]: copyLocation(location) },
});
/** Legacy v1 preferences as one reader's v2 places. */
export function placesFromPreferences(
  preferences: ReaderPreferences,
  reader: string,
): ReaderPlaces {
  const plan = Object.prototype.hasOwnProperty.call(preferences.plans, reader)
    ? preferences.plans[reader]
    : undefined;
  return {
    track: preferences.mode,
    places: { bible: preferences.bible, ...(plan ? { plan } : {}) },
  };
}

const POSITION_KEY = "bible-reader-audio-position-v1";
export function playbackPosition(identity: string): number {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || "{}");
    const value = saved[identity];
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : 0;
  } catch {
    return 0;
  }
}
export function savePlaybackPosition(identity: string, seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || "{}");
    const entries = Object.entries(
      saved && typeof saved === "object" ? saved : {},
    )
      .filter(([key]) => key !== identity)
      .slice(-19);
    localStorage.setItem(
      POSITION_KEY,
      JSON.stringify({ ...Object.fromEntries(entries), [identity]: seconds }),
    );
  } catch {
    /* Reading remains usable when storage is blocked. */
  }
}

/** Where a reader was in each recent reading: its top visible verse. */
export type ReadingPosition = {
  passage: number;
  verse: number;
  /** How far down that verse the view began, in thousandths of its height. */
  offset: number;
};
const SCROLL_KEY = "bible-reader-scroll-v1";
const SCROLL_LIMIT = 50;
const validPosition = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((n) => Number.isSafeInteger(n) && n >= 0) &&
  value[2] <= 1000;
function savedPositions(): Record<string, unknown> {
  try {
    const saved = JSON.parse(localStorage.getItem(SCROLL_KEY) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved)
      ? saved
      : {};
  } catch {
    return {};
  }
}
export function readingPosition(identity: string): ReadingPosition | undefined {
  const value = savedPositions()[identity];
  return validPosition(value)
    ? { passage: value[0], verse: value[1], offset: value[2] }
    : undefined;
}
/** Remembers a position; none (the reading's start) forgets it. */
export function saveReadingPosition(
  identity: string,
  position: ReadingPosition | undefined,
) {
  const saved = savedPositions();
  if (!position && !(identity in saved)) return;
  const entries = Object.entries(saved)
    .filter(([key]) => key !== identity)
    .slice(-(SCROLL_LIMIT - 1));
  if (position)
    entries.push([
      identity,
      [position.passage, position.verse, position.offset],
    ]);
  try {
    localStorage.setItem(
      SCROLL_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    /* Reading remains usable when storage is blocked. */
  }
}
