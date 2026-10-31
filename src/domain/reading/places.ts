import { copyLocation, validReadingLocation } from "./location.ts";
import type {
  ReadingLocation,
  BibleLocation,
  ChronologicalLocation,
  PlanLocation,
} from "./types.ts";
import { isReadingTrack, trackOf, type ReadingTrack } from "./identity.ts";

/** Reader-place contracts: one place per reading track, per reader. */
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
      !validReadingLocation(place) ||
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
): ReadingLocation | undefined {
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
): ReadingLocation {
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
  location: ReadingLocation,
): ReaderPlaces => ({
  track: trackOf(location),
  places: { ...reader.places, [trackOf(location)]: copyLocation(location) },
});
