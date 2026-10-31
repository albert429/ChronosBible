export type ChipId = "explain" | "words" | "background" | "ask";

export type AiErrorKind =
  | "quota" // the shared daily allowance (or the key's credit) is used up
  | "rate" // too many requests per minute
  | "auth" // key revoked, disabled or invalid
  | "refused" // moderation, guardrail or content filter
  | "unavailable" // model or data-policy mismatch (400/404)
  | "server" // upstream or OpenRouter failure
  | "network"
  | "timeout"
  | "empty" // finished without any answer text
  | "aborted";

export class AiError extends Error {
  kind: AiErrorKind;
  /** True once any answer text reached the reader; such errors keep partial text. */
  afterFirstToken: boolean;
  /** The model that was answering, when known. */
  model?: string;
  /** Epoch ms before which another request is pointless, when the service said so. */
  retryAt?: number;
  constructor(
    kind: AiErrorKind,
    afterFirstToken = false,
    extra: { model?: string; retryAt?: number } = {},
  ) {
    super(kind);
    this.name = "AiError";
    this.kind = kind;
    this.afterFirstToken = afterFirstToken;
    this.model = extra.model;
    this.retryAt = extra.retryAt;
  }
}

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

export type AiRequest = {
  system: string;
  prompt: string;
  maxOutputTokens: number;
};

export type AiMeta = {
  provider: string;
  model: string;
  finish: "stop" | "length";
};

export type StreamCallbacks = {
  onText(text: string): void;
  /** The answering model, as soon as a chunk names it. */
  onMeta?(model: string): void;
  /** Keep-alives or hidden reasoning: the model is working but no text yet. */
  onActivity?(): void;
};

export type AiProvider = {
  id: string;
  stream(
    request: AiRequest,
    signal: AbortSignal,
    callbacks: StreamCallbacks,
  ): Promise<AiMeta>;
};
