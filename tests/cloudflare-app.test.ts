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
import { gzipSync } from "node:zlib";
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
  mkdirSync(join(root, "data"));
  copyFileSync(
    new URL("../data/books.json", import.meta.url),
    join(root, "data/books.json"),
  );
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
  assert.equal(env.VITE_AUDIO_CHAPTERS_ENABLED, "true");
  assert.equal(
    buildEnvironment("production", source, "older config")
      .VITE_AUDIO_CHAPTERS_ENABLED,
    "false",
  );
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

const DUMMY_KEY = "sk-or-v1-0123456789abcdef0123456789abcdef";
const OTHER_KEY = "sk-or-v1-fedcba9876543210fedcba9876543210";
const AI_ENV = {
  PATH: "/bin",
  VITE_AI_PROVIDERS: "openrouter",
  VITE_OPENROUTER_API_KEY: DUMMY_KEY,
  VITE_OPENROUTER_MODELS: "google/gemma-4-31b-it:free",
  VITE_AI_DAILY_CAP: "5",
  VITE_OPENROUTER_BASE_URL: "http://127.0.0.1:4175",
  VITE_AI_ALLOW_LOCAL: "1",
};

test("Production ignores AI settings; dev without them stays off", () => {
  for (const [target, source] of [
    ["production", AI_ENV],
    ["dev", { PATH: "/bin" }],
    ["dev", { ...AI_ENV, VITE_AI_PROVIDERS: " " }],
  ] as const) {
    const env = buildEnvironment(target, source);
    assert.equal(env.VITE_AI_PROVIDERS, "");
    assert.equal(env.VITE_OPENROUTER_API_KEY, "");
    for (const key of [
      "VITE_OPENROUTER_MODELS",
      "VITE_AI_DAILY_CAP",
      "VITE_OPENROUTER_BASE_URL",
      "VITE_AI_ALLOW_LOCAL",
    ])
      assert.equal(env[key as keyof typeof env], undefined);
  }
});

test("Dev passes exactly four AI settings and never the test-only switches", () => {
  const env = buildEnvironment("dev", AI_ENV);
  assert.equal(env.VITE_AI_PROVIDERS, "openrouter");
  assert.equal(env.VITE_OPENROUTER_API_KEY, DUMMY_KEY);
  assert.equal(env.VITE_OPENROUTER_MODELS, "google/gemma-4-31b-it:free");
  assert.equal(env.VITE_AI_DAILY_CAP, "5");
  assert.equal(env.VITE_OPENROUTER_BASE_URL, undefined);
  assert.equal(env.VITE_AI_ALLOW_LOCAL, undefined);
  // Optional values that are not set stay unset.
  const minimal = buildEnvironment("dev", {
    VITE_AI_PROVIDERS: "openrouter",
    VITE_OPENROUTER_API_KEY: DUMMY_KEY,
  });
  assert.equal(minimal.VITE_OPENROUTER_MODELS, undefined);
  assert.equal(minimal.VITE_AI_DAILY_CAP, undefined);
});

test("Dev audit accepts only the configured key and AI only when enabled", () => {
  const root = mkdtempSync(join(tmpdir(), "cloudflare-ai-assets-test-"));
  const env = { VITE_OPENROUTER_API_KEY: DUMMY_KEY };
  try {
    writeFileSync(join(root, "app.js"), `const k="${DUMMY_KEY}";`);
    // Production and dev without AI reject the key, even the same value.
    assert.throws(() => scanAssets(root, env), /credential/);
    assert.throws(() => scanAssets(root, {}), /credential/);
    scanAssets(root, env, undefined, DUMMY_KEY);
    // A different key, alone or beside the configured one, still fails.
    writeFileSync(join(root, "app.js"), `"${DUMMY_KEY}","${OTHER_KEY}"`);
    assert.throws(
      () => scanAssets(root, env, undefined, DUMMY_KEY),
      /credential/,
    );
    writeFileSync(join(root, "app.js"), `"${OTHER_KEY}"`);
    assert.throws(
      () => scanAssets(root, env, undefined, DUMMY_KEY),
      /credential/,
    );
    // Other secret env values and private keys still fail in a dev AI build.
    writeFileSync(join(root, "app.js"), `${DUMMY_KEY} other-secret-value-123`);
    assert.throws(
      () =>
        scanAssets(
          root,
          { ...env, SOME_TOKEN: "other-secret-value-123" },
          undefined,
          DUMMY_KEY,
        ),
      /credential/,
    );
    writeFileSync(
      join(root, "app.js"),
      `${DUMMY_KEY}-----BEGIN PRIVATE KEY-----`,
    );
    assert.throws(
      () => scanAssets(root, env, undefined, DUMMY_KEY),
      /credential/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
    type Wrangler = { main?: string; assets: Record<string, unknown> };
    // The app is assets-only: a Worker entry point or asset binding is refused.
    const wrangler = readFileSync(join(f.root, "wrangler.json"), "utf8");
    for (const edit of [
      (c: Wrangler) => (c.main = "hosting/cloudflare-app/worker.js"),
      (c: Wrangler) => (c.assets.binding = "ASSETS"),
      (c: Wrangler) => (c.assets.run_worker_first = ["/audio/*"]),
    ]) {
      const config = JSON.parse(wrangler);
      edit(config);
      writeFileSync(join(f.root, "wrangler.json"), JSON.stringify(config));
      f.git("update-index", "--assume-unchanged", "wrangler.json");
      assert.throws(
        () => preflight("production", options),
        /unexpected Worker, routes, assets, or build/,
      );
    }
    f.git("update-index", "--no-assume-unchanged", "wrangler.json");
    writeFileSync(join(f.root, "wrangler.json"), wrangler);
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
    rmSync(join(root, "huge.json"));
    // Redirect rules ship only exactly as committed.
    writeFileSync(join(root, "_redirects"), "/audio/days/* /elsewhere 301\n");
    assert.throws(() => scanAssets(root, {}), /_redirects differs/);
    assert.throws(
      () => scanAssets(root, {}, "/audio/days/* /other 301\n"),
      /_redirects differs/,
    );
    scanAssets(root, {}, "/audio/days/* /elsewhere 301\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Each case runs the real wrapper against a fixture checkout whose build script
// asserts the exact environment it receives and writes the given extra assets.
const buildCases = [
  {
    name: "production ignores AI env",
    target: "production",
    ai: { VITE_AI_PROVIDERS: "openrouter", VITE_OPENROUTER_API_KEY: DUMMY_KEY },
    expectAi: false,
    assets: {},
    fails: undefined,
  },
  {
    name: "production rejects AI chunks",
    target: "production",
    ai: { VITE_AI_PROVIDERS: "openrouter", VITE_OPENROUTER_API_KEY: DUMMY_KEY },
    expectAi: false,
    assets: { "assets/AiPanel-abc.js": "chunk" },
    fails: /AI chunks are forbidden/,
  },
  {
    name: "production rejects the key",
    target: "production",
    ai: { VITE_AI_PROVIDERS: "openrouter", VITE_OPENROUTER_API_KEY: DUMMY_KEY },
    expectAi: false,
    assets: { "assets/app.js": DUMMY_KEY },
    fails: /credential/,
  },
  {
    name: "dev without AI env stays off",
    target: "dev",
    ai: {},
    expectAi: false,
    assets: {},
    fails: undefined,
  },
  {
    name: "dev without AI env rejects AI chunks",
    target: "dev",
    ai: {},
    expectAi: false,
    assets: { "assets/run-abc.js": "chunk" },
    fails: /AI chunks are forbidden/,
  },
  {
    name: "dev with AI env passes the settings and the audit",
    target: "dev",
    ai: {
      VITE_AI_PROVIDERS: "openrouter",
      VITE_OPENROUTER_API_KEY: DUMMY_KEY,
      VITE_OPENROUTER_MODELS: "google/gemma-4-31b-it:free",
      VITE_AI_DAILY_CAP: "5",
    },
    expectAi: true,
    assets: {
      "assets/AiPanel-abc.js": "chunk",
      "assets/run-abc.js": `fetch("x",{headers:{Authorization:"Bearer ${DUMMY_KEY}"}})`,
    },
    fails: undefined,
  },
  {
    name: "dev with AI env rejects a different key",
    target: "dev",
    ai: { VITE_AI_PROVIDERS: "openrouter", VITE_OPENROUTER_API_KEY: DUMMY_KEY },
    expectAi: true,
    assets: { "assets/run-abc.js": `"${DUMMY_KEY}","${OTHER_KEY}"` },
    fails: /credential/,
  },
] as const;

for (const testCase of buildCases) {
  test(`Safe build: ${testCase.name}`, () => {
    const { target, ai, expectAi, assets, fails } = testCase;
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
        join(f.root, "hosting/cloudflare-app/_redirects"),
        "/audio/days/* https://audio.example.test/audio/days/:splat 301\n",
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
const path = require("node:path");
const assert = require("node:assert/strict");
const expectAi = ${JSON.stringify(expectAi)};
assert.equal(
  process.env.VITE_OPENROUTER_API_KEY,
  expectAi ? ${JSON.stringify(DUMMY_KEY)} : "",
);
assert.equal(process.env.VITE_AI_PROVIDERS, expectAi ? "openrouter" : "");
assert.equal(process.env.VITE_OPENROUTER_BASE_URL, undefined);
assert.equal(process.env.VITE_AI_ALLOW_LOCAL, undefined);
assert.equal(process.env.VITE_FUTURE_KEY, undefined);
assert.equal(process.env.AUDIO_TEST_FIXTURES, undefined);
assert.equal(process.env.VITE_AUDIO_BASE_URL, ${JSON.stringify(AUDIO_BASE_URL)});
assert.equal(process.env.VITE_AUDIO_CHAPTERS_ENABLED, "true");
fs.mkdirSync("dist");
fs.writeFileSync("dist/index.html", "safe app");
for (const [name, body] of Object.entries(${JSON.stringify(assets)})) {
  fs.mkdirSync(path.dirname(path.join("dist", name)), { recursive: true });
  fs.writeFileSync(path.join("dist", name), body);
}
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
            ...ai,
            VITE_OPENROUTER_BASE_URL: "http://127.0.0.1:4175",
            VITE_AI_ALLOW_LOCAL: "1",
            VITE_FUTURE_KEY: "private-test-key-123",
            AUDIO_TEST_FIXTURES: "1",
          },
          encoding: "utf8",
        },
      );
      const output = result.stdout + result.stderr;
      for (const secret of ["private-test-key-123", DUMMY_KEY, OTHER_KEY])
        assert.ok(!output.includes(secret));
      if (fails) {
        assert.equal(result.status, 1, output);
        assert.match(result.stderr, fails);
        return;
      }
      assert.equal(result.status, 0, output);
      assert.match(
        result.stdout,
        expectAi
          ? new RegExp(
              `Cloudflare ${target}: assets verified; AI enabled \\(openrouter\\)\\.`,
            )
          : new RegExp(`Cloudflare ${target}: assets verified; AI disabled\\.`),
      );
      assert.equal(
        readFileSync(join(f.root, "dist/index.html"), "utf8"),
        "safe app",
      );
      assert.match(
        readFileSync(join(f.root, "dist/_headers"), "utf8"),
        /Cache-Control/,
      );
      assert.equal(
        readFileSync(join(f.root, "dist/_redirects"), "utf8"),
        readFileSync(join(f.root, "hosting/cloudflare-app/_redirects"), "utf8"),
      );
      assert.equal(
        readFileSync(join(f.root, "public/keep.json"), "utf8"),
        "{}",
      );
      assert.throws(
        () => readFileSync(join(f.root, "dist/stale.txt")),
        /ENOENT/,
      );
    } finally {
      f.close();
    }
  });
}

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
      // Every test but this one ran: a nested run can silently execute none.
      const count = (name: string) =>
        Number(new RegExp(`# ${name} (\\d+)`).exec(result.stdout)?.[1]);
      assert.equal(count("skipped"), 1, result.stdout);
      assert.ok(count("pass") > 0, result.stdout);
      assert.equal(count("pass"), count("tests") - 1, result.stdout);
      assert.equal(outer.git("rev-parse", "HEAD"), head);
      assert.deepEqual(readFileSync(join(outer.root, ".git/index")), index);
      assert.deepEqual(readFileSync(join(outer.root, ".git/config")), config);
    } finally {
      outer.close();
    }
  },
);

test("Study gzip assets retain identity, byte limits, and credential scanning", () => {
  const root = mkdtempSync(join(tmpdir(), "cloudflare-study-test-"));
  const folder = join(root, "study/v2/GEN/1");
  mkdirSync(folder, { recursive: true });
  const path = join(folder, "1-1.words.json.gz");
  const valid = {
    v: 2,
    book: "GEN",
    chapter: 1,
    start: 1,
    end: 1,
    verses: { "1": { w: [] } },
  };
  const write = (value: unknown) =>
    writeFileSync(path, gzipSync(JSON.stringify(value)));
  try {
    write(valid);
    scanAssets(root, {});
    write(null);
    assert.throws(() => scanAssets(root, {}), /asset identity/);
    write({ ...valid, book: "EXO" });
    assert.throws(() => scanAssets(root, {}), /asset identity/);
    write({ ...valid, start: 2 });
    assert.throws(() => scanAssets(root, {}), /asset identity/);
    write({ ...valid, verses: {} });
    assert.throws(() => scanAssets(root, {}), /asset identity/);
    writeFileSync(path, "not gzip");
    assert.throws(() => scanAssets(root, {}), /invalid or oversized/);
    writeFileSync(path, gzipSync("not JSON"));
    assert.throws(() => scanAssets(root, {}), /invalid or oversized/);
    write({ ...valid, extra: "x".repeat(256 * 1024) });
    assert.throws(() => scanAssets(root, {}), /invalid or oversized/);
    writeFileSync(path, Buffer.alloc(30_001));
    assert.throws(() => scanAssets(root, {}), /request budget/);
    write({ ...valid, extra: "known-private-study-value-123" });
    assert.throws(
      () => scanAssets(root, { API_TOKEN: "known-private-study-value-123" }),
      /credential/,
    );
    write({ ...valid, extra: "sk-or-v1-12345678901234567890" });
    assert.throws(() => scanAssets(root, {}), /credential/);
    write({ ...valid, extra: "-----BEGIN PRIVATE KEY-----" });
    assert.throws(() => scanAssets(root, {}), /credential/);
    rmSync(path);
    writeFileSync(join(root, "other.json.gz"), gzipSync("{}"));
    assert.throws(() => scanAssets(root, {}), /unexpected file type/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
