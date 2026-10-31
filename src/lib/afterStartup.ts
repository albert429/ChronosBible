let settled: Promise<void> | undefined;

/**
 * Run work that the first screen never needs (worker registration, the next
 * launch's preload list) once the page has loaded, two seconds have passed
 * and the browser is idle, so it never joins the first reading's requests.
 */
export function afterStartup(run: () => void) {
  settled ??= new Promise((resolve) => {
    const wait = () =>
      setTimeout(() => {
        if (typeof requestIdleCallback === "function")
          requestIdleCallback(() => resolve(), { timeout: 2000 });
        else resolve();
      }, 2000);
    if (document.readyState === "complete") wait();
    else addEventListener("load", wait, { once: true });
  });
  void settled.then(run);
}
