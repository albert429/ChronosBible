/**
 * The service worker: the app opens without a network, every reading opened
 * is kept, and saved Scripture stays available offline. Built on its own by
 * vite.config.ts as /sw.js, with the build's files and data versions.
 */
import {
  DATA_CACHE,
  isShellCache,
  route,
  shellCache,
  staleData,
  type Route,
} from "./rules.ts";

declare const __SW_SHELL__: string[];
declare const __SW_BUILD__: string;
declare const __DATA_VERSIONS__: Record<string, string>;

// The few worker types used here, without mixing the WebWorker library into
// the app's DOM types.
type ExtendableEvent = Event & { waitUntil(work: Promise<unknown>): void };
type FetchEvent = ExtendableEvent & {
  request: Request;
  respondWith(response: Promise<Response>): void;
};
type ServiceWorkerScope = {
  addEventListener(
    type: "install" | "activate",
    listener: (event: ExtendableEvent) => void,
  ): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  location: Location;
};
const worker = self as unknown as ServiceWorkerScope;

const SHELL = shellCache(__SW_BUILD__);
const shell = new Set(__SW_SHELL__);

worker.addEventListener("install", (event) => {
  // The whole app, so that it opens offline from the next launch on. A new
  // build waits until the reader accepts it (src/pwa/register.ts).
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(__SW_SHELL__)),
  );
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (isShellCache(name) && name !== SHELL) await caches.delete(name);
      // Saved readings stay until their folder is regenerated.
      const data = await caches.open(DATA_CACHE);
      for (const request of await data.keys())
        if (staleData(new URL(request.url), __DATA_VERSIONS__))
          await data.delete(request);
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener("message", (event) => {
  if (event.data === "update") void worker.skipWaiting();
});

worker.addEventListener("fetch", (event) => {
  const kind = route(event.request, worker.location.origin, shell);
  if (kind === "network") return;
  event.respondWith(answer(event, kind));
});

async function answer(event: FetchEvent, kind: Exclude<Route, "network">) {
  const { request } = event;
  // These files never vary for one address, so request headers that a
  // server lists in Vary (Origin, Accept-Encoding) must not cause a miss.
  if (kind === "page")
    // Every address is the one-page app: this build's page, even offline.
    return (
      (await caches.match("/", { cacheName: SHELL, ignoreVary: true })) ??
      fetch(request)
    );
  const cacheName = kind === "shell" ? SHELL : DATA_CACHE;
  const cached = await caches.match(request, { cacheName, ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (kind === "data" && response.ok) {
    const copy = response.clone();
    event.waitUntil(
      caches.open(DATA_CACHE).then((cache) => cache.put(request, copy)),
    );
  }
  return response;
}
