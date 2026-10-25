import { useEffect } from "react";
import { connectionAllowsPrefetch } from "../lib/network.ts";
import { adjacentChapter } from "../bible/navigation";
import { catalog } from "../bible/catalog";
import { chapters } from "../bible/client";
import {
  readingKey,
  type AnyReadingLocation,
  type AnyScriptureReading,
} from "../bible/types";
import {
  adjacentChronologicalLocation,
  chronologicalReadings,
} from "../chronology/client";
import type { ChronologyCatalog } from "../chronology/types";
import { days, type Day } from "../plan/readings.ts";

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

export function useAdjacentPrefetch(
  selected: number,
  reading: Day | undefined,
  error: string | undefined,
  active: boolean,
) {
  useEffect(() => {
    if (
      !active ||
      reading?.day !== selected ||
      error ||
      !connectionAllowsPrefetch()
    )
      return;
    return afterSettle(() => {
      void days.prefetchDay(selected - 1);
      void days.prefetchDay(selected + 1);
    });
  }, [selected, reading?.day, error, active]);
}

/** Prepare only the immediate canonical neighbors, after text and fonts settle. */
export function useChapterPrefetch(
  location: AnyReadingLocation,
  reading: AnyScriptureReading | undefined,
  error: string | undefined,
) {
  const identity = readingKey(location);
  const loaded = reading ? readingKey(reading) : undefined;
  const book = location.mode === "bible" ? location.book : undefined;
  const chapter = location.mode === "bible" ? location.chapter : undefined;
  useEffect(() => {
    if (
      !book ||
      !chapter ||
      loaded !== identity ||
      error ||
      !connectionAllowsPrefetch()
    )
      return;
    return afterSettle(() => {
      const current = { mode: "bible" as const, book, chapter };
      for (const direction of [-1, 1] as const) {
        const next = adjacentChapter(catalog, current, direction);
        if (next) void chapters.prefetchChapter(next);
      }
    });
  }, [identity, loaded, book, chapter, error]);
}

/**
 * Prepare the next chronological reading only: a reading spans several
 * chapters, and readers move forward through a chronology.
 */
export function useChronologyPrefetch(
  location: AnyReadingLocation,
  reading: AnyScriptureReading | undefined,
  error: string | undefined,
  chronology: ChronologyCatalog | undefined,
) {
  const identity = readingKey(location);
  const loaded = reading ? readingKey(reading) : undefined;
  const chronological = location.mode === "chronological" ? location : null;
  useEffect(() => {
    if (
      !chronological ||
      !chronology ||
      loaded !== identity ||
      error ||
      !connectionAllowsPrefetch()
    )
      return;
    return afterSettle(() => {
      const next = adjacentChronologicalLocation(chronology, chronological, 1);
      if (next) void chronologicalReadings.prefetchReading(next);
    });
    // The location object changes identity on every render; its key does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, loaded, error, chronology]);
}
