// Deployment targets, release gates and explicit public build settings.
// Keep this deployment path in plain JavaScript for Workers Builds.
import { join } from "node:path";
import { ROOT } from "../lib/paths.js";

export const fail = (message) => {
  throw new Error(`Cloudflare app: ${message}`);
};
export function deployment(target) {
  if (target === "production")
    return { branch: "main", name: "chronosbible", domain: "chronosbible.com" };
  if (target === "dev")
    return {
      branch: "dev",
      name: "chronosbible-dev",
      domain: "dev.chronosbible.com",
    };
  return fail("choose exactly production or dev");
}

// Public, read-only R2 custom domain (bucket chronosbible-audio).
export const AUDIO_BASE_URL = "https://audio.chronosbible.com";

// Whether each Worker's build may advertise hosted chapter recordings. An
// explicit decision per environment, not inferred from the build's source:
// the verified upload inventory (data/audio/publication.json) still decides
// which chapters are actually advertised.
export const CHAPTER_AUDIO = Object.freeze({ production: true, dev: true });

// Flip production only in the reviewed release after dev acceptance.
export const AI_RELEASE = Object.freeze({ production: false, dev: true });
const AI_SETTINGS = ["VITE_AI_ENABLED", "VITE_TURNSTILE_SITE_KEY"];
export function aiSettings(target, source = process.env) {
  deployment(target);
  if (!AI_RELEASE[target] || source.VITE_AI_ENABLED !== "true")
    return undefined;
  return { siteKey: source.VITE_TURNSTILE_SITE_KEY?.trim() };
}

// Use an allowlist: Vite loads .env files AND shell VITE_* values. Neither may
// silently enable AI, fixtures, or a future public setting in this deployment.
// Test-only switches (VITE_OPENROUTER_BASE_URL, VITE_AI_ALLOW_LOCAL) never pass.
/** @returns {Record<string, string | undefined>} */
export function buildEnvironment(target, source = process.env) {
  deployment(target);
  const env = {};
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SystemRoot",
    "LANG",
  ])
    if (source[key] !== undefined) env[key] = source[key];
  const ai = aiSettings(target, source)
    ? Object.fromEntries(
        AI_SETTINGS.filter((key) => source[key] !== undefined).map((key) => [
          key,
          source[key],
        ]),
      )
    : { VITE_AI_ENABLED: "false", VITE_TURNSTILE_SITE_KEY: "" };
  return {
    ...env,
    CI: "true",
    NODE_ENV: "production",
    VITE_AUDIO_BASE_URL: AUDIO_BASE_URL,
    VITE_AUDIO_CHAPTERS_ENABLED: String(CHAPTER_AUDIO[target]),
    ...ai,
  };
}

export function deployArguments(target, root = ROOT) {
  deployment(target);
  return [
    "deploy",
    "--config",
    join(root, "wrangler.json"),
    "--env",
    target === "dev" ? "dev" : "",
  ];
}
