import { AiError } from "../domain/types.ts";

/**
 * Settle like `promise`, but reject with AiError("aborted") as soon as `signal`
 * aborts. The underlying work (a chunk import, a shared JSON load) carries on.
 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new AiError("aborted"));
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
    const done = () => signal.removeEventListener("abort", stop);
    // Always handled, so a late rejection is never reported as unhandled.
    promise.then(
      (value) => (done(), resolve(value)),
      (error: unknown) => (done(), reject(error)),
    );
  });
}
