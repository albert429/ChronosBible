import { catalog } from "../scripture/catalog.ts";
import {
  copyLocation,
  parseReadingLocation,
  validAnyLocation,
  validLocation,
} from "./location.ts";
import type {
  AnyReadingLocation,
  BibleLocation,
  ChronologicalLocation,
  PlanLocation,
  ReadingLocation,
} from "./types.ts";
import { isReadingTrack, trackOf, type ReadingTrack } from "./identity.ts";

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
