import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ESLint } from "eslint";
import { getFileInfo } from "prettier";

const root = fileURLToPath(new URL("../", import.meta.url));
const eslint = new ESLint({ cwd: root });
const prettierIgnored = async (path: string) =>
  (
    await getFileInfo(path, {
      ignorePath: [".gitignore", ".prettierignore"].map((name) => root + name),
      resolveConfig: false,
    })
  ).ignored;

// Local, generated or Git-ignored work that must never be linted or formatted.
const LOCAL = [
  "worktrees/m1-baseline/src/App.tsx",
  ".agents/task/src/App.tsx",
  ".claude/worktrees/a/src/App.tsx",
  ".wrangler/tmp/deploy/no-op-worker.js",
  ".vercel/output/config.json",
  ".playwright-mcp/page.md",
  "assets/video/src/Root.tsx",
  "assets/reel 1 - CB intro/src/Reel.tsx",
  "artifacts/refactor/VERIFY.md",
  "dist/assets/index.js",
  "dist-ai/assets/index.js",
  "public/study/v2/inventory.json",
];
// Maintained code and documentation that both tools must keep covering.
const MAINTAINED = [
  "src/main.tsx",
  "src/study/words.ts",
  "scripts/snapshot.mjs",
  "scripts/build-data.js",
  "hosting/cloudflare-app/_headers",
  "tests/snapshot.test.ts",
  "tests/browser/ai.spec.ts",
  "vite.config.ts",
  "playwright.config.ts",
  "eslint.config.js",
  "docs/development.md",
  "README.md",
  ".github/workflows/checks.yml",
];

test("ESLint skips local and generated work but lints maintained code", async () => {
  for (const path of LOCAL.filter((path) => /\.(tsx?|[mc]?js)$/.test(path)))
    assert.equal(await eslint.isPathIgnored(path), true, path);
  for (const path of MAINTAINED.filter((path) =>
    /\.(tsx?|[mc]?js)$/.test(path),
  ))
    assert.equal(await eslint.isPathIgnored(path), false, path);
});

test("Prettier skips local and generated work but formats maintained files", async () => {
  for (const path of [...LOCAL, ".claude/settings.local.json"])
    assert.equal(await prettierIgnored(path), true, path);
  for (const path of MAINTAINED.filter((path) => !path.includes("_headers")))
    assert.equal(await prettierIgnored(path), false, path);
});
