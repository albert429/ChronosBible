import { catalog } from "../bible/catalog.ts";
import {
  isChronologicalReading,
  type AnyReadingLocation,
  type AnyScriptureReading,
} from "../bible/types.ts";

/** Read by the inline script in index.html, which adds the data versions. */
export const PRELOAD_KEY = "bible-reader-preload-v1";

/**
 * The data files that render a place, by plain address: a chapter, a plan
 * day, or a chronology's catalog, its reading and (once loaded) the chapters
 * the reading is cut from.
 */
export function readingPaths(
  location: AnyReadingLocation,
  reading?: AnyScriptureReading,
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
