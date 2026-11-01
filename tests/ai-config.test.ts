import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aiBuildConfig,
  DEFAULT_MODELS,
  ROUTER_MODEL,
} from "../src/features/ai/config.ts";

const base = {
  VITE_AI_PROVIDERS: "openrouter",
  VITE_OPENROUTER_API_KEY: "sk-or-v1-abc",
};

test("AI stays off when no provider is configured", () => {
  assert.equal(aiBuildConfig({}), null);
  assert.equal(aiBuildConfig({ VITE_AI_PROVIDERS: "  " }), null);
  assert.equal(
    aiBuildConfig({ VITE_AI_PROVIDERS: "", VITE_OPENROUTER_API_KEY: "x" }),
    null,
  );
});

test("Defaults: two free models, then the free router, https base URL and cap 10", () => {
  const config = aiBuildConfig({
    ...base,
    VITE_OPENROUTER_MODELS: "",
    VITE_AI_DAILY_CAP: "",
  });
  assert.deepEqual(config, {
    providers: [
      {
        id: "openrouter",
        apiKey: "sk-or-v1-abc",
        models: [...DEFAULT_MODELS, ROUTER_MODEL],
        baseUrl: "https://openrouter.ai/api/v1",
      },
    ],
    dailyCap: 10,
    attemptCap: 20,
  });
});

test("Configured models are deduplicated and the router is kept last", () => {
  const config = aiBuildConfig({
    ...base,
    VITE_OPENROUTER_MODELS: " a/one:free, openrouter/free , a/one:free",
    VITE_AI_DAILY_CAP: "3",
  });
  assert.ok(config);
  assert.deepEqual(config.providers[0].models, ["a/one:free", ROUTER_MODEL]);
  assert.equal(config.dailyCap, 3);
  assert.equal(config.attemptCap, 6);
});

test("Invalid configurations fail the build", () => {
  const bad = [
    { VITE_AI_PROVIDERS: "gemini", VITE_OPENROUTER_API_KEY: "k" },
    { VITE_AI_PROVIDERS: "openrouter" },
    { ...base, VITE_OPENROUTER_API_KEY: "مفتاح" },
    { ...base, VITE_OPENROUTER_MODELS: "google/gemini-pro" },
    { ...base, VITE_OPENROUTER_MODELS: "openrouter/auto" },
    { ...base, VITE_OPENROUTER_MODELS: "a/x:free,b/y:free,c/z:free" },
    { ...base, VITE_OPENROUTER_BASE_URL: "http://openrouter.ai/api/v1" },
    { ...base, VITE_OPENROUTER_BASE_URL: "http://127.0.0.1:4175" },
    { ...base, VITE_AI_DAILY_CAP: "0" },
    { ...base, VITE_AI_DAILY_CAP: "2.5" },
    { ...base, VITE_AI_DAILY_CAP: "101" },
  ];
  for (const env of bad)
    assert.throws(() => aiBuildConfig(env), /AI config/, JSON.stringify(env));
});

test("A local base URL is allowed only with the test-only flag", () => {
  const config = aiBuildConfig({
    ...base,
    VITE_OPENROUTER_BASE_URL: "http://127.0.0.1:4175/api/v1/",
    VITE_AI_ALLOW_LOCAL: "1",
  });
  assert.ok(config);
  assert.equal(config.providers[0].baseUrl, "http://127.0.0.1:4175/api/v1");
  assert.throws(() =>
    aiBuildConfig({
      ...base,
      VITE_OPENROUTER_BASE_URL: "http://evil.example",
      VITE_AI_ALLOW_LOCAL: "1",
    }),
  );
});
