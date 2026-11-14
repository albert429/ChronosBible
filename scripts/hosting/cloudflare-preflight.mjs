// Bind deployment to the intended clean checkout, commit and Worker config.
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "../lib/paths.js";
import { AI_RELEASE, deployment, fail } from "./cloudflare-policy.mjs";
import { committedRedirects, scanAssets } from "./cloudflare-assets.mjs";

// Hooks export repository-local routing variables which `git -C` cannot
// override. Drop that context before accessing this checkout or a fixture.
const gitLocalVariables = new Set(
  execFileSync("git", ["rev-parse", "--local-env-vars"], {
    encoding: "utf8",
  })
    .trim()
    .split(/\r?\n/),
);
export function gitEnvironment(source = process.env) {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key]) =>
        !gitLocalVariables.has(key) &&
        !/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key),
    ),
  );
}
const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: gitEnvironment(),
  }).trim();

export function preflight(
  target,
  { root = ROOT, cwd = process.cwd(), env = process.env } = {},
) {
  const selected = deployment(target);
  if (
    realpathSync(cwd) !== realpathSync(root) ||
    realpathSync(git(root, "rev-parse", "--show-toplevel")) !==
      realpathSync(root)
  )
    fail("run from this checkout's repository root");
  const head = git(root, "rev-parse", "HEAD");
  const branch = git(root, "branch", "--show-current");
  if (branch !== selected.branch) {
    // Workers Builds clones the pushed commit detached, without remote refs, so
    // a missing origin ref means "no match" rather than a git error.
    let origin;
    try {
      origin = execFileSync(
        "git",
        [
          "-C",
          root,
          "rev-parse",
          "--verify",
          "--quiet",
          `refs/remotes/origin/${selected.branch}`,
        ],
        {
          encoding: "utf8",
          env: gitEnvironment(),
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
    } catch {
      origin = undefined;
    }
    if (
      branch ||
      (origin !== head &&
        !(
          env.WORKERS_CI_BRANCH === selected.branch &&
          env.WORKERS_CI_COMMIT_SHA === head
        ))
    )
      fail(
        `${target} requires ${selected.branch} (or its exact origin commit detached, or Workers Builds metadata with WORKERS_CI_BRANCH=${selected.branch} and WORKERS_CI_COMMIT_SHA equal to this commit)`,
      );
  }
  if (env.WORKERS_CI_BRANCH && env.WORKERS_CI_BRANCH !== selected.branch)
    fail("Workers Builds branch does not match the selected environment");
  if (env.WORKERS_CI_COMMIT_SHA && env.WORKERS_CI_COMMIT_SHA !== head)
    fail("Workers Builds commit does not match this checkout");
  if (git(root, "status", "--porcelain", "--untracked-files=all"))
    fail("a clean checkout is required");
  // Reject every local Vite env file, even development ones, to prevent a later
  // mode or configuration change from accidentally exposing a private value.
  if (
    readdirSync(root).some(
      (name) => /^\.env(?:\.|$)/.test(name) && name !== ".env.example",
    )
  )
    fail(
      "remove local .env files; Cloudflare uses explicit public build settings",
    );
  if (
    readdirSync(root).some(
      (name) =>
        /^\.dev\.vars(?:\.|$)/.test(name) && name !== ".dev.vars.example",
    )
  )
    fail("remove local .dev.vars files from this deployment checkout");
  const config = JSON.parse(readFileSync(join(root, "wrangler.json"), "utf8"));
  const effective = target === "dev" ? config.env?.dev : config;
  if (
    effective?.name !== selected.name ||
    JSON.stringify(effective.routes) !==
      JSON.stringify([{ pattern: selected.domain, custom_domain: true }]) ||
    JSON.stringify(effective.assets) !==
      JSON.stringify({
        directory: "./dist",
        binding: "ASSETS",
        run_worker_first: ["/api/ai/*"],
      }) ||
    (effective.main ?? config.main) !== "worker/index.ts" ||
    config.compatibility_date !== "2026-10-01" ||
    JSON.stringify(config.compatibility_flags) !==
      JSON.stringify(["enable_request_signal"]) ||
    JSON.stringify(effective.durable_objects) !==
      JSON.stringify({
        bindings: [{ name: "AI", class_name: "AiCoordinator" }],
      }) ||
    JSON.stringify(config.migrations) !==
      JSON.stringify([
        { tag: "ai-v1", new_sqlite_classes: ["AiCoordinator"] },
      ]) ||
    effective.vars?.AI_ENVIRONMENT !== target ||
    effective.vars?.AI_ORIGIN !== `https://${selected.domain}` ||
    !["true", "false"].includes(effective.vars?.AI_ENABLED) ||
    (!AI_RELEASE[target] && effective.vars?.AI_ENABLED !== "false") ||
    effective.workers_dev !== false ||
    effective.preview_urls !== false ||
    effective.build?.command !==
      `node scripts/cloudflare-app.mjs build ${target}`
  )
    fail("unexpected Worker, routes, assets, or build configuration");
  const redirects = committedRedirects(root);
  scanAssets(join(root, "public"), env, redirects);
  scanAssets(join(root, "dist"), env, redirects);
  return { ...selected, head };
}
