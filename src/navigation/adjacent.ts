import { catalog } from "../bible/catalog.ts";
import { adjacentChapter } from "../bible/navigation.ts";
import type { AnyReadingLocation } from "../bible/types.ts";
import { adjacentChronologicalLocation } from "../chronology/navigation.ts";
import type { ChronologyCatalog } from "../chronology/types.ts";
import { PLAN_DAYS } from "../plan/schedule.ts";

/**
 * The previous (-1) or next (1) place in the same mode: never crosses into
 * another mode, and undefined at either end or before a chronology loads.
 */
export function adjacentLocation(
  location: AnyReadingLocation,
  direction: -1 | 1,
  chronology?: ChronologyCatalog,
): AnyReadingLocation | undefined {
  if (location.mode === "bible")
    return adjacentChapter(catalog, location, direction);
  if (location.mode === "chronological")
    return chronology
      ? adjacentChronologicalLocation(chronology, location, direction)
      : undefined;
  const day = location.day + direction;
  return day >= 1 && day <= PLAN_DAYS ? { mode: "plan", day } : undefined;
}
