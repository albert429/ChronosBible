import { AiError } from "./domain/types.ts";
import { abortable } from "./data/abortable.ts";

type Turnstile = {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      language: string;
      size: string;
      callback(token: string): void;
      "error-callback"(): void;
      "expired-callback"(): void;
    },
  ): string;
  remove(id: string): void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
let script: Promise<void> | undefined;
function load() {
  if (window.turnstile) return Promise.resolve();
  return (script ??= new Promise<void>((resolve, reject) => {
    const element = document.createElement("script");
    element.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    element.async = true;
    element.onload = () => resolve();
    element.onerror = () => {
      script = undefined;
      element.remove();
      reject(new AiError("challenge"));
    };
    document.head.append(element);
  }));
}
/** Loaded only for an uncached answer, and mounted inside the active dialog. */
export async function challenge(element: HTMLElement, signal: AbortSignal) {
  await abortable(load(), signal);
  signal.throwIfAborted();
  const api = window.turnstile;
  if (!api) throw new AiError("challenge");
  let id: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await abortable(
      new Promise<string>((resolve, reject) => {
        const failed = () => reject(new AiError("challenge"));
        timer = setTimeout(failed, 120000);
        id = api.render(element, {
          sitekey: __TURNSTILE_SITE_KEY__,
          action: "ai_answer",
          language: "ar",
          size: "flexible",
          callback: resolve,
          "error-callback": failed,
          "expired-callback": failed,
        });
      }),
      signal,
    );
  } finally {
    clearTimeout(timer);
    if (id !== undefined) api.remove(id);
  }
}
