/** Only public feature settings. Provider configuration is runtime-only. */
export function aiBuildConfig(env: Record<string, string | undefined>) {
  const enabled = env.VITE_AI_ENABLED?.trim() ?? "";
  if (!["", "true", "false"].includes(enabled))
    throw new Error("AI config: VITE_AI_ENABLED must be true or false");
  if (enabled !== "true" || env.VERCEL === "1") return null;
  const siteKey = env.VITE_TURNSTILE_SITE_KEY?.trim();
  if (!siteKey || !/^[a-zA-Z0-9_-]{10,100}$/.test(siteKey))
    throw new Error("AI config: a public Turnstile site key is required");
  return { siteKey };
}
