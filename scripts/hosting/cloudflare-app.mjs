// Build/deploy orchestration for the stable scripts/cloudflare-app.mjs CLI.
// Policy, checkout verification and asset auditing remain independently testable.
import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, isMain } from "../lib/paths.js";
import {
  aiSettings,
  buildEnvironment,
  deployArguments,
  fail,
} from "./cloudflare-policy.mjs";
import { committedRedirects, files, scanAssets } from "./cloudflare-assets.mjs";
import { gitEnvironment, preflight } from "./cloudflare-preflight.mjs";

export function build(target) {
  preflight(target);
  // Only this checkout's dist can be removed. Public/generated source data is
  // preserved; unexpected local media is rejected above, never deleted.
  rmSync(join(ROOT, "dist"), { recursive: true, force: true });
  const ai = aiSettings(target, process.env);
  execFileSync("npm", ["run", "build"], {
    cwd: ROOT,
    env: buildEnvironment(target, process.env),
    stdio: "inherit",
  });
  for (const name of ["_headers", "_redirects"])
    copyFileSync(
      join(ROOT, "hosting/cloudflare-app", name),
      join(ROOT, "dist", name),
    );
  scanAssets(join(ROOT, "dist"), process.env, committedRedirects(ROOT));
  if (
    !ai &&
    files(join(ROOT, "dist/assets")).some((file) =>
      /\/(?:AiPanel|run)-/.test(file),
    )
  )
    fail(
      "AI chunks are forbidden unless the release gate and public build flag enable AI",
    );
  console.log(
    `Cloudflare ${target}: assets verified; ${
      ai ? "AI enabled (same-origin Worker API)" : "AI disabled"
    }.`,
  );
}

function deploy(target, disableOnly = false) {
  preflight(target);
  // A preinstalled CLI only: no npx download, project discovery or autoconfig.
  const cli =
    process.env.CLOUDFLARE_APP_WRANGLER ||
    join(ROOT, "node_modules/.bin/wrangler");
  if (!isAbsolute(cli) || !existsSync(cli))
    fail(
      "install Wrangler separately or set CLOUDFLARE_APP_WRANGLER to its absolute executable path",
    );
  if (disableOnly) {
    const config = JSON.parse(
      readFileSync(join(ROOT, "wrangler.json"), "utf8"),
    );
    const effective = target === "dev" ? config.env.dev : config;
    if (
      effective.vars.AI_ENABLED !== "false" ||
      !existsSync(join(ROOT, "dist/index.html"))
    )
      fail(
        "disable deployment requires AI_ENABLED=false and verified existing dist assets",
      );
  }
  execFileSync(
    cli,
    [...deployArguments(target), ...(disableOnly ? ["--no-build"] : [])],
    {
      cwd: ROOT,
      env: { ...gitEnvironment(), CI: "true", WRANGLER_SEND_METRICS: "false" },
      stdio: "inherit",
    },
  );
}

/** @returns {number} the process exit code */
export function main(argv) {
  try {
    const [action, target, ...extra] = argv;
    if (extra.length) fail("unexpected arguments");
    if (action === "build") build(target);
    else if (action === "deploy") deploy(target);
    else if (action === "disable") deploy(target, true);
    else if (action === "preflight") preflight(target);
    else fail("use preflight, build, or deploy followed by production or dev");
    return 0;
  } catch (error) {
    // Failures never print command environment values or file contents.
    console.error(
      error.message?.startsWith("Cloudflare app:")
        ? error.message
        : "Cloudflare app: command failed; deployment stopped.",
    );
    return 1;
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
