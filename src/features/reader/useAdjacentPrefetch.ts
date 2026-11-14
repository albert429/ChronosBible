import { useEffect } from "react";
import { connectionAllowsPrefetch } from "../../shared/browser/network.ts";
import { adjacentChapter } from "../../core/reading/adjacent";
import { catalog } from "../../core/scripture/catalog";
import { chapters } from "../bible/data/client";
import {
  type ReadingLocation,
  type ScriptureReading,
} from "../../core/reading/types";
import { readingKey } from "../../core/reading/identity";
import { chronologicalReadings } from "../chronology/data/client";
import { adjacentChronologicalLocation } from "../../core/reading/chronologyCatalog";
import type { ChronologyCatalog } from "../../core/reading/chronology";
import { days } from "../plan/data/client.ts";

/**
 * Run `prefetch` once the selected reading and its fonts settle, unless the
 * connection asks to save data; the returned cleanup cancels a queued run.
 */
function afterSettle(prefetch: () => void) {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  Promise.resolve(document.fonts?.ready).then(
    () => {
      if (cancelled) return;
      timer = setTimeout(() => {
        if (!cancelled && connectionAllowsPrefetch()) prefetch();
      }, 500);
    },
    () => {},
  );
  return () => {
    cancelled = true;
    clearTimeout(timer);
    // Requests already started belong to the shared client and may be foreground work.
  };
}

/**
 * The neighbours worth fetching ahead, per mode: both plan days and both
 * canonical chapters; only the next chronological reading, as a reading
 * spans several chapters and readers move forward through a chronology.
 */
function prefetchNeighbours(
  location: ReadingLocation,
  chronology: ChronologyCatalog | undefined,
) {
  if (location.mode === "plan") {
    void days.prefetchDay(location.day - 1);
    void days.prefetchDay(location.day + 1);
  } else if (location.mode === "bible") {
    for (const direction of [-1, 1] as const) {
      const next = adjacentChapter(catalog, location, direction);
      if (next) void chapters.prefetchChapter(next);
    }
  } else {
    const next =
      chronology && adjacentChronologicalLocation(chronology, location, 1);
    if (next) void chronologicalReadings.prefetchReading(next);
  }
}

/**
 * Prepare the immediate neighbours of the reading on screen once its text
 * and fonts settle (a chronology also needs its catalog), unless the
 * connection asks to save data.
 */
export function useAdjacentPrefetch(
  location: ReadingLocation,
  /** The reading on screen, once it matches `location`. */
  current: ScriptureReading | undefined,
  error: string | undefined,
  chronology: ChronologyCatalog | undefined,
) {
  const identity = readingKey(location);
  const ready =
    !!current && !error && (location.mode !== "chronological" || !!chronology);
  useEffect(() => {
    if (!ready || !connectionAllowsPrefetch()) return;
    return afterSettle(() => prefetchNeighbours(location, chronology));
    // The location object changes identity on every render; its key does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, ready, chronology]);
}
