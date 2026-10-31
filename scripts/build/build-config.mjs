// The three reference build configurations, each fully explicit and clean:
// no .env files, no inherited VITE_* or test variables, freshly generated
// data. Refactors are verified by building the same configurations before and
// after (artifacts/refactor/VERIFY.md).
//
//   node scripts/build/build-config.mjs list
//   node scripts/build/build-config.mjs env <name>      print the build environment
//   node scripts/build/build-config.mjs build <name>    clean, then build it
//
//   production-audio  what Cloudflare production builds (AI off) -> dist/
//   fixture-audio     what `npm run test:e2e` builds             -> dist/
//   ai-stub           what the `ai-chromium` project builds      -> dist-ai/
//                     (after the fixture-audio build it reuses)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ROOT, isMain } from "../lib/paths.js";
import { GENERATED_FOLDERS } from "../quality/snapshot.mjs";

/** The port the AI stub listens on in the reference build (PW_PORT 4400 + 2). */
export const STUB_PORT = 4402;

const ALL_VITE = {
  VITE_AUDIO_BASE_URL: "",
  VITE_AUDIO_CHAPTERS_ENABLED: "",
  VITE_AI_PROVIDERS: "",
  VITE_OPENROUTER_API_KEY: "",
  VITE_OPENROUTER_MODELS: "",
  VITE_OPENROUTER_BASE_URL: "",
  VITE_AI_ALLOW_LOCAL: "",
  VITE_AI_DAILY_CAP: "",
};

const FIXTURE_AUDIO = {
  ...ALL_VITE,
  AUDIO_TEST_FIXTURES: "1",
  VITE_AUDIO_BASE_URL: "https://audio.example.test",
  VITE_AUDIO_CHAPTERS_ENABLED: "true",
};

/**
 * @typedef {{ description: string, outDir: string, env: Record<string, string>,
 *   prepare?: string }} BuildConfig
 * @type {Record<string, BuildConfig>}
 */
export const CONFIGS = {
  "production-audio": {
    description:
      "Production: hosted audio, chapters enabled, AI off (hosting/cloudflare-app.mjs buildEnvironment).",
    outDir: "dist",
    env: {
      ...ALL_VITE,
      CI: "true",
      NODE_ENV: "production",
      VITE_AUDIO_BASE_URL: "https://audio.chronosbible.com",
      VITE_AUDIO_CHAPTERS_ENABLED: "true",
    },
  },
  "fixture-audio": {
    description: "npm run test:e2e: fixture audio host, chapters enabled.",
    outDir: "dist",
    env: FIXTURE_AUDIO,
  },
  "ai-stub": {
    description:
      "ai-chromium project: fixture audio plus the AI card against the local SSE stub.",
    outDir: "dist-ai",
    prepare: "fixture-audio",
    env: {
      ...FIXTURE_AUDIO,
      VITE_AI_PROVIDERS: "openrouter",
      VITE_OPENROUTER_API_KEY: "sk-or-v1-playwright-dummy-key",
      VITE_OPENROUTER_MODELS: "",
      VITE_OPENROUTER_BASE_URL: `http://127.0.0.1:${STUB_PORT}/api/v1`,
      VITE_AI_ALLOW_LOCAL: "1",
      VITE_AI_DAILY_CAP: "",
    },
  },
};

const BASE_VARIABLES = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG"];

/**
 * The complete child environment: a few system variables plus the config.
 * @returns {Record<string, string | undefined>}
 */
export function buildEnvironment(name, source = process.env) {
  const config = CONFIGS[name];
  if (!config) throw new Error(`unknown configuration "${name}"`);
  /** @type {Record<string, string | undefined>} */
  const env = {};
  for (const key of BASE_VARIABLES)
    if (source[key] !== undefined) env[key] = source[key];
  return { ...env, ...config.env };
}

/** Throws when a local file could leak into, or alter, a reference build. */
export function assertClean(root = ROOT) {
  const stray = readdirSync(root).filter(
    (name) => /^\.env(?:\.|$)/.test(name) && name !== ".env.example",
  );
  if (stray.length)
    throw new Error(`remove local env files first: ${stray.join(", ")}`);
  const audio = join(root, "public/audio");
  if (existsSync(audio)) {
    const media = readdirSync(audio, { recursive: true }).filter(
      (file) => typeof file === "string" && /\.(m4a|mp3|wav|opus)$/i.test(file),
    );
    if (media.length)
      throw new Error("public/audio holds local media; refusing to delete it");
  }
}

/** Remove build output and generated data so nothing stale can be measured. */
export function clean(root = ROOT, outDirs = ["dist", "dist-ai"]) {
  for (const dir of outDirs)
    rmSync(join(root, dir), { recursive: true, force: true });
  for (const folder of GENERATED_FOLDERS)
    rmSync(join(root, "public", folder), { recursive: true, force: true });
}

const run = (root, command, args, env) =>
  execFileSync(command, args, { cwd: root, env, stdio: "inherit" });

export function build(name, root = ROOT) {
  const config = CONFIGS[name];
  if (!config) throw new Error(`unknown configuration "${name}"`);
  assertClean(root);
  clean(root);
  const base = config.prepare ?? name;
  run(root, "npm", ["run", "build"], buildEnvironment(base));
  if (base !== name)
    run(
      root,
      "npx",
      [
        "--no-install",
        "vite",
        "build",
        "--outDir",
        config.outDir,
        "--emptyOutDir",
        "--logLevel",
        "warn",
      ],
      buildEnvironment(name),
    );
  console.log(`Built ${name} into ${config.outDir}/ from ${readHead(root)}`);
}

function readHead(root) {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "an unknown commit";
  }
}

export function main(argv) {
  const [command, name] = argv;
  try {
    if (command === "list") {
      for (const [key, config] of Object.entries(CONFIGS))
        console.log(
          `${key.padEnd(17)} ${config.outDir.padEnd(8)} ${config.description}`,
        );
    } else if (command === "env" && name) {
      const env = buildEnvironment(name);
      for (const key of Object.keys(env).sort())
        if (!BASE_VARIABLES.includes(key)) console.log(`${key}=${env[key]}`);
    } else if (command === "build" && name) build(name);
    else {
      console.error("Usage: build-config.mjs list | env <name> | build <name>");
      return 2;
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
