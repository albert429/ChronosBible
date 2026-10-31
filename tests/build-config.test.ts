import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  CONFIGS,
  assertClean,
  buildEnvironment,
} from "../scripts/build-config.mjs";
import { buildEnvironment as productionEnvironment } from "../scripts/cloudflare-app.mjs";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const viteKeys = (env: Record<string, string | undefined>) =>
  Object.keys(env)
    .filter((key) => key.startsWith("VITE_"))
    .sort();

test("Every reference configuration sets every VITE_ variable the build reads", () => {
  const read_ = new Set(
    [read("vite.config.ts"), read("src/ai/config.ts")]
      .join("\n")
      .match(/VITE_[A-Z_]+/g),
  );
  assert.ok(read_.size >= 8);
  for (const [name, config] of Object.entries(CONFIGS)) {
    assert.deepEqual(viteKeys(config.env), [...read_].sort(), name);
    assert.equal(config.outDir, name === "ai-stub" ? "dist-ai" : "dist");
  }
});

test("production-audio matches what the Cloudflare production build sets", () => {
  const expected = productionEnvironment(
    "production",
    {},
    read("vite.config.ts"),
  );
  const actual = CONFIGS["production-audio"].env as Record<string, string>;
  for (const key of [...viteKeys(expected), "CI", "NODE_ENV"])
    assert.equal(actual[key], expected[key as keyof typeof expected], key);
  // Optional AI settings stay empty: production builds without AI.
  assert.equal(actual.VITE_AI_PROVIDERS, "");
  assert.equal(actual.VITE_OPENROUTER_API_KEY, "");
});

test("fixture-audio matches the variables npm run test:e2e exports", () => {
  const script: string = JSON.parse(read("package.json")).scripts["test:e2e"];
  const exported = script.match(/export ([^&]+?) &&/)?.[1] ?? "";
  const expected = Object.fromEntries(
    exported.split(" ").map((pair) => pair.split("=") as [string, string]),
  );
  const fixture = CONFIGS["fixture-audio"].env as Record<string, string>;
  for (const [key, value] of Object.entries(expected))
    assert.equal(fixture[key], value, key);
  assert.equal(fixture.VITE_AI_PROVIDERS, "");
});

test("ai-stub matches the ai-chromium build in playwright.config.ts", () => {
  // The config cannot be imported by Node (extensionless import), so read the
  // AI build's env block as text.
  const config = read("playwright.config.ts");
  const block = config.slice(config.indexOf("--outDir dist-ai"));
  const env = Object.fromEntries(
    [
      ...block.slice(block.indexOf("env: {")).matchAll(/(VITE_\w+): (.+?),\n/g),
    ].map(([, key, value]) => [key, value]),
  );
  const key = read("tests/browser/ai-stub.ts").match(/AI_KEY = "([^"]+)"/)?.[1];
  const resolved: Record<string, string> = {};
  for (const [name, value] of Object.entries(env))
    resolved[name] = value
      .replace("AI_KEY", JSON.stringify(key))
      .replace("`${STUB_URL}/api/v1`", '"http://127.0.0.1:PORT/api/v1"')
      .replace(/^"(.*)"$/, "$1");
  assert.equal(Object.keys(resolved).length, 6);
  const stub = CONFIGS["ai-stub"].env as Record<string, string>;
  for (const [name, value] of Object.entries(resolved))
    assert.equal(stub[name].replace(/:\d+\//, ":PORT/"), value, name);
  // The AI project inherits the fixture-audio build variables.
  for (const [name, value] of Object.entries(CONFIGS["fixture-audio"].env))
    if (!(name in resolved)) assert.equal(stub[name], value, name);
});

test("Build environments drop inherited VITE_, fixture and credential variables", () => {
  const env = buildEnvironment("production-audio", {
    PATH: "/bin",
    HOME: "/home/x",
    VITE_FUTURE_KEY: "x",
    VITE_OPENROUTER_API_KEY: "sk-private",
    AUDIO_TEST_FIXTURES: "1",
    NODE_OPTIONS: "--bad",
    CLOUDFLARE_API_TOKEN: "secret",
  });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.VITE_OPENROUTER_API_KEY, "");
  assert.equal(env.AUDIO_TEST_FIXTURES, undefined);
  for (const key of ["VITE_FUTURE_KEY", "NODE_OPTIONS", "CLOUDFLARE_API_TOKEN"])
    assert.equal(env[key], undefined);
  assert.throws(() => buildEnvironment("nope"), /unknown configuration/);
});

test("A reference build refuses local env files and local audio media", () => {
  const root = mkdtempSync(join(tmpdir(), "build config "));
  try {
    assertClean(root);
    writeFileSync(join(root, ".env.example"), "");
    assertClean(root);
    writeFileSync(join(root, ".env.local"), "VITE_X=1");
    assert.throws(() => assertClean(root), /\.env\.local/);
    rmSync(join(root, ".env.local"));
    mkdirSync(join(root, "public/audio/days"), { recursive: true });
    writeFileSync(join(root, "public/audio/days/1.m4a"), "x");
    assert.throws(() => assertClean(root), /local media/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
