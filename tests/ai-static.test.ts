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

test("No browser module references provider configuration or server prompts", () => {
  assert.deepEqual(
    files
      .filter((f) =>
        /__AI_CONFIG__|OPENROUTER_API_KEY|SYSTEM_PROMPT|gateway.ai.cloudflare.com/.test(
          f.text,
        ),
      )
      .map((f) => f.name)
      .sort(),
    [],
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
