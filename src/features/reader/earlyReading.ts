/**
 * The page's early reading: before the app's code arrives, start fetching
 * the reading it will open, so the text comes with the code, not after it.
 * scripts/build/inline-startup.ts bundles startEarlyReading() into an inline
 * <script> in index.html, in the page's <head>; an external module script
 * would run only after the page was parsed. A wrong guess costs one small
 * request. The app takes the responses over (src/data/earlyResponses.ts).
 */
import { dataUrl } from "../../data/dataVersion.ts";
import { startEarlyResponses } from "../../data/earlyResponses.ts";
import { LOCATION_KEY, PROGRESS_KEY, STATE_KEY } from "../profiles/storage.ts";

/** The paths shown at the end of the last visit (written by preload.ts). */
export const PRELOAD_KEY = "bible-reader-preload-v1";
/** The data files a first screen may need, by plain address. */
const READING_FILE = /^\/(bible|readings|chronology)\/[\w-]+(\/[\w-]+)?\.json$/;

/**
 * What the page will open, by plain address: the place in the link, or
 * else the reading shown at the end of the last visit. A fresh reader opens
 * Genesis 1; an older one from before this list, their own place (unknown
 * here, so nothing is guessed).
 */
export function earlyPaths(
  search: string,
  storage: Pick<Storage, "getItem">,
): string[] {
  const query = new URLSearchParams(search);
  const mode = query.get("mode");
  let paths: unknown;
  if (mode === "bible")
    paths = [`/bible/${query.get("book")}/${query.get("chapter")}.json`];
  else if (mode === "chronological") {
    const testament = query.get("testament");
    paths = [
      `/chronology/${testament}.json`,
      `/chronology/${testament}/${query.get("reading")}.json`,
    ];
  } else if (mode) paths = [];
  else if (query.has("day")) paths = [`/readings/${query.get("day")}.json`];
  else {
    const saved = storage.getItem(PRELOAD_KEY);
    paths = saved
      ? JSON.parse(saved)
      : [STATE_KEY, LOCATION_KEY, PROGRESS_KEY].some((key) =>
            storage.getItem(key),
          )
        ? []
        : ["/bible/GEN/1.json"];
  }
  return Array.isArray(paths)
    ? paths.filter(
        (path): path is string =>
          typeof path === "string" && READING_FILE.test(path),
      )
    : [];
}

/** Run by the inline script: never throws, the app loads what is missing. */
export function startEarlyReading() {
  try {
    startEarlyResponses(earlyPaths(location.search, localStorage).map(dataUrl));
  } catch {
    /* Storage blocked or the saved list unreadable: nothing starts early. */
  }
}
