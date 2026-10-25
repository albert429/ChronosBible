import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(
  new URL("../scripts/agents/cli.mjs", import.meta.url),
);
const GITIGNORE = readFileSync(
  new URL("../.gitignore", import.meta.url),
  "utf8",
);

type Check = { level: string; message: string };

function fixture(t: { after: (fn: () => void) => void }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "agents doctor ")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG_COUNT",
    "INIT_CWD",
  ])
    delete env[key];
  const init = spawnSync("git", ["init", "-q", "-b", "main"], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.equal(init.status, 0, init.stderr);
  writeFileSync(join(root, ".gitignore"), GITIGNORE);
  mkdirSync(join(root, ".agents/roles"), { recursive: true });
  writeFileSync(
    join(root, ".agents/catalog.json"),
    JSON.stringify({
      version: 1,
      roles: [{ id: "product", instructions: ".agents/roles/product.md" }],
    }),
  );
  writeFileSync(join(root, ".agents/roles/product.md"), "# Product\n");
  writeFileSync(join(root, ".agents/README.md"), "# Shared workflow\n");
  return {
    root,
    diagnose: () => {
      const result = spawnSync(process.execPath, [CLI, "doctor", "--json"], {
        cwd: root,
        env,
        encoding: "utf8",
      });
      assert.ok(result.status === 0 || result.status === 1, result.stderr);
      return JSON.parse(result.stdout) as { ok: boolean; checks: Check[] };
    },
  };
}

test("doctor accepts the fresh-clone definition allowlist", (t) => {
  const { diagnose } = fixture(t);
  const report = diagnose();
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(
    report.checks.filter((check) =>
      check.message.startsWith("ignore conflict:"),
    ),
    [],
  );
  assert.ok(
    report.checks.some(
      (check) => check.message === "ignore rules keep runtime state local",
    ),
  );
});

test("doctor still warns when local excludes hide shared definitions", (t) => {
  const { root, diagnose } = fixture(t);
  writeFileSync(join(root, ".git/info/exclude"), "/.agents/\n");
  const report = diagnose();
  assert.ok(
    report.checks.some(
      (check) =>
        check.level === "warn" &&
        check.message.includes("info/exclude:1:/.agents/") &&
        check.message.includes("hides shared definitions") &&
        check.message.includes(".agents/catalog.json"),
    ),
  );
});

test("doctor rejects runtime files explicitly included by negation", (t) => {
  const { root, diagnose } = fixture(t);
  writeFileSync(
    join(root, ".gitignore"),
    `${GITIGNORE}\n!.agents/state/\n.agents/state/*\n!.agents/state/registry.json\n`,
  );
  const report = diagnose();
  assert.equal(report.ok, false);
  assert.ok(
    report.checks.some(
      (check) =>
        check.level === "error" &&
        check.message ===
          "ignore conflict: .agents/state/registry.json is not ignored",
    ),
  );
});
