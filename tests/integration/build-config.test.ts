import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  CONFIGS,
  STUB_PORT,
  assertClean,
  buildEnvironment,
} from "../../scripts/build/build-config.mjs";
import { browserEnvironment } from "../../scripts/build/browser-build.mjs";
import { buildEnvironment as productionEnvironment } from "../../scripts/hosting/cloudflare-policy.mjs";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const viteKeys = (env: Record<string, string | undefined>) =>
  Object.keys(env)
    .filter((key) => key.startsWith("VITE_"))
    .sort();

test("Every reference configuration sets every VITE_ variable the build reads", () => {
  const read_ = new Set(
    [
      read("vite.config.ts"),
      ...readdirSync(new URL("../../scripts/build/", import.meta.url))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => read(`scripts/build/${name}`)),
    ]
      .join("\n")
      .match(/VITE_[A-Z_]+/g),
  );
  assert.ok(read_.size >= 4);
  for (const [name, config] of Object.entries(CONFIGS)) {
    assert.deepEqual(viteKeys(config.env), [...read_].sort(), name);
    assert.equal(config.outDir, name === "ai-stub" ? "dist-ai" : "dist");
  }
});

test("production-audio matches what the Cloudflare production build sets", () => {
  const expected = productionEnvironment("production", {});
  const actual = CONFIGS["production-audio"].env as Record<string, string>;
  for (const key of [...viteKeys(expected), "CI", "NODE_ENV"])
    assert.equal(actual[key], expected[key as keyof typeof expected], key);
  // Optional AI settings stay empty: production builds without AI.
  assert.equal(actual.VITE_AI_ENABLED, "false");
  assert.equal(actual.VITE_OPENROUTER_API_KEY, undefined);
  // The explicit chapter policy, pinned here too: the reference build is what
  // production builds, and production advertises hosted chapters.
  assert.equal(actual.VITE_AUDIO_CHAPTERS_ENABLED, "true");
  assert.equal(actual.VITE_AUDIO_BASE_URL, "https://audio.chronosbible.com");
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
  assert.equal(fixture.VITE_AI_ENABLED, "false");
});

test("The browser builds are the fixture-audio and ai-stub configurations", () => {
  const system = { PATH: "/bin", HOME: "/home/x" };
  const inherited = {
    ...system,
    VITE_AI_PROVIDERS: "openrouter",
    VITE_OPENROUTER_API_KEY: "sk-or-v1-from-the-shell",
    VITE_FUTURE_KEY: "x",
  };
  assert.deepEqual(
    browserEnvironment("app", { source: inherited }),
    buildEnvironment("fixture-audio", system),
  );
  // The reference ai-stub build is the browser AI build on PW_PORT 4400.
  assert.deepEqual(
    browserEnvironment("ai", { stubPort: STUB_PORT, source: inherited }),
    buildEnvironment("ai-stub", system),
  );
  const ai = browserEnvironment("ai", { stubPort: 4432, source: {} });
  assert.equal(ai.VITE_OPENROUTER_BASE_URL, undefined);
  assert.equal(ai.VITE_OPENROUTER_API_KEY, undefined);
  assert.equal(ai.VITE_AI_ENABLED, "true");
  for (const [name, value] of Object.entries(CONFIGS["fixture-audio"].env))
    if (!name.startsWith("VITE_AI") && !name.startsWith("VITE_TURNSTILE"))
      assert.equal(ai[name], value, name);
  assert.throws(
    () => browserEnvironment("ai", { stubPort: undefined, source: {} }),
    /stub port/,
  );
  assert.throws(() => browserEnvironment("other", { source: {} }), /app/);
});

test("Playwright builds explicitly and never reuses a server on its ports", async () => {
  const { default: config } = await import("../../config/playwright.config.ts");
  const { PW_PORT } = await import("../browser/ai-stub.ts");
  const servers = config.webServer as {
    command: string;
    reuseExistingServer?: boolean;
    env?: Record<string, string>;
  }[];
  assert.equal(servers.length, 3);
  for (const server of servers) assert.equal(server.reuseExistingServer, false);
  assert.equal(
    servers[0].command,
    `node scripts/quality/static-server.mjs dist --port ${PW_PORT}`,
  );
  assert.deepEqual(servers[1].env, { SSE_STUB_PORT: String(PW_PORT + 2) });
  assert.equal(
    servers[2].command,
    `node scripts/build/browser-build.mjs ai --stub-port ${PW_PORT + 2} && node scripts/worker/browser-server.mjs`,
  );
  // No build variables come from the config: the build sets them all.
  assert.deepEqual(servers[2].env, { PW_PORT: String(PW_PORT) });
  const e2e: string = JSON.parse(read("package.json")).scripts["test:e2e"];
  assert.match(
    e2e,
    /&& node scripts\/build\/browser-build\.mjs app && playwright test --config config\/playwright.config\.ts$/,
  );
  assert.deepEqual(
    config.projects?.map((project) => project.name),
    ["chromium", "mobile-webkit", "ai-chromium"],
  );
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
  assert.equal(env.VITE_OPENROUTER_API_KEY, undefined);
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

test("Playwright server working directories decode checkout paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "playwright checkout ü # "));
  try {
    mkdirSync(join(root, "config"));
    const source = read("config/playwright.config.ts")
      .replace(
        '"@playwright/test"',
        JSON.stringify(import.meta.resolve("@playwright/test")),
      )
      .replace(
        '"../tests/browser/ai-stub.ts"',
        JSON.stringify(new URL("../browser/ai-stub.ts", import.meta.url).href),
      );
    const configPath = join(root, "config/playwright.config.ts");
    writeFileSync(configPath, source);
    const { default: config } = await import(pathToFileURL(configPath).href);
    for (const server of config.webServer)
      assert.equal(server.cwd, realpathSync(root) + sep);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
