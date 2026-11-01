import {
  AiError,
  type AiErrorKind,
  type AiMeta,
  type AiProvider,
  type AiRequest,
  type StreamCallbacks,
} from "./types.ts";

export const FIRST_TOKEN_MS = 25000;
/** Keep-alives or hidden reasoning may extend the wait for text up to this. */
export const ACTIVITY_CEILING_MS = 60000;
export const IDLE_MS = 20000;

export type ChainOptions = {
  /** Providers that failed authentication this session. */
  disabled?: Set<string>;
  firstTokenMs?: number;
  ceilingMs?: number;
  idleMs?: number;
};

// When every provider fails before any text, report the most useful reason.
const PRIORITY: AiErrorKind[] = [
  "quota",
  "rate",
  "refused",
  "network",
  "auth",
  "unavailable",
  "timeout",
  "empty",
  "server",
];

/**
 * Try providers in order. Once any text has arrived, an error is final: the
 * partial answer is kept and text from two models is never combined.
 */
export async function runChain(
  providers: AiProvider[],
  request: AiRequest,
  signal: AbortSignal,
  callbacks: StreamCallbacks,
  options: ChainOptions = {},
): Promise<AiMeta> {
  const disabled = options.disabled ?? new Set<string>();
  const firstTokenMs = options.firstTokenMs ?? FIRST_TOKEN_MS;
  const ceilingMs = options.ceilingMs ?? ACTIVITY_CEILING_MS;
  const idleMs = options.idleMs ?? IDLE_MS;
  const errors: AiError[] = [];

  for (const provider of providers) {
    if (disabled.has(provider.id)) continue;
    if (signal.aborted) throw new AiError("aborted");
    const inner = new AbortController();
    const forward = () => inner.abort(signal.reason);
    signal.addEventListener("abort", forward, { once: true });
    const deadline = Date.now() + ceilingMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let gotText = false;
    let model: string | undefined;
    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        inner.abort("timeout");
      }, ms);
    };
    arm(Math.min(firstTokenMs, ceilingMs));
    try {
      return await provider.stream(request, inner.signal, {
        onText(text) {
          gotText = true;
          arm(idleMs);
          callbacks.onText(text);
        },
        onMeta(name) {
          model = name;
          callbacks.onMeta?.(name);
        },
        onActivity() {
          if (!gotText)
            arm(Math.max(0, Math.min(firstTokenMs, deadline - Date.now())));
          callbacks.onActivity?.();
        },
      });
    } catch (error) {
      const base = error instanceof AiError ? error : new AiError("network");
      const after = gotText || base.afterFirstToken;
      const extra = { model: base.model ?? model, retryAt: base.retryAt };
      if (signal.aborted) throw new AiError("aborted", after, extra);
      const final = new AiError(timedOut ? "timeout" : base.kind, after, extra);
      if (after || final.kind === "aborted") throw final;
      if (final.kind === "auth") disabled.add(provider.id);
      errors.push(final);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", forward);
    }
  }
  if (!errors.length) throw new AiError("auth");
  errors.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  throw errors[0];
}
