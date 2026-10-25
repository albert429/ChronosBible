import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { audioUrl } from "../src/audio/url.ts";
import {
  AUDIO_BASE_URL,
  buildEnvironment,
  deployArguments,
  gitEnvironment,
  preflight,
  scanAssets,
} from "../scripts/cloudflare-app.mjs";

function checkout(branch = "main") {
  const root = mkdtempSync(join(tmpdir(), "cloudflare-app-test-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      env: gitEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", branch);
  writeFileSync(join(root, ".gitignore"), ".env*\npublic/\ndist/\n");
  copyFileSync(
    new URL("../wrangler.json", import.meta.url),
    join(root, "wrangler.json"),
  );
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    "Fixture",
  );
  return {
    root,
    git,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("Build settings strip inherited AI keys, public values and fixtures", () => {
  const source = {
    PATH: "/bin",
    VITE_OPENROUTER_API_KEY: "private-test-key",
    VITE_AI_PROVIDERS: "openrouter",
    VITE_FUTURE_KEY: "private",
    AUDIO_TEST_FIXTURES: "1",
    NODE_OPTIONS: "unsafe",
  };
  const env = buildEnvironment(
    "production",
    source,
    "VITE_AUDIO_CHAPTERS_ENABLED",
  );
  assert.equal(env.VITE_AUDIO_BASE_URL, "https://audio.chronosbible.com");
  assert.equal(buildEnvironment("dev", {}).VITE_AUDIO_BASE_URL, AUDIO_BASE_URL);
  assert.equal(
    audioUrl("/audio/days/a.m4a", env.VITE_AUDIO_BASE_URL),
    "https://audio.chronosbible.com/audio/days/a.m4a",
  );
  assert.equal(env.VITE_AI_PROVIDERS, "");
  assert.equal(env.VITE_OPENROUTER_API_KEY, "");
  assert.equal(env.VITE_AUDIO_CHAPTERS_ENABLED, "false");
  for (const key of ["VITE_FUTURE_KEY", "AUDIO_TEST_FIXTURES", "NODE_OPTIONS"])
    assert.equal(env[key as keyof typeof env], undefined);
  assert.equal(
    buildEnvironment("dev", {}, "VITE_AUDIO_CHAPTERS_ENABLED")
      .VITE_AUDIO_CHAPTERS_ENABLED,
    "true",
  );
  assert.equal(
    buildEnvironment("dev", {}, "older config").VITE_AUDIO_CHAPTERS_ENABLED,
    "false",
  );
});

test("Deploy CLI always selects an explicit config and environment", () => {
  assert.deepEqual(deployArguments("production", "/safe/repo"), [
    "deploy",
    "--config",
    "/safe/repo/wrangler.json",
    "--env",
    "",
  ]);
  assert.deepEqual(deployArguments("dev", "/safe/repo"), [
    "deploy",
    "--config",
    "/safe/repo/wrangler.json",
    "--env",
    "dev",
  ]);
  assert.throws(() => deployArguments("preview"), /production or dev/);
});

test("The build helpers can be imported from a Node stdin module", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: `import { deployment } from ${JSON.stringify(new URL("../scripts/cloudflare-app.mjs", import.meta.url).href)}; console.log(deployment("production").branch);`,
    encoding: "utf8",
    env: gitEnvironment(),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "main");
});

test("Preflight binds environment to a clean branch, checkout root and CI commit", () => {
  const f = checkout();
  const options = { root: f.root, cwd: f.root, env: {} };
  try {
    assert.equal(preflight("production", options).branch, "main");
    assert.throws(() => preflight("dev", options), /requires dev/);
    assert.throws(
      () => preflight("production", { ...options, cwd: tmpdir() }),
      /repository root/,
    );
    assert.throws(
      () =>
        preflight("production", {
          ...options,
          env: { WORKERS_CI_BRANCH: "dev" },
        }),
      /branch does not match/,
    );
    assert.throws(
      () =>
        preflight("production", {
          ...options,
          env: { WORKERS_CI_COMMIT_SHA: "bad" },
        }),
      /commit does not match/,
    );
    writeFileSync(join(f.root, "unreviewed.txt"), "local");
    assert.throws(() => preflight("production", options), /clean checkout/);
    rmSync(join(f.root, "unreviewed.txt"));
    f.git("update-ref", "refs/remotes/origin/main", "HEAD");
    f.git("checkout", "--detach");
    assert.equal(preflight("production", options).branch, "main");
    f.git("checkout", "-b", "task-branch");
    assert.throws(() => preflight("production", options), /requires main/);
    f.git("checkout", "-b", "dev");
    assert.equal(preflight("dev", options).name, "chronosbible-dev");
  } finally {
    f.close();
  }
});

test("Workers Builds detached checkouts need matching CI metadata", () => {
  const f = checkout();
  const head = f.git("rev-parse", "HEAD");
  const options = { root: f.root, cwd: f.root };
  const ci = (branch: string, sha = head) => ({
    ...options,
    env: { WORKERS_CI_BRANCH: branch, WORKERS_CI_COMMIT_SHA: sha },
  });
  try {
    f.git("checkout", "--detach");
    assert.throws(
      () => preflight("production", { ...options, env: {} }),
      /Cloudflare app: production requires main/,
    );
    assert.equal(preflight("production", ci("main")).branch, "main");
    assert.throws(() => preflight("dev", ci("main")), /requires dev/);
    assert.equal(preflight("dev", ci("dev")).name, "chronosbible-dev");
    assert.throws(() => preflight("production", ci("dev")), /requires main/);
    assert.throws(
      () => preflight("production", ci("main", "0".repeat(40))),
      /requires main/,
    );
    f.git("checkout", "-b", "task-branch");
    assert.throws(() => preflight("production", ci("main")), /requires main/);
  } finally {
    f.close();
  }
});

test("Ignored env files and media in public OR old dist stop deployment", () => {
  const f = checkout();
  const options = { root: f.root, cwd: f.root, env: {} };
  try {
    for (const name of [
      ".env",
      ".env.local",
      ".env.production",
      ".env.development.local",
    ]) {
      writeFileSync(join(f.root, name), "VITE_OPENROUTER_API_KEY=private");
      assert.throws(() => preflight("production", options), /local .env/);
      rmSync(join(f.root, name));
    }
    for (const base of ["public", "dist"]) {
      mkdirSync(join(f.root, base, "audio"), { recursive: true });
      writeFileSync(join(f.root, base, "audio/local.m4a"), "binary");
      assert.throws(
        () => preflight("production", options),
        /binaries are forbidden/,
      );
      rmSync(join(f.root, base), { recursive: true });
    }
    mkdirSync(join(f.root, "dist"));
    writeFileSync(join(f.root, "dist/app.js"), "known-private-value-123");
    assert.throws(
      () =>
        scanAssets(join(f.root, "dist"), {
          PRIVATE_KEY: "known-private-value-123",
        }),
      /credential/,
    );
    writeFileSync(join(f.root, "dist/app.js"), "sk-or-v1-12345678901234567890");
    assert.throws(() => scanAssets(join(f.root, "dist"), {}), /credential/);
    rmSync(join(f.root, "dist/app.js"));
    symlinkSync(tmpdir(), join(f.root, "dist/linked"));
    assert.throws(() => scanAssets(join(f.root, "dist")), /symlinks/);
  } finally {
    f.close();
  }
});

test("CLI rejects a wrong cwd before removing dist or running a build", () => {
  const f = checkout();
  try {
    mkdirSync(join(f.root, "dist"));
    writeFileSync(join(f.root, "dist/keep.txt"), "preserved");
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/cloudflare-app.mjs", import.meta.url),
        ),
        "build",
        "production",
      ],
      { cwd: f.root, encoding: "utf8", env: gitEnvironment() },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /repository root/);
    assert.equal(
      readFileSync(join(f.root, "dist/keep.txt"), "utf8"),
      "preserved",
    );
  } finally {
    f.close();
  }
});

test("Asset audit rejects unexpected file types, audio artifacts and oversized files", () => {
  const root = mkdtempSync(join(tmpdir(), "cloudflare-assets-test-"));
  try {
    writeFileSync(join(root, "archive.zip"), "unexpected");
    assert.throws(() => scanAssets(root, {}), /unexpected file type/);
    rmSync(join(root, "archive.zip"));
    mkdirSync(join(root, "audio"));
    writeFileSync(join(root, "audio/generated.txt"), "unexpected");
    assert.throws(() => scanAssets(root, {}), /only generated JSON/);
    rmSync(join(root, "audio/generated.txt"));
    writeFileSync(join(root, "huge.json"), "");
    truncateSync(join(root, "huge.json"), 8 * 1024 * 1024 + 1);
    assert.throws(() => scanAssets(root, {}), /budget/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Safe build runs from the selected clean checkout and never inherits private settings", () => {
  for (const target of ["production", "dev"]) {
    const f = checkout(target === "production" ? "main" : "dev");
    try {
      mkdirSync(join(f.root, "scripts"));
      copyFileSync(
        new URL("../scripts/cloudflare-app.mjs", import.meta.url),
        join(f.root, "scripts/cloudflare-app.mjs"),
      );
      mkdirSync(join(f.root, "hosting/cloudflare-app"), { recursive: true });
      writeFileSync(
        join(f.root, "hosting/cloudflare-app/_headers"),
        "/assets/*\n  Cache-Control: public\n",
      );
      writeFileSync(
        join(f.root, "vite.config.ts"),
        "// VITE_AUDIO_CHAPTERS_ENABLED supported",
      );
      writeFileSync(
        join(f.root, "package.json"),
        JSON.stringify({
          scripts: { build: "node scripts/fixture-build.cjs" },
        }),
      );
      writeFileSync(
        join(f.root, "scripts/fixture-build.cjs"),
        `
const fs = require("node:fs");
const assert = require("node:assert/strict");
assert.equal(process.env.VITE_OPENROUTER_API_KEY, "");
assert.equal(process.env.VITE_AI_PROVIDERS, "");
assert.equal(process.env.VITE_FUTURE_KEY, undefined);
assert.equal(process.env.AUDIO_TEST_FIXTURES, undefined);
assert.equal(process.env.VITE_AUDIO_BASE_URL, ${JSON.stringify(AUDIO_BASE_URL)});
assert.equal(process.env.VITE_AUDIO_CHAPTERS_ENABLED, ${JSON.stringify(target === "dev" ? "true" : "false")});
fs.mkdirSync("dist");
fs.writeFileSync("dist/index.html", "safe app");
`,
      );
      f.git("add", ".");
      f.git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.test",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "-m",
        "Build fixture",
      );
      mkdirSync(join(f.root, "dist"));
      writeFileSync(join(f.root, "dist/stale.txt"), "old");
      mkdirSync(join(f.root, "public"));
      writeFileSync(join(f.root, "public/keep.json"), "{}");
      const result = spawnSync(
        process.execPath,
        [join(f.root, "scripts/cloudflare-app.mjs"), "build", target],
        {
          cwd: f.root,
          env: {
            ...gitEnvironment(),
            VITE_OPENROUTER_API_KEY: "private-test-key-123",
            VITE_AI_PROVIDERS: "openrouter",
            VITE_FUTURE_KEY: "private-test-key-123",
            AUDIO_TEST_FIXTURES: "1",
          },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.equal(
        readFileSync(join(f.root, "dist/index.html"), "utf8"),
        "safe app",
      );
      assert.match(
        readFileSync(join(f.root, "dist/_headers"), "utf8"),
        /Cache-Control/,
      );
      assert.equal(
        readFileSync(join(f.root, "public/keep.json"), "utf8"),
        "{}",
      );
      assert.throws(
        () => readFileSync(join(f.root, "dist/stale.txt")),
        /ENOENT/,
      );
      assert.ok(!result.stdout.includes("private-test-key-123"));
    } finally {
      f.close();
    }
  }
});

test(
  "Inherited Git hook context cannot change the outer HEAD, index or config",
  {
    skip: process.env.CLOUDFLARE_GIT_REGRESSION_CHILD === "1",
  },
  () => {
    const outer = checkout();
    try {
      const head = outer.git("rev-parse", "HEAD");
      const index = readFileSync(join(outer.root, ".git/index"));
      const config = readFileSync(join(outer.root, ".git/config"));
      const childEnv: NodeJS.ProcessEnv = {
        ...gitEnvironment(),
        CLOUDFLARE_GIT_REGRESSION_CHILD: "1",
        GIT_DIR: join(outer.root, ".git"),
        GIT_COMMON_DIR: join(outer.root, ".git"),
        GIT_WORK_TREE: outer.root,
        GIT_INDEX_FILE: join(outer.root, ".git/index"),
        GIT_PREFIX: "",
      };
      // A nested node --test otherwise silently skips executing its test files.
      delete childEnv.NODE_TEST_CONTEXT;
      const result = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "--test",
          fileURLToPath(new URL("./cloudflare-app.test.ts", import.meta.url)),
        ],
        {
          env: childEnv,
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /# pass 9\b/);
      assert.equal(outer.git("rev-parse", "HEAD"), head);
      assert.deepEqual(readFileSync(join(outer.root, ".git/index")), index);
      assert.deepEqual(readFileSync(join(outer.root, ".git/config")), config);
    } finally {
      outer.close();
    }
  },
);
