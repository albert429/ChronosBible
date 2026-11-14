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
import { DOMAIN_EDGES, FEATURE_EDGES } from "../import-boundaries.mjs";
import { analyzeLayers, cyclesOf } from "../layers.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const eslint = new ESLint({ cwd: root });

// Lint `code` as if it lived at `file`, with the repository's own config, and
// return the messages of the boundary rules.
async function boundaryMessages(file: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: join(root, file) });
  return result.messages
    .filter(
      (message) =>
        message.ruleId === "chronos/import-boundaries" ||
        [
          "no-restricted-imports",
          "no-restricted-globals",
          "no-restricted-syntax",
          "no-restricted-properties",
        ].includes(message.ruleId ?? ""),
    )
    .map((message) => message.message);
}

// [file, source, whether the repository config must flag it]
const CASES: [string, string, boolean][] = [
  [
    "app/src/features/audio/domain/a.ts",
    'import { x } from "../AudioPlayer.tsx";',
    true,
  ],
  [
    "app/src/features/audio/domain/a.ts",
    'import { x } from "../data/client.ts";',
    true,
  ],
  [
    "app/src/features/ai/a.ts",
    'import { x } from "../../../worker/provider.ts";',
    true,
  ],
  [
    "app/worker/a.ts",
    'import { x } from "../src/features/ai/AiPanel.tsx";',
    true,
  ],
  [
    "app/worker/a.ts",
    'import { x } from "../src/features/ai/domain/types.ts";',
    false,
  ],

  // Domain is pure: domain and shared/lib only, in the documented direction.
  [
    "app/src/core/reading/a.ts",
    'import { Reader } from "../../features/reader/Reader.tsx";',
    true,
  ],
  [
    "app/src/core/reading/a.ts",
    'import { client } from "../../features/bible/data/client.ts";',
    true,
  ],
  [
    "app/src/core/reading/a.ts",
    'import { ar } from "../../shared/browser/network.ts";',
    true,
  ],
  [
    "app/src/core/reading/a.ts",
    'import { state } from "../profiles/state.ts";',
    true,
  ],
  [
    "app/src/features/study/domain/a.ts",
    'import { manifest } from "../../audio/domain/manifest.ts";',
    true,
  ],
  [
    "app/src/core/scripture/a.ts",
    'import { label } from "../reading/labels.ts";',
    true,
  ],
  [
    "app/src/features/audio/domain/a.ts",
    'import { x } from "../../../core/reading/types.ts";',
    false,
  ],
  [
    "app/src/core/reading/a.ts",
    'import { ar } from "../../shared/lib/format.ts";',
    false,
  ],
  ["app/src/core/reading/a.ts", 'import { useState } from "react";', true],
  ["app/src/core/reading/a.ts", 'import { Icon } from "lucide-react";', true],
  [
    "app/src/features/audio/domain/a.ts",
    'import { createHash } from "node:crypto";',
    true,
  ],
  ["app/src/core/reading/a.ts", 'import { x } from "./types.ts";', false],
  // Lazy and re-exported edges count the same as static ones.
  [
    "app/src/core/reading/a.ts",
    'export const load = () => import("../../features/reader/Reader.tsx");',
    true,
  ],
  [
    "app/src/core/reading/a.ts",
    'export * from "../../features/bible/data/client.ts";',
    true,
  ],
  [
    "app/src/core/reading/a.ts",
    'import type { Verse } from "../../features/bible/data/client.ts";',
    true,
  ],
  // Data imports only domain and data.
  [
    "app/src/features/bible/data/a.ts",
    'import { Reader } from "../../reader/Reader.tsx";',
    true,
  ],
  [
    "app/src/features/bible/data/a.ts",
    'import { ar } from "../../../shared/lib/format.ts";',
    true,
  ],
  [
    "app/src/shared/network/a.ts",
    'import { App } from "../../app/App.tsx";',
    true,
  ],
  [
    "app/src/features/bible/data/a.ts",
    'import { x } from "../../../core/scripture/types.ts";',
    false,
  ],
  [
    "app/src/features/chronology/data/a.ts",
    'import { x } from "../../bible/data/client.ts";',
    false,
  ],
  [
    "app/src/features/study/data/a.ts",
    'import { x } from "../../../shared/network/jsonClient.ts";',
    false,
  ],
  // Ownership remains visible even when domain/data roles are classified.
  [
    "app/src/shared/network/a.ts",
    'import { x } from "../../features/ai/data/client.ts";',
    true,
  ],
  [
    "app/src/shared/network/a.ts",
    'import { x } from "../../features/profiles/domain/state.ts";',
    true,
  ],
  [
    "app/src/shared/ui/a.tsx",
    'import { x } from "../../features/profiles/domain/state.ts";',
    true,
  ],
  [
    "app/src/shared/ui/a.tsx",
    'import { x } from "../../features/ai/data/client.ts";',
    true,
  ],
  [
    "app/src/shared/network/a.ts",
    'import { x } from "../../core/scripture/types.ts";',
    false,
  ],
  [
    "app/src/shared/network/a.ts",
    'import { x } from "./jsonClient.ts";',
    false,
  ],
  // Shared never imports features, app or data, and shared/lib stays pure.
  [
    "app/src/shared/ui/a.tsx",
    'import { Reader } from "../../features/reader/Reader.tsx";',
    true,
  ],
  [
    "app/src/shared/hooks/a.ts",
    'import { x } from "../network/jsonClient.ts";',
    true,
  ],
  ["app/src/shared/ui/a.tsx", 'import { App } from "../../app/App.tsx";', true],
  [
    "app/src/shared/lib/a.ts",
    'import { x } from "../hooks/useToday.ts";',
    true,
  ],
  [
    "app/src/shared/lib/a.ts",
    'import { x } from "../../core/reading/types.ts";',
    true,
  ],
  ["app/src/shared/lib/a.ts", 'import { useState } from "react";', true],
  [
    "app/src/shared/ui/a.tsx",
    'import { x } from "../../core/scripture/types.ts";',
    false,
  ],
  ["app/src/shared/hooks/a.ts", 'import { x } from "../lib/format.ts";', false],
  ["app/src/shared/ui/a.tsx", 'import { useState } from "react";', false],
  // Nothing imports app/ except main.tsx.
  [
    "app/src/features/reader/a.ts",
    'import { App } from "../../app/App.tsx";',
    true,
  ],
  ["app/src/shared/ui/a.tsx", 'import { App } from "../../app/App.tsx";', true],
  ["app/src/main.tsx", 'import { App } from "./app/App.tsx";', false],
  ["app/src/app/a.ts", 'import { x } from "./trackChoice.ts";', false],
  [
    "app/src/app/a.ts",
    'import { Reader } from "../features/reader/Reader.tsx";',
    false,
  ],
  // Cross-feature edges: only the listed ones, whatever the depth.
  [
    "app/src/features/audio/a.ts",
    'import { x } from "../reader/position.ts";',
    true,
  ],
  [
    "app/src/features/ai/a.ts",
    'import { x } from "../study/context.ts";',
    true,
  ],
  [
    "app/src/features/offline/a.ts",
    'import { x } from "../navigation/model.ts";',
    true,
  ],
  [
    "app/src/features/profiles/dialogs/a.tsx",
    'import { x } from "../../reader/position.ts";',
    true,
  ],
  [
    "app/src/features/audio/a.ts",
    'export const load = () => import("../study/load.ts");',
    true,
  ],
  [
    "app/src/features/streak/a.ts",
    'import { x } from "../plan/PlanView.tsx";',
    true,
  ],
  [
    "app/src/features/reader/a.ts",
    'import { x } from "../audio/position.ts";',
    false,
  ],
  [
    "app/src/features/reader/a.ts",
    'export const load = () => import("../audio/AudioPlayer.tsx");',
    false,
  ],
  [
    "app/src/features/study/a.ts",
    'import { x } from "../ai/config.ts";',
    false,
  ],
  [
    "app/src/features/profiles/dialogs/a.tsx",
    'import { x } from "../storage.ts";',
    false,
  ],
  [
    "app/src/features/navigation/a.ts",
    'import { x } from "../../core/reading/types.ts";',
    false,
  ],
  // Build and tool code reaches app/src/ only through pure modules.
  [
    "scripts/build/a.ts",
    'import { x } from "../../app/src/features/reader/Reader.tsx";',
    true,
  ],
  [
    "scripts/data/a.js",
    'import { x } from "../../app/src/shared/browser/network.ts";',
    true,
  ],
  ["app/vite.config.ts", 'import { x } from "./src/app/App.tsx";', true],
  [
    "scripts/hosting/a.mjs",
    'import { x } from "../../app/src/features/ai/AiPanel.tsx";',
    true,
  ],
  [
    "scripts/build/a.ts",
    'import { x } from "../../app/src/features/audio/domain/publication.ts";',
    false,
  ],
  [
    "scripts/data/a.js",
    'import { x } from "../../app/src/features/bible/data/client.ts";',
    false,
  ],
  [
    "scripts/data/a.js",
    'import { ar } from "../../app/src/shared/lib/format.ts";',
    false,
  ],
  [
    "app/vite.config.ts",
    'import { x } from "./src/features/ai/domain/chips.ts";',
    false,
  ],
  [
    "scripts/build/a.ts",
    'import { x } from "../../app/src/features/offline/rules.ts";',
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
    "app/src/features/audio/a.ts",
    'import { x } from "../reader/position.ts";',
  );
  assert.match(message, /features\/audio -> features\/reader/);
  assert.match(message, /allowed: none/);
  const [pure] = await boundaryMessages(
    "app/src/core/reading/a.ts",
    'import { x } from "../../features/bible/data/client.ts";',
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
      area === "scripture" || area === "reading"
        ? `core/${area}`
        : `features/${area}/domain`,
      new Set(
        (to as string[]).map((name) =>
          name === "scripture" || name === "reading"
            ? `core/${name}`
            : `features/${name}/domain`,
        ),
      ),
    ]),
  ]);
  assert.deepEqual(cyclesOf(edges), []);
  for (const unit of edges.keys())
    assert.ok(existsSync(join(root, "app/src", unit)), unit);
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
      const path = join(fixture, "app/src", file);
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
    write("core/reading/r.ts", 'import { a } from "../../features/a/a.ts";\n');
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

test("Pure modules reject browser effects and wall-clock reads", async () => {
  for (const file of [
    "app/src/core/reading/a.ts",
    "app/src/features/profiles/domain/a.ts",
    "app/src/shared/lib/a.ts",
  ]) {
    for (const code of [
      "export const x = window.location;",
      "export const x = document.title;",
      "export const x = localStorage.getItem('x');",
      "export const x = navigator.onLine;",
      "export const x = fetch('/data.json');",
      "export const x = globalThis.fetch('/data.json');",
      "export const x = globalThis['localStorage'];",
      "export const x = indexedDB.open('x');",
      "export const x = setTimeout(() => {}, 1);",
      "export const x = Date.now();",
      "export const x = new Date();",
      "export const x = Date();",
    ])
      assert.ok(
        (await boundaryMessages(file, code)).length,
        `${file}: ${code}`,
      );
    for (const code of [
      "export const x = new Date('2026-01-01').toISOString();",
      "export const x = Date.parse('2026-01-01');",
      "export const x = new URLSearchParams('day=1');",
      "export const x = new TextEncoder().encode('text');",
      "export const x = crypto.subtle.digest('SHA-256', new Uint8Array());",
      "export const x = (fetch: () => string) => fetch();",
    ])
      assert.deepEqual(
        await boundaryMessages(file, code),
        [],
        `${file}: ${code}`,
      );
  }
  assert.deepEqual(
    await boundaryMessages(
      "app/src/shared/browser/a.ts",
      "export const x = () => localStorage.getItem('x');",
    ),
    [],
  );
});

test("The layer graph retains role-level cycles and rejects shared feature bypasses", () => {
  const fixture = mkdtempSync(join(tmpdir(), "layers roles "));
  try {
    const write = (file: string, text: string) => {
      const path = join(fixture, "app/src", file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    };
    write(
      "shared/network/a.ts",
      'import { x } from "../../features/ai/data/client.ts";',
    );
    write(
      "shared/ui/a.ts",
      'import { x } from "../../features/profiles/domain/state.ts";',
    );
    write("features/profiles/domain/state.ts", "export const x = 1;");
    write(
      "features/ai/data/client.ts",
      'import { x } from "../domain/types.ts";',
    );
    write(
      "features/ai/domain/types.ts",
      'import { x } from "../data/client.ts";',
    );
    const { cycles, violations } = analyzeLayers(fixture);
    assert.deepEqual(cycles, [["features/ai/data", "features/ai/domain"]]);
    assert.equal(
      violations.filter((entry) => /shared never imports features/.test(entry))
        .length,
      2,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
