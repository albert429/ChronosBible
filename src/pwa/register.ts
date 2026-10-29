import { useSyncExternalStore } from "react";

// Inlined by vite.config.ts: true in production builds only.
declare const __SERVICE_WORKER__: boolean;

type InstallPrompt = Event & { prompt(): Promise<void> };
type State = { update: boolean; install: boolean };

let state: State = { update: false, install: false };
let waiting: ServiceWorker | null = null;
let prompt: InstallPrompt | null = null;
let updating = false;
const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

/**
 * Register /sw.js (src/pwa/sw.ts); main.tsx calls this once the page has
 * settled, so it never competes with the first reading. A new build
 * installs in the background and waits for the reader to choose «تحديث».
 */
export function registerServiceWorker() {
  // Chromium's own install prompt is replaced by the menu's button.
  addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    prompt = event as InstallPrompt;
    set({ install: true });
  });
  addEventListener("appinstalled", () => {
    prompt = null;
    set({ install: false });
  });
  if (!__SERVICE_WORKER__ || !("serviceWorker" in navigator)) return;
  const offer = (worker: ServiceWorker | null) => {
    // The first install has nothing to replace; only updates are offered.
    if (!worker || !navigator.serviceWorker.controller) return;
    waiting = worker;
    set({ update: true });
    // The notice is its own small chunk and root, outside the reader.
    void import("./UpdateNotice").then(
      (module) => module.showUpdateNotice(),
      () => {},
    );
  };
  const start = () =>
    navigator.serviceWorker.register("/sw.js").then(
      (registration) => {
        // Undefined where registration is blocked (automated browsers).
        if (!registration) return;
        offer(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed") offer(worker);
          });
        });
      },
      () => {
        /* Blocked or unsupported: the app works as before. */
      },
    );
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updating) location.reload();
  });
  // main.tsx loads this module only once the page has settled.
  void start();
}

/** Switch to the waiting build; the page reloads once it takes over. */
export function applyUpdate() {
  if (!waiting) return;
  updating = true;
  waiting.postMessage("update");
}

/** Show the browser's install dialog; resolves once the reader answered. */
export async function installApp() {
  const event = prompt;
  if (!event) return;
  prompt = null;
  set({ install: false });
  await event.prompt();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
/** Whether a new build waits, and whether the browser offers to install. */
export const useAppUpdate = () => useSyncExternalStore(subscribe, () => state);
