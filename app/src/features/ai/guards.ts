import type { AiErrorKind } from "./domain/types.ts";
export type Problem = AiErrorKind | "stopped";
export const RETRYABLE = new Set<Problem>([
  "rate",
  "busy",
  "challenge",
  "storage",
  "server",
  "timeout",
  "empty",
  "network",
  "stopped",
  "aborted",
]);
export type Guards = ReturnType<typeof createGuards>;
/** Only UX cooldowns. Every quota decision belongs to the server. */
export function createGuards({ now = Date.now }: { now?: () => number } = {}) {
  let coolUntil = 0,
    failures = 0;
  return {
    refusal(): "rate" | undefined {
      if (now() < coolUntil) return "rate";
    },
    backOff(kind: Problem, retryAt?: number) {
      if (kind === "rate" || kind === "busy")
        coolUntil =
          now() +
          Math.min(
            65000,
            Math.max(kind === "busy" ? 3000 : 30000, (retryAt ?? 0) - now()),
          );
      else if (RETRYABLE.has(kind)) {
        failures++;
        coolUntil = now() + (failures === 1 ? 5000 : 15000);
      }
    },
    answered() {
      failures = 0;
    },
    remaining() {
      return Math.max(0, coolUntil - now());
    },
  };
}
