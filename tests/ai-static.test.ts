import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const root = new URL("../src/", import.meta.url);
const files = readdirSync(root, { recursive: true, encoding: "utf8" })
  .filter((name) => /\.(ts|tsx)$/.test(name))
  .map((name) => ({
    name: name.replaceAll("\\", "/"),
    text: readFileSync(new URL(name, root), "utf8"),
  }));

test("Source never reads import.meta.env (AI config is inlined at build time)", () => {
  assert.deepEqual(
    files.filter((f) => f.text.includes("import.meta.env")).map((f) => f.name),
    [],
  );
});

test("Source never injects HTML", () => {
  assert.deepEqual(
    files
      .filter((f) => /dangerouslySetInnerHTML|innerHTML/.test(f.text))
      .map((f) => f.name),
    [],
  );
});

test("Only the lazy run module (and its declaration) references the AI key config", () => {
  assert.deepEqual(
    files
      .filter((f) => f.text.includes("__AI_CONFIG__"))
      .map((f) => f.name)
      .sort(),
    ["features/ai/run.ts", "vite-env.d.ts"]
      .filter((name) => files.some((f) => f.name === name))
      .sort(),
  );
});

test("AI modules never touch reading progress or storage outside the cache module", () => {
  for (const f of files.filter((f) => f.name.startsWith("features/ai/"))) {
    assert.doesNotMatch(
      f.text,
      /nt-reading-progress|bible-reader-state|from "[^"]*(?:progress|\/profiles\/)/,
      f.name,
    );
    if (f.name !== "features/ai/cache.ts")
      assert.doesNotMatch(f.text, /localStorage/, f.name);
  }
});
