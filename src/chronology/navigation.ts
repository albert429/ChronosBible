/** Pure helpers over a loaded chronology catalog; nothing here fetches. */
import type { ChronologicalLocation } from "../bible/types.ts";
import type {
  ChronologicalReadingSummary,
  ChronologyCatalog,
  ChronologyStage,
  ChronologySubstage,
} from "./types.ts";

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

/** A saved place if it is still in this catalog, otherwise the first reading. */
export const resumeChronologicalLocation = (
  catalog: ChronologyCatalog,
  saved?: ChronologicalLocation,
): ChronologicalLocation =>
  saved && chronologicalLocationExists(catalog, saved)
    ? saved
    : firstChronologicalLocation(catalog);

export const chronologicalSummary = (
  catalog: ChronologyCatalog,
  id: string,
): ChronologicalReadingSummary | undefined =>
  catalog.readings.find((reading) => reading.id === id);

/** The stage (and substage, if any) a reading belongs to. */
export function chronologicalStage(
  catalog: ChronologyCatalog,
  id: string,
): { stage: ChronologyStage; substage?: ChronologySubstage } | undefined {
  const reading = chronologicalSummary(catalog, id);
  const stage = catalog.stages.find((s) => s.id === reading?.stageId);
  if (!reading || !stage) return;
  const substage = stage.substages?.find((s) => s.id === reading.substageId);
  return substage ? { stage, substage } : { stage };
}
