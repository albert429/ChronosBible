import { catalog } from "../bible/catalog.ts";
import { chronologyCatalogs } from "../chronology/client.ts";
import { dataUrl } from "../lib/dataVersion.ts";
import { PLAN_DAYS } from "../plan/schedule.ts";
import { DATA_CACHE, SAVE_HEADER } from "./rules.ts";

/** Scripture text (every mode) or the New Testament study notes. */
export type Pack = "text" | "study";

const DAYS = Array.from({ length: PLAN_DAYS }, (_, index) => index + 1);
const AT_ONCE = 6;

/** Every file a pack needs, at this build's versioned addresses. */
export async function packUrls(pack: Pack): Promise<string[]> {
  if (pack === "study")
    return DAYS.flatMap((day) =>
      ["", ".tr", ".lex"].map((part) => dataUrl(`/study/${day}${part}.json`)),
    );
  const chronologies = await Promise.all([
    chronologyCatalogs.load("OT"),
    chronologyCatalogs.load("NT"),
  ]);
  return [
    "/readings/plan.json",
    ...DAYS.map((day) => `/readings/${day}.json`),
    ...catalog.flatMap((book) =>
      Array.from(
        { length: book.chapters },
        (_, index) => `/bible/${book.usfm}/${index + 1}.json`,
      ),
    ),
    "/chronology/OT.json",
    "/chronology/NT.json",
    ...chronologies.flatMap((chronology) =>
      chronology.readings.map(
        (reading) => `/chronology/${chronology.testament}/${reading.id}.json`,
      ),
    ),
  ].map(dataUrl);
}

const absolute = (url: string) => new URL(url, location.href).href;

/** How many of these files are already kept on this device. */
export async function savedCount(urls: readonly string[]) {
  const cache = await caches.open(DATA_CACHE);
  const kept = new Set((await cache.keys()).map((request) => request.url));
  return urls.filter((url) => kept.has(absolute(url))).length;
}

/**
 * Keep every file not kept yet, a few at a time; an interrupted save resumes
 * where it stopped. The worker leaves these requests alone (SAVE_HEADER).
 * A failure or cancel stops every request, and no progress follows it.
 */
export async function savePack(
  urls: readonly string[],
  progress: (saved: number) => void,
  signal: AbortSignal,
) {
  const cache = await caches.open(DATA_CACHE);
  const kept = new Set((await cache.keys()).map((request) => request.url));
  const todo = urls.filter((url) => !kept.has(absolute(url)));
  let saved = urls.length - todo.length;
  let next = 0;
  progress(saved);
  const stop = new AbortController();
  const cancel = () => stop.abort(signal.reason);
  signal.addEventListener("abort", cancel, { once: true });
  async function work() {
    while (next < todo.length) {
      stop.signal.throwIfAborted();
      const url = todo[next++];
      const response = await fetch(url, {
        headers: { [SAVE_HEADER]: "1" },
        signal: stop.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await cache.put(url, response);
      stop.signal.throwIfAborted();
      progress(++saved);
    }
  }
  try {
    await Promise.all(
      Array.from({ length: AT_ONCE }, () =>
        work().catch((error) => {
          stop.abort(error);
          throw error;
        }),
      ),
    );
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  // Ask the browser not to clear saved Scripture under storage pressure.
  await navigator.storage?.persist?.().catch(() => false);
}

/** What this site stores on the device, in megabytes, if the browser says. */
export async function storageUsed() {
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  return estimate?.usage === undefined ? undefined : estimate.usage / 1e6;
}
