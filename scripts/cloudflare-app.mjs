import {
  copyFileSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { extname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const ROOT = realpathSync(
  fileURLToPath(new URL("../", import.meta.url)),
);
const fail = (message) => {
  throw new Error(`Cloudflare app: ${message}`);
};
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

// AI explanations are allowed on the dev Worker only, and only when its build
// variables set VITE_AI_PROVIDERS. Production never enables them.
const AI_SETTINGS = [
  "VITE_AI_PROVIDERS",
  "VITE_OPENROUTER_API_KEY",
  "VITE_OPENROUTER_MODELS",
  "VITE_AI_DAILY_CAP",
];
export function aiSettings(target, source = process.env) {
  deployment(target);
  const providers = source.VITE_AI_PROVIDERS?.trim();
  if (target !== "dev" || !providers) return undefined;
  return {
    providers,
    // The app trims the key at build time, so that is the value it compiles in.
    key: source.VITE_OPENROUTER_API_KEY?.trim() || undefined,
  };
}

// Use an allowlist: Vite loads .env files AND shell VITE_* values. Neither may
// silently enable AI, fixtures, or a future public setting in this deployment.
// Test-only switches (VITE_OPENROUTER_BASE_URL, VITE_AI_ALLOW_LOCAL) never pass.
/** @returns {Record<string, string | undefined>} */
export function buildEnvironment(target, source = process.env, config = "") {
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
    : { VITE_AI_PROVIDERS: "", VITE_OPENROUTER_API_KEY: "" };
  return {
    ...env,
    CI: "true",
    NODE_ENV: "production",
    VITE_AUDIO_BASE_URL: AUDIO_BASE_URL,
    VITE_AUDIO_CHAPTERS_ENABLED: config.includes("VITE_AUDIO_CHAPTERS_ENABLED")
      ? "true"
      : "false",
    ...ai,
  };
}

function files(root) {
  if (!existsSync(root)) return [];
  if (lstatSync(root).isSymbolicLink())
    fail("symlinks are forbidden in assets");
  if (!lstatSync(root).isDirectory()) return [root];
  return readdirSync(root).flatMap((name) => files(join(root, name)));
}

// The committed redirect rules, or undefined in a checkout without them.
function committedRedirects(root) {
  const path = join(root, "hosting/cloudflare-app/_redirects");
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/**
 * @param {string} [redirects] the committed _redirects a shipped copy must equal
 * @param {string} [allowedKey] the one OpenRouter key a dev build may contain
 */
export function scanAssets(root, env = process.env, redirects, allowedKey) {
  const paths = files(root);
  if (paths.length > 10_000) fail("app assets exceed the 10,000-file budget");
  let bytes = 0;
  const secrets = Object.entries(env)
    .filter(
      ([key, value]) =>
        /KEY|TOKEN|SECRET|PASSWORD/i.test(key) &&
        value?.length >= 12 &&
        (!allowedKey || value.trim() !== allowedKey),
    )
    .map(([, value]) => value);
  for (const file of paths) {
    const size = lstatSync(file).size;
    bytes += size;
    if (size > 8 * 1024 * 1024 || bytes > 64 * 1024 * 1024)
      fail("app assets exceed the 8 MiB/file or 64 MiB total budget");
    if (/\.(?:m4a|mp3|mp4|wav|ogg|opus|aac|flac|webm)$/i.test(file))
      fail("audio/video binaries are forbidden in app assets");
    if (
      /(?:^|\/)\.(?:env(?:\..*)?|dev\.vars(?:\..*)?)$/.test(file) ||
      /\.(?:pem|key)$/i.test(file)
    )
      fail("environment or private-key files are forbidden in app assets");
    if (
      !/^(?:\.html|\.json|\.js|\.css|\.txt|\.svg|\.png|\.jpe?g|\.webp|\.avif|\.ico|\.woff2?)$/i.test(
        extname(file),
      ) &&
      !["_headers", "_redirects"].includes(relative(root, file))
    )
      fail("unexpected file type in app assets");
    if (
      relative(root, file) === "_redirects" &&
      readFileSync(file, "utf8") !== redirects
    )
      fail("_redirects differs from hosting/cloudflare-app/_redirects");
    if (relative(root, file).startsWith("audio/") && extname(file) !== ".json")
      fail("only generated JSON manifests may be shipped under audio/");
    const body = readFileSync(file);
    // Remove the allowed key (exact match) before looking for any other.
    const text = body.toString("utf8");
    const rest = allowedKey ? text.split(allowedKey).join("") : text;
    if (
      secrets.some((value) => body.includes(value)) ||
      /sk-or-v1-[a-zA-Z0-9]{16,}|-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(
        rest,
      )
    )
      fail("a credential was detected in app assets (value redacted)");
  }
}

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
  if (readdirSync(root).some((name) => /^\.dev\.vars(?:\.|$)/.test(name)))
    fail("remove local .dev.vars files from this deployment checkout");
  const config = JSON.parse(readFileSync(join(root, "wrangler.json"), "utf8"));
  const effective = target === "dev" ? config.env?.dev : config;
  if (
    effective?.name !== selected.name ||
    JSON.stringify(effective.routes) !==
      JSON.stringify([{ pattern: selected.domain, custom_domain: true }]) ||
    JSON.stringify(effective.assets) !==
      JSON.stringify({ directory: "./dist" }) ||
    effective.main !== undefined ||
    effective.workers_dev !== false ||
    effective.preview_urls !== false ||
    effective.build?.command !==
      `node scripts/cloudflare-app.mjs build ${target}` ||
    config.main !== undefined
  )
    fail("unexpected Worker, routes, assets, or build configuration");
  const redirects = committedRedirects(root);
  const allowedKey = aiSettings(target, env)?.key;
  scanAssets(join(root, "public"), env, redirects, allowedKey);
  scanAssets(join(root, "dist"), env, redirects, allowedKey);
  return { ...selected, head };
}

export function build(target) {
  preflight(target);
  // Only this checkout's dist can be removed. Public/generated source data is
  // preserved; unexpected local media is rejected above, never deleted.
  rmSync(join(ROOT, "dist"), { recursive: true, force: true });
  const ai = aiSettings(target, process.env);
  execFileSync("npm", ["run", "build"], {
    cwd: ROOT,
    env: buildEnvironment(
      target,
      process.env,
      readFileSync(join(ROOT, "vite.config.ts"), "utf8"),
    ),
    stdio: "inherit",
  });
  for (const name of ["_headers", "_redirects"])
    copyFileSync(
      join(ROOT, "hosting/cloudflare-app", name),
      join(ROOT, "dist", name),
    );
  scanAssets(
    join(ROOT, "dist"),
    process.env,
    committedRedirects(ROOT),
    ai?.key,
  );
  if (
    !ai &&
    files(join(ROOT, "dist/assets")).some((file) =>
      /\/(?:AiPanel|run)-/.test(file),
    )
  )
    fail("AI chunks are forbidden unless the dev build enables AI");
  console.log(
    `Cloudflare ${target}: assets verified; ${
      ai ? `AI enabled (${ai.providers})` : "AI disabled"
    }.`,
  );
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

function deploy(target) {
  preflight(target);
  // A preinstalled CLI only: no npx download, project discovery or autoconfig.
  const cli =
    process.env.CLOUDFLARE_APP_WRANGLER ||
    join(ROOT, "node_modules/.bin/wrangler");
  if (!isAbsolute(cli) || !existsSync(cli))
    fail(
      "install Wrangler separately or set CLOUDFLARE_APP_WRANGLER to its absolute executable path",
    );
  execFileSync(cli, deployArguments(target), {
    cwd: ROOT,
    env: { ...gitEnvironment(), CI: "true", WRANGLER_SEND_METRICS: "false" },
    stdio: "inherit",
  });
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [, , action, target, ...extra] = process.argv;
    if (extra.length) fail("unexpected arguments");
    if (action === "build") build(target);
    else if (action === "deploy") deploy(target);
    else if (action === "preflight") preflight(target);
    else fail("use preflight, build, or deploy followed by production or dev");
  } catch (error) {
    // Failures never print command environment values or file contents.
    console.error(
      error.message?.startsWith("Cloudflare app:")
        ? error.message
        : "Cloudflare app: command failed; deployment stopped.",
    );
    process.exitCode = 1;
  }
}
