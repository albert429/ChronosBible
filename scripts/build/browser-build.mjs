// The browser tests' two builds, each explicit and self-contained.
//
//   node scripts/build/browser-build.mjs app   -> dist/
//   node scripts/build/browser-build.mjs ai   -> dist-ai/
//
// `app` is the fixture-audio reference build (npm run build: data, type-check,
// bundle). `ai` regenerates the data itself, then bundles the ai-stub
// configuration, so it never depends on an earlier build's app/public/.
// Both set every VITE_* variable the build
// reads (build-config.mjs), so neither inherits shell values; explicit values,
// even empty ones, also take priority over local .env files. Unlike the
// reference builds, they keep local files: no checkout is required to be
// clean, and nothing is deleted except the bundle's own output folder.
import { execFileSync } from "node:child_process";
import { ROOT, isMain } from "../lib/paths.js";
import { buildEnvironment } from "./build-config.mjs";

const node = (args, env) =>
  execFileSync(process.execPath, args, { cwd: ROOT, env, stdio: "inherit" });

/**
 * The child environment of each browser build.
 * @param {string} name "app" or "ai"
 * @param {{ source?: Record<string, string | undefined> }} [options]
 */
export function browserEnvironment(name, { source = process.env } = {}) {
  if (name === "app") return buildEnvironment("fixture-audio", source);
  if (name === "ai") return buildEnvironment("ai-stub", source);
  throw new Error('choose "app" or "ai"');
}

/**
 * @param {string} name "app" or "ai"
 */
export function buildForBrowser(name) {
  const env = browserEnvironment(name);
  if (name === "app") {
    execFileSync("npm", ["run", "build"], { cwd: ROOT, env, stdio: "inherit" });
    return;
  }
  node(
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      "scripts/data/build-data.js",
    ],
    env,
  );
  node(
    [
      "node_modules/vite/bin/vite.js",
      "build",
      "--config",
      "app/vite.config.ts",
      "--outDir",
      "../dist-ai",
      "--emptyOutDir",
      "--logLevel",
      "warn",
    ],
    env,
  );
}

export function main(argv) {
  try {
    const [name, ...extra] = argv;
    if (extra.length || !["app", "ai"].includes(name))
      throw new Error("Usage: browser-build.mjs app | ai");
    buildForBrowser(name);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
