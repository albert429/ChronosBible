/** Pure helpers over a loaded chronology catalog; nothing here fetches. */
import type { ChronologicalLocation } from "./types.ts";
import type {
  ChronologicalReadingSummary,
  ChronologyCatalog,
} from "./chronology.ts";

const indexOf = (
  catalog: ChronologyCatalog,
  location: ChronologicalLocation,
) =>
  location.testament === catalog.testament
    ? catalog.readings.findIndex((reading) => reading.id === location.readingId)
    : -1;

const at = (
  catalog: ChronologyCatalog,
  index: number,
): ChronologicalLocation | undefined => {
  const reading = catalog.readings[index];
  return reading
    ? {
        mode: "chronological",
        testament: catalog.testament,
        readingId: reading.id,
      }
    : undefined;
};

/** The catalog's first reading (catalogs are never empty once validated). */
export const firstChronologicalLocation = (
  catalog: ChronologyCatalog,
): ChronologicalLocation => at(catalog, 0)!;

export const chronologicalLocationExists = (
  catalog: ChronologyCatalog,
  location: ChronologicalLocation,
) => indexOf(catalog, location) >= 0;

/**
 * The previous (-1) or next (1) reading, without a verse; undefined at either
 * end, for an unknown id, or for another testament's location.
 */
export function adjacentChronologicalLocation(
  catalog: ChronologyCatalog,
  location: ChronologicalLocation,
  direction: -1 | 1,
): ChronologicalLocation | undefined {
  const index = indexOf(catalog, location);
  return index < 0 ? undefined : at(catalog, index + direction);
}

/**
 * Where «متابعة القراءة» leads: the first unfinished reading from the current
 * one on, else the earliest unfinished; undefined once all are complete.
 */
export function continueReading(
  readings: readonly ChronologicalReadingSummary[],
  current: string,
  done: ReadonlySet<string>,
) {
  const from = Math.max(
    0,
    readings.findIndex((reading) => reading.id === current),
  );
  return (
    readings.slice(from).find((reading) => !done.has(reading.id)) ??
    readings.find((reading) => !done.has(reading.id))
  );
}
