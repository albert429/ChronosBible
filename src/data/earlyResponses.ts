/**
 * The handoff from the page's inline early-reading script
 * (src/features/reader/earlyReading.ts, inlined into index.html) to the JSON
 * clients (jsonClient.ts): fetches started with the page, by address,
 * undefined where the request failed. Unlike a <link rel=preload>, a fetch
 * started here is reused by every browser.
 */
export type EarlyResponses = Record<string, Promise<Response | undefined>>;
type Host = { __earlyData?: EarlyResponses };

/** Fetch these addresses now and leave the responses for the app. */
export function startEarlyResponses(
  hrefs: readonly string[],
  fetcher: typeof fetch = fetch,
  host: Host = globalThis as Host,
) {
  const early: EarlyResponses = (host.__earlyData = {});
  for (const href of hrefs)
    early[href] = fetcher(href).then(
      (response) => (response.ok ? response : undefined),
      () => undefined,
    );
  return early;
}

const used = new Set<string>();
/**
 * The early response for an address, once: it serves the first load of that
 * address only. The entries stay, so the page shows what was started.
 */
export function takeEarlyResponse(
  href: string,
  host: Host = globalThis as Host,
) {
  const early = host.__earlyData;
  if (!early?.[href] || used.has(href)) return;
  used.add(href);
  return early[href];
}
