export type Env = {
  ASSETS: Fetcher;
  AI: DurableObjectNamespace;
  AI_ENABLED: string;
  AI_ENVIRONMENT: "dev" | "production";
  AI_ORIGIN: string;
  AI_GATEWAY_ACCOUNT_ID: string;
  AI_GATEWAY_ID: string;
  OPENROUTER_API_KEY: string;
  AI_GATEWAY_TOKEN: string;
  TURNSTILE_SECRET: string;
  AI_COOKIE_SECRET: string;
};

export const LIMITS = {
  dev: { daily: 10, minute: 5, concurrent: 1 },
  production: { daily: 40, minute: 15, concurrent: 3 },
} as const;
export const DEVICE_LIMITS = { answers: 10, attempts: 20 };
export const OVERALL_MS = 120_000;
export const CACHE_TTL = 7 * 86400_000;
export const CACHE_ENTRIES = 1000;

export function configured(env: Env) {
  return (
    env.AI_ENABLED === "true" &&
    ["dev", "production"].includes(env.AI_ENVIRONMENT) &&
    /^(?:https:\/\/|http:\/\/(?:127\.0\.0\.1|localhost):\d+$)/.test(
      env.AI_ORIGIN,
    ) &&
    /^[a-f0-9]{32}$/.test(env.AI_GATEWAY_ACCOUNT_ID ?? "") &&
    /^[a-z0-9-]+$/.test(env.AI_GATEWAY_ID ?? "") &&
    !!env.OPENROUTER_API_KEY &&
    !!env.AI_GATEWAY_TOKEN &&
    !!env.TURNSTILE_SECRET &&
    (env.AI_COOKIE_SECRET?.length ?? 0) >= 32
  );
}
