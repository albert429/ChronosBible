import { test } from "node:test";
import assert from "node:assert/strict";
import { aiBuildConfig } from "../ai-config.ts";
test("AI defaults off, Vercel stays off, only a public site key is configured", () => {
  assert.equal(aiBuildConfig({}), null);
  assert.equal(
    aiBuildConfig({
      VITE_AI_PROVIDERS: "openrouter",
      VITE_OPENROUTER_API_KEY: "secret",
    }),
    null,
  );
  assert.equal(aiBuildConfig({ VITE_AI_ENABLED: "true", VERCEL: "1" }), null);
  assert.deepEqual(
    aiBuildConfig({
      VITE_AI_ENABLED: "true",
      VITE_TURNSTILE_SITE_KEY: "public-site-key",
    }),
    { siteKey: "public-site-key" },
  );
  assert.throws(() => aiBuildConfig({ VITE_AI_ENABLED: "yes" }));
  assert.throws(() => aiBuildConfig({ VITE_AI_ENABLED: "true" }));
});
