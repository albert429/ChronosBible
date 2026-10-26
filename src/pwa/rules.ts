/**
 * What the service worker (src/pwa/sw.ts) keeps, shared with the page's
 * offline downloads. Pure, so unit tests cover it without a worker.
 */

/** The app's code, styles, fonts and page, one cache per build. */
export const shellCache = (build: string) => `chronos-shell-${build}`;
export const isShellCache = (name: string) => name.startsWith("chronos-shell-");
/** Scripture text and study notes, kept across builds while unchanged. */
export const DATA_CACHE = "chronos-data-v1";
/** A request the page saves itself (offline downloads); the worker passes. */
export const SAVE_HEADER = "x-chronos-save";
export const DATA_FOLDERS = ["bible", "readings", "chronology", "study"];

/** A versioned Scripture data address (`/bible/GEN/1.json?v=…`). */
export function dataFolder(url: URL) {
  const folder = url.pathname.split("/")[1];
  return DATA_FOLDERS.includes(folder) &&
    url.pathname.endsWith(".json") &&
    url.searchParams.has("v")
    ? folder
    : undefined;
}

/** Whether a saved data address belongs to an older version of its folder. */
export function staleData(url: URL, versions: Record<string, string>) {
  const folder = dataFolder(url);
  return !!folder && url.searchParams.get("v") !== versions[folder];
}

export type Route = "page" | "shell" | "data" | "network";

/**
 * How the worker answers a request: the app page and its hashed files from
 * the build's cache, versioned data from the data cache (fetched and kept on
 * first use), everything else (audio, AI, other sites, saves) untouched.
 */
export function route(
  request: { method: string; mode: string; url: string; headers: Headers },
  origin: string,
  shell: ReadonlySet<string>,
): Route {
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== origin ||
    request.headers.has(SAVE_HEADER)
  )
    return "network";
  // Pages are the one-page app; a file opened directly (a license text in
  // About) is itself.
  if (request.mode === "navigate")
    return /\.[a-z0-9]+$/i.test(url.pathname) ? "network" : "page";
  if (shell.has(url.pathname)) return "shell";
  return dataFolder(url) ? "data" : "network";
}
