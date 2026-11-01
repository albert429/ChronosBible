/**
 * Offline downloads: keep a pack's files in the persistent data cache that
 * the service worker also answers from (src/features/offline/sw.ts). The
 * raw responses are kept as they arrived (the stored gzip of verse-study
 * words too), so the worker serves them exactly as the network would.
 */
import { DATA_CACHE, SAVE_HEADER } from "./rules.ts";

/** Files requested at once while saving. */
export const AT_ONCE = 6;

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
  // Listen before the first wait: a cancel made before the save began, or
  // while the cache opens, stops it too.
  const stop = new AbortController();
  const cancel = () => stop.abort(signal.reason);
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  try {
    const cache = await caches.open(DATA_CACHE);
    const kept = new Set((await cache.keys()).map((request) => request.url));
    stop.signal.throwIfAborted();
    const todo = urls.filter((url) => !kept.has(absolute(url)));
    let saved = urls.length - todo.length;
    let next = 0;
    progress(saved);
    const work = async () => {
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
    };
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
