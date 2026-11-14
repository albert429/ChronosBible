import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { unitTests } from "../unit-tests.mjs";

test("unit discovery includes colocated and integration suites exactly once", () => {
  const root = mkdtempSync(join(tmpdir(), "chronos-discovery-"));
  try {
    for (const directory of [
      "app/src/features/audio/tests",
      "scripts/quality/tests",
      "app/worker/tests",
      "tests/integration",
      "tests/browser",
    ])
      mkdirSync(join(root, directory), { recursive: true });
    const suites = [
      "app/src/features/audio/tests/player.test.ts",
      "scripts/quality/tests/check.test.ts",
      "app/worker/tests/prompt.test.ts",
      "tests/integration/contracts.test.ts",
    ];
    for (const file of [
      ...suites,
      "app/worker/tests/runtime.test.mjs",
      "tests/browser/audio.spec.ts",
    ])
      writeFileSync(join(root, file), "");
    assert.deepEqual(unitTests(root), suites.sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unit discovery refuses an empty test selection", () => {
  const root = mkdtempSync(join(tmpdir(), "chronos-empty-tests-"));
  try {
    for (const directory of ["app/src", "scripts", "app/worker", "tests"])
      mkdirSync(join(root, directory), { recursive: true });
    assert.throws(() => unitTests(root), /No unit tests discovered/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
