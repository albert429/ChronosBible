import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ESLint } from "eslint";
import {
  DOMAIN_EDGES,
  FEATURE_EDGES,
} from "../scripts/quality/import-boundaries.mjs";
import { analyzeLayers, cyclesOf } from "../scripts/quality/layers.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const eslint = new ESLint({ cwd: root });

// Lint `code` as if it lived at `file`, with the repository's own config, and
// return the messages of the boundary rules.
async function boundaryMessages(file: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: join(root, file) });
  return result.messages
    .filter(
      (message) =>
        message.ruleId === "chronos/import-boundaries" ||
        message.ruleId === "no-restricted-imports",
    )
    .map((message) => message.message);
}

// [file, source, whether the repository config must flag it]
const CASES: [string, string, boolean][] = [
  // Domain is pure: domain and shared/lib only, in the documented direction.
  [
    "src/domain/reading/a.ts",
    'import { Reader } from "../../features/reader/Reader.tsx";',
    true,
  ],
  [
    "src/domain/reading/a.ts",
    'import { client } from "../../data/bible/client.ts";',
    true,
  ],
  [
    "src/domain/reading/a.ts",
    'import { ar } from "../../shared/browser/network.ts";',
    true,
  ],
  [
    "src/domain/reading/a.ts",
    'import { state } from "../profiles/state.ts";',
    true,
  ],
  [
    "src/domain/study/a.ts",
    'import { manifest } from "../audio/manifest.ts";',
    true,
  ],
  [
    "src/domain/scripture/a.ts",
    'import { label } from "../reading/labels.ts";',
    true,
  ],
  ["src/domain/audio/a.ts", 'import { x } from "../reading/types.ts";', false],
  [
    "src/domain/reading/a.ts",
    'import { ar } from "../../shared/lib/format.ts";',
    false,
  ],
  ["src/domain/reading/a.ts", 'import { useState } from "react";', true],
  ["src/domain/reading/a.ts", 'import { Icon } from "lucide-react";', true],
  ["src/domain/audio/a.ts", 'import { createHash } from "node:crypto";', true],
  ["src/domain/reading/a.ts", 'import { x } from "./types.ts";', false],
  // Lazy and re-exported edges count the same as static ones.
  [
    "src/domain/reading/a.ts",
    'export const load = () => import("../../features/reader/Reader.tsx");',
    true,
  ],
  [
    "src/domain/reading/a.ts",
    'export * from "../../data/bible/client.ts";',
    true,
  ],
  [
    "src/domain/reading/a.ts",
    'import type { Verse } from "../../data/bible/client.ts";',
    true,
  ],
  // Data imports only domain and data.
  [
    "src/data/bible/a.ts",
    'import { Reader } from "../../features/reader/Reader.tsx";',
    true,
  ],
  [
    "src/data/bible/a.ts",
    'import { ar } from "../../shared/lib/format.ts";',
    true,
  ],
  ["src/data/a.ts", 'import { App } from "../app/App.tsx";', true],
  [
    "src/data/bible/a.ts",
    'import { x } from "../../domain/scripture/types.ts";',
    false,
  ],
  [
    "src/data/chronology/a.ts",
    'import { x } from "../bible/client.ts";',
    false,
  ],
  ["src/data/study/a.ts", 'import { x } from "../jsonClient.ts";', false],
  // Shared never imports features, app or data, and shared/lib stays pure.
  [
    "src/shared/ui/a.tsx",
    'import { Reader } from "../../features/reader/Reader.tsx";',
    true,
  ],
  [
    "src/shared/hooks/a.ts",
    'import { x } from "../../data/jsonClient.ts";',
    true,
  ],
  ["src/shared/ui/a.tsx", 'import { App } from "../../app/App.tsx";', true],
  ["src/shared/lib/a.ts", 'import { x } from "../hooks/useToday.ts";', true],
  [
    "src/shared/lib/a.ts",
    'import { x } from "../../domain/reading/types.ts";',
    true,
  ],
  ["src/shared/lib/a.ts", 'import { useState } from "react";', true],
  [
    "src/shared/ui/a.tsx",
    'import { x } from "../../domain/scripture/types.ts";',
    false,
  ],
  ["src/shared/hooks/a.ts", 'import { x } from "../lib/format.ts";', false],
  ["src/shared/ui/a.tsx", 'import { useState } from "react";', false],
  // Nothing imports app/ except main.tsx.
  [
    "src/features/reader/a.ts",
    'import { App } from "../../app/App.tsx";',
    true,
  ],
  ["src/shared/ui/a.tsx", 'import { App } from "../../app/App.tsx";', true],
  ["src/main.tsx", 'import { App } from "./app/App.tsx";', false],
  ["src/app/a.ts", 'import { x } from "./trackChoice.ts";', false],
  [
    "src/app/a.ts",
    'import { Reader } from "../features/reader/Reader.tsx";',
    false,
  ],
  // Cross-feature edges: only the listed ones, whatever the depth.
  [
    "src/features/audio/a.ts",
    'import { x } from "../reader/position.ts";',
    true,
  ],
  ["src/features/ai/a.ts", 'import { x } from "../study/context.ts";', true],
  [
    "src/features/offline/a.ts",
    'import { x } from "../navigation/model.ts";',
    true,
  ],
  [
    "src/features/profiles/dialogs/a.tsx",
    'import { x } from "../../reader/position.ts";',
    true,
  ],
  [
    "src/features/audio/a.ts",
    'export const load = () => import("../study/load.ts");',
    true,
  ],
  [
    "src/features/streak/a.ts",
    'import { x } from "../plan/PlanView.tsx";',
    true,
  ],
  [
    "src/features/reader/a.ts",
    'import { x } from "../audio/position.ts";',
    false,
  ],
  [
    "src/features/reader/a.ts",
    'export const load = () => import("../audio/AudioPlayer.tsx");',
    false,
  ],
  ["src/features/study/a.ts", 'import { x } from "../ai/config.ts";', false],
  [
    "src/features/profiles/dialogs/a.tsx",
    'import { x } from "../storage.ts";',
    false,
  ],
  [
    "src/features/navigation/a.ts",
    'import { x } from "../../domain/reading/types.ts";',
    false,
  ],
  // Build and tool code reaches src/ only through pure modules.
  [
    "scripts/build/a.ts",
    'import { x } from "../../src/features/reader/Reader.tsx";',
    true,
  ],
  [
    "scripts/data/a.js",
    'import { x } from "../../src/shared/browser/network.ts";',
    true,
  ],
  ["vite.config.ts", 'import { x } from "./src/app/App.tsx";', true],
  [
    "scripts/hosting/a.mjs",
    'import { x } from "../../src/features/ai/AiPanel.tsx";',
    true,
  ],
  [
    "scripts/build/a.ts",
    'import { x } from "../../src/domain/audio/publication.ts";',
    false,
  ],
  [
    "scripts/data/a.js",
    'import { x } from "../../src/data/bible/client.ts";',
    false,
  ],
  [
    "scripts/data/a.js",
    'import { ar } from "../../src/shared/lib/format.ts";',
    false,
  ],
  ["vite.config.ts", 'import { x } from "./src/features/ai/config.ts";', false],
  [
    "scripts/build/a.ts",
    'import { x } from "../../src/features/offline/rules.ts";',
    false,
  ],
  ["scripts/build/a.ts", 'import { x } from "./other.ts";', false],
];

test("Each layering rule fires on a violating import and stays quiet on an allowed one", async () => {
  for (const [file, code, flagged] of CASES) {
    const messages = await boundaryMessages(file, code);
    assert.equal(
      messages.length > 0,
      flagged,
      `${file}: ${code} -> ${messages.join("; ") || "no message"}`,
    );
  }
});

test("The boundary messages name the edge and the reason", async () => {
  const [message] = await boundaryMessages(
    "src/features/audio/a.ts",
    'import { x } from "../reader/position.ts";',
  );
  assert.match(message, /features\/audio -> features\/reader/);
  assert.match(message, /allowed: none/);
  const [pure] = await boundaryMessages(
    "src/domain/reading/a.ts",
    'import { x } from "../../data/bible/client.ts";',
  );
  assert.match(pure, /domain is pure/);
});

test("The allowed feature and domain edges are acyclic and name real folders", () => {
  const edges = new Map([
    ...Object.entries(FEATURE_EDGES).map(
      ([area, to]): [string, Set<string>] => [
        `features/${area}`,
        new Set((to as string[]).map((name) => `features/${name}`)),
      ],
    ),
    ...Object.entries(DOMAIN_EDGES).map(([area, to]): [string, Set<string>] => [
      `domain/${area}`,
      new Set((to as string[]).map((name) => `domain/${name}`)),
    ]),
  ]);
  assert.deepEqual(cyclesOf(edges), []);
  for (const unit of edges.keys())
    assert.ok(existsSync(join(root, "src", unit)), unit);
});

test("The source tree has no import cycle between units and no boundary violation", () => {
  const { cycles, violations } = analyzeLayers(root);
  assert.deepEqual(cycles, []);
  assert.deepEqual(violations, []);
});

test("The layer check finds a cycle between features and a forbidden edge", () => {
  const fixture = mkdtempSync(join(tmpdir(), "layers fixture ü "));
  try {
    const write = (file: string, text: string) => {
      const path = join(fixture, "src", file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    };
    write(
      "features/a/a.ts",
      'import { b } from "../b/b.ts";\nexport const a = b;\n',
    );
    write(
      "features/b/b.ts",
      'export const b = 1;\nexport const load = () => import("../a/a.ts");\n',
    );
    write(
      "domain/reading/r.ts",
      'import { a } from "../../features/a/a.ts";\n',
    );
    const { cycles, violations } = analyzeLayers(fixture);
    assert.deepEqual(cycles, [["features/a", "features/b"]]);
    assert.ok(
      violations.some((entry) => /domain is pure/.test(entry)),
      violations.join("\n"),
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
