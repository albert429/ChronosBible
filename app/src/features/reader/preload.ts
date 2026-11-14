import { catalog } from "../../core/scripture/catalog.ts";
import {
  isChronologicalReading,
  type ReadingLocation,
  type ScriptureReading,
} from "../../core/reading/types.ts";
// Read back by the page's inline early-reading script.
import { PRELOAD_KEY } from "./earlyReading.ts";

/**
 * The data files that render a place, by plain address: a chapter, a plan
 * day, or a chronology's catalog, its reading and (once loaded) the chapters
 * the reading is cut from.
 */
export function readingPaths(
  location: ReadingLocation,
  reading?: ScriptureReading,
): string[] {
  if (location.mode === "bible")
    return [`/bible/${location.book}/${location.chapter}.json`];
  if (location.mode === "plan") return [`/readings/${location.day}.json`];
  const { testament, readingId } = location;
  const paths = [
    `/chronology/${testament}.json`,
    `/chronology/${testament}/${readingId}.json`,
  ];
  if (reading && isChronologicalReading(reading))
    for (const passage of reading.passages) {
      const book = catalog.find((item) => item.name === passage.book);
      const path = book && `/bible/${book.usfm}/${passage.chapter}.json`;
      if (path && !paths.includes(path)) paths.push(path);
    }
  return paths;
}

/** The next launch starts fetching these with the page, before the app runs. */
export function rememberPreload(paths: string[]) {
  try {
    localStorage.setItem(PRELOAD_KEY, JSON.stringify(paths));
  } catch {
    /* The app still loads them itself. */
  }
}
