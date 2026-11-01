import { usage, type StorageLike } from "./cache.ts";
import type { AiErrorKind } from "./types.ts";

/** Why an answer failed or would be refused. */
export type Problem = AiErrorKind | "cap" | "attempts" | "stopped";

/** Failures that «إعادة المحاولة» may get past. */
export const RETRYABLE = new Set<Problem>([
  "rate",
  "server",
  "timeout",
  "empty",
  "network",
  "stopped",
  "aborted",
]);

export type Guards = ReturnType<typeof createGuards>;

/**
 * Guards that protect the shared OpenRouter allowance for the page session.
 * The panel keeps one set at module scope, so closing the sheet, or moving to
 * another verse, does not reset them. Daily counts live in cache.ts storage.
 */
export function createGuards({
  dailyCap,
  attemptCap,
  now = Date.now,
}: {
  /** Answers per device per day. */
  dailyCap: number;
  /** Requests sent per device per day, answered or not. */
  attemptCap: number;
  now?: () => number;
}) {
  let quotaReached = false;
  let coolUntil = 0;
  let failures = 0;
  return {
    /** Why a new request would be refused right now, if it would be. */
    refusal(storage: StorageLike | null, date: string): Problem | undefined {
      if (quotaReached) return "quota";
      const { n, a } = usage(storage, date);
      if (n >= dailyCap) return "cap";
      if (a >= attemptCap) return "attempts";
      if (now() < coolUntil) return "rate";
    },
    /** After a failure that left no answer text. */
    backOff(kind: Problem, retryAt?: number) {
      const at = now();
      if (kind === "quota") quotaReached = true;
      else if (kind === "rate")
        // The service's reset time, bounded: the device clock may be wrong.
        coolUntil = at + Math.min(65000, Math.max(30000, (retryAt ?? 0) - at));
      else if (RETRYABLE.has(kind)) {
        failures += 1;
        coolUntil = at + (failures === 1 ? 5000 : 15000);
      }
    },
    /** A complete answer resets the escalating cooldown. */
    answered() {
      failures = 0;
    },
    /** Milliseconds left in the current cooldown (0 when none). */
    remaining() {
      return Math.max(0, coolUntil - now());
    },
  };
}
