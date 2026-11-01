// Build-time AI configuration. vite.config.ts validates the VITE_* variables
// here and inlines the result as build constants (see src/vite-env.d.ts); the
// app never reads Vite's env object. An invalid configuration fails the build.

export const ROUTER_MODEL = "openrouter/free";
export const DEFAULT_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
];
export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_DAILY_CAP = 10;

export type OpenRouterConfig = {
  id: "openrouter";
  apiKey: string;
  models: string[];
  baseUrl: string;
};
export type AiBuildConfig = {
  providers: OpenRouterConfig[];
  /** Answers per device per Cairo day. */
  dailyCap: number;
  /** Requests per device per Cairo day, including failed ones. */
  attemptCap: number;
};

type Env = Record<string, string | undefined>;

// Only zero-priced ":free" variants: never "openrouter/auto" or a paid model.
const FREE_SLUG = /^[a-z0-9][\w.-]*\/[\w.-]+:free$/i;
const ASCII_KEY = /^[\x21-\x7E]+$/;
const LOCAL_URL = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/;

const fail = (message: string): never => {
  throw new Error("AI config: " + message);
};
/** An empty or whitespace-only variable counts as unset. */
const read = (env: Env, name: string) => env[name]?.trim() || undefined;
const list = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export function aiBuildConfig(env: Env): AiBuildConfig | null {
  const ids = [...new Set(list(read(env, "VITE_AI_PROVIDERS")))];
  if (!ids.length) return null;
  const providers = ids.map((id): OpenRouterConfig => {
    if (id !== "openrouter") fail(`unknown provider "${id}"`);
    const apiKey = read(env, "VITE_OPENROUTER_API_KEY");
    if (!apiKey) return fail("VITE_OPENROUTER_API_KEY is required");
    // Header values must be ASCII, or fetch throws.
    if (!ASCII_KEY.test(apiKey)) fail("the API key must be printable ASCII");
    const listed = [
      ...new Set(list(read(env, "VITE_OPENROUTER_MODELS"))),
    ].filter((model) => model !== ROUTER_MODEL);
    for (const model of listed)
      if (!FREE_SLUG.test(model))
        fail(`only ":free" models are allowed, got "${model}"`);
    if (listed.length > 2) fail("list at most 2 models");
    const models = [...(listed.length ? listed : DEFAULT_MODELS), ROUTER_MODEL];
    const baseUrl = (
      read(env, "VITE_OPENROUTER_BASE_URL") ?? DEFAULT_BASE_URL
    ).replace(/\/+$/, "");
    const local =
      LOCAL_URL.test(baseUrl) && read(env, "VITE_AI_ALLOW_LOCAL") === "1";
    if (!baseUrl.startsWith("https://") && !local)
      fail("VITE_OPENROUTER_BASE_URL must use https://");
    return { id: "openrouter", apiKey, models, baseUrl };
  });
  const capText = read(env, "VITE_AI_DAILY_CAP");
  const dailyCap = capText === undefined ? DEFAULT_DAILY_CAP : Number(capText);
  if (!Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > 100)
    fail("VITE_AI_DAILY_CAP must be an integer from 1 to 100");
  return { providers, dailyCap, attemptCap: dailyCap * 2 };
}
