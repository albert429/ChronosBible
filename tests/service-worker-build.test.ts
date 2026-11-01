// /sw.js is an independent classic build (scripts/build/service-worker.ts): it
// never imports an app chunk and never clears or recopies the app's output.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import {
  serviceWorker,
  serviceWorkerConfig,
} from "../scripts/build/service-worker.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("The worker build has no config file, plugins or public folder", () => {
  const config = serviceWorkerConfig({
    root: ROOT,
    outDir: "/out",
    files: ["/"],
    build: "abc",
    versions: { bible: "1" },
  });
  assert.equal(config.configFile, false);
  assert.equal(config.publicDir, false);
  assert.equal("plugins" in config, false);
  assert.equal(config.build.emptyOutDir, false);
  assert.equal(config.build.copyPublicDir, false);
  assert.deepEqual(config.build.lib.formats, ["iife"]);
  assert.equal(
    config.build.lib.entry,
    join(ROOT, "src/features/offline/sw.ts"),
  );
  assert.equal(config.build.lib.fileName(), "sw.js");
  assert.equal(config.define.__SW_BUILD__, '"abc"');
});

test("The worker is written beside the app's files as one classic script", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "sw build "));
  try {
    writeFileSync(join(outDir, "index.html"), "<html>app</html>");
    writeFileSync(join(outDir, "keep.txt"), "app output");
    const plugin = serviceWorker({ bible: "0123456789" }) as Plugin & {
      configResolved: (config: unknown) => void;
      writeBundle: (options: unknown, bundle: unknown) => Promise<void>;
    };
    plugin.configResolved({ root: ROOT, build: { outDir } });
    await plugin.writeBundle(
      {},
      {
        "index.html": { type: "asset", source: "<html>app</html>" },
        "assets/index-AbCdEf12.js": { type: "chunk" },
      },
    );
    // Nothing removed, nothing copied from public/: only sw.js was added.
    assert.deepEqual(readdirSync(outDir).sort(), [
      "index.html",
      "keep.txt",
      "sw.js",
    ]);
    const worker = readFileSync(join(outDir, "sw.js"), "utf8");
    assert.doesNotMatch(worker, /^\s*(?:import|export)\b/m);
    assert.doesNotMatch(worker, /\bimport\s*\(/);
    assert.match(worker, /\/assets\/index-AbCdEf12\.js/);
    assert.match(worker, /0123456789/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
