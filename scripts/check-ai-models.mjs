// Checks the configured AI models against OpenRouter's public model list:
// each must still exist and be free. Prints any announced expiry date.
// Usage: npm run ai:models [-- --mode <mode>]
import { loadEnv } from "vite";
import {
  aiBuildConfig,
  DEFAULT_MODELS,
  ROUTER_MODEL,
} from "../src/features/ai/config.ts";

// The same VITE_* variables as the build: an explicit --mode, else the
// production env files, then the development ones (where docs/development.md
// says to keep a local key). Exported variables override the files.
const flag = process.argv.indexOf("--mode");
const modes =
  flag > 0 ? [process.argv[flag + 1]] : ["production", "development"];
const configured = (env) =>
  !!(env.VITE_AI_PROVIDERS?.trim() || env.VITE_OPENROUTER_MODELS?.trim());
const [mode, env] =
  modes
    .map(
      (m) =>
        /** @type {[string, Record<string, string>]} */ ([
          m,
          loadEnv(m, process.cwd(), "VITE_"),
        ]),
    )
    .find(([, e]) => configured(e)) ?? [];
// Validated as the build does; this script never needs (or sends) the key.
const models = env
  ? aiBuildConfig({
      ...env,
      VITE_AI_PROVIDERS: "openrouter",
      VITE_OPENROUTER_API_KEY: env.VITE_OPENROUTER_API_KEY?.trim() || "unused",
    }).providers[0].models
  : [...DEFAULT_MODELS, ROUTER_MODEL];
console.log(
  env
    ? `Models from the ${mode} environment.`
    : "AI is not configured; checking the default models.",
);

const response = await fetch("https://openrouter.ai/api/v1/models", {
  headers: { Accept: "application/json" },
});
if (!response.ok) {
  console.error(`OpenRouter model list: HTTP ${response.status}`);
  process.exit(1);
}
const { data } = await response.json();
const byId = new Map(data.map((model) => [model.id, model]));
const free = (pricing = {}) =>
  ["prompt", "completion", "request"].every(
    (field) => pricing[field] === undefined || Number(pricing[field]) === 0,
  );

let failed = false;
for (const id of models) {
  const model = byId.get(id);
  if (!model) {
    console.error(`✗ ${id}: not listed (renamed or removed)`);
    failed = true;
    continue;
  }
  if (!free(model.pricing)) {
    console.error(`✗ ${id}: no longer free (${JSON.stringify(model.pricing)})`);
    failed = true;
    continue;
  }
  const expiry = model.expiration_date
    ? `, expires ${model.expiration_date}`
    : "";
  console.log(`✓ ${id}: free, context ${model.context_length}${expiry}`);
}
process.exit(failed ? 1 : 0);
