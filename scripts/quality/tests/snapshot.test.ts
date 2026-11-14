import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { compare, walk } from "../snapshot.mjs";

const PAGE = (extra = "") => `<!doctype html><html><head>
<script>var early = 1;</script>
<script type="module" crossorigin src="/assets/index-AAAAAAAA.js"></script>
<link rel="modulepreload" href="/assets/vendor-BBBBBBBB.js">
<link rel="stylesheet" href="/assets/index-CCCCCCCC.css">
${extra}</head><body></body></html>`;

/** A miniature repository: generated data, a build in dist/, a copy of the tool. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "snapshot test "));
  // A space and a non-ASCII letter: both break a naive URL.pathname.
  const root = join(base, "my repo ü");
  const put = (path: string, bytes: string | Uint8Array) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  };
  // The tool and the root helper it imports, at their repository paths.
  for (const path of ["scripts/quality/snapshot.mjs", "scripts/lib/paths.js"]) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    copyFileSync(
      fileURLToPath(new URL(`../../../${path}`, import.meta.url)),
      join(root, path),
    );
  }
  const data: Record<string, string | Uint8Array> = {
    "readings/1.json": '{"day":1}',
    "bible/GEN/1.json": '{"chapter":1}',
    "chronology/OT.json": "{}",
    "study/v2/inventory.json": "{}",
    "study/v2/GEN/1/1-31.words.json.gz": gzipSync('{"words":[]}'),
    "study/v2/lex/H1.json.gz": gzipSync('{"lex":1}'),
    "audio/days/1.json": '{"cues":[]}',
    "audio/chapters/GEN/1.json": '{"cues":[1]}',
    "audio/chrono/OT/gen-1-1.json": '{"cues":[2]}',
  };
  for (const [path, bytes] of Object.entries(data)) {
    put(`public/${path}`, bytes);
    put(`dist/${path}`, bytes);
  }
  put("public/manifest.json", "{}");
  put("dist/manifest.json", "{}");
  put("dist/index.html", PAGE());
  put("dist/sw.js", "self.x=1");
  put("dist/assets/index-AAAAAAAA.js", "export const a = 1;");
  put("dist/assets/vendor-BBBBBBBB.js", "export const b = 2;");
  put("dist/assets/index-CCCCCCCC.css", "body{margin:0}");
  put("dist/assets/Panel-DDDDDDDD.js", "export const c = 3;");
  return {
    root,
    put,
    out: (name: string) => join(base, "captures with space", name),
    run: (...args: string[]) =>
      spawnSync(
        process.execPath,
        [join(root, "scripts/quality/snapshot.mjs"), ...args],
        {
          encoding: "utf8",
        },
      ),
    close: () => rmSync(base, { recursive: true, force: true }),
  };
}

const snapshotOf = (dir: string) =>
  JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8"));

test("Capture records nested generated, shipped and gzip files from a path with spaces", () => {
  const repo = fixture();
  try {
    const dir = repo.out("base");
    const result = repo.run("capture", dir, "--label", "unit");
    assert.equal(result.status, 0, result.stderr);
    const snapshot = snapshotOf(dir);
    assert.equal(snapshot.meta.label, "unit");
    for (const path of [
      "study/v2/GEN/1/1-31.words.json.gz",
      "study/v2/lex/H1.json.gz",
      "study/v2/inventory.json",
      "audio/chapters/GEN/1.json",
      "audio/chrono/OT/gen-1-1.json",
    ]) {
      assert.ok(snapshot.generated[path], `generated ${path}`);
      assert.ok(snapshot.shipped[path], `shipped ${path}`);
    }
    assert.equal(
      snapshot.generated["study/v2/lex/H1.json.gz"].sha256,
      createHash("sha256")
        .update(readFileSync(join(repo.root, "public/study/v2/lex/H1.json.gz")))
        .digest("hex"),
    );
    assert.deepEqual(Object.keys(snapshot.shell).sort(), [
      "index.html",
      "manifest.json",
      "sw.js",
    ]);
    assert.deepEqual(
      Object.entries(snapshot.assets)
        .filter(([, asset]) => (asset as { initial: boolean }).initial)
        .map(([name]) => name)
        .sort(),
      ["index-AAAAAAAA.js", "index-CCCCCCCC.css", "vendor-BBBBBBBB.js"],
    );
    assert.deepEqual(
      snapshot.bundle.lazy.map((chunk: { name: string }) => chunk.name),
      ["Panel.js"],
    );
    assert.equal(snapshot.bundle.inline.script.count, 1);
    const same = repo.run("compare", dir);
    assert.equal(same.status, 0, same.stderr);
    assert.match(same.stdout, /generated: 9 -> 9 files, 0 differences/);
  } finally {
    repo.close();
  }
});

test("Compare lists added, removed and changed paths in nested output and exits nonzero", () => {
  const repo = fixture();
  try {
    const base = repo.out("base");
    assert.equal(repo.run("capture", base).status, 0);
    repo.put("public/study/v2/GEN/1/1-31.words.json.gz", gzipSync("changed"));
    repo.put("public/audio/chapters/GEN/2.json", "{}");
    rmSync(join(repo.root, "dist/audio/chrono/OT/gen-1-1.json"));
    const after = repo.out("after");
    assert.equal(repo.run("capture", after).status, 0);

    for (const args of [
      ["compare", base, after],
      ["compare", base],
    ]) {
      const result = repo.run(...args);
      assert.equal(result.status, 1, result.stdout);
      assert.match(
        result.stderr,
        /\[generated\] changed: study\/v2\/GEN\/1\/1-31\.words\.json\.gz/,
      );
      assert.match(
        result.stderr,
        /\[generated\] added: audio\/chapters\/GEN\/2\.json/,
      );
      assert.match(
        result.stderr,
        /\[shipped\] removed: audio\/chrono\/OT\/gen-1-1\.json/,
      );
      assert.doesNotMatch(result.stderr, /bible\/GEN\/1\.json/);
    }
  } finally {
    repo.close();
  }
});

test("Compare enforces the 512-byte initial gzip growth allowance, not inline growth", () => {
  const repo = fixture();
  try {
    const base = repo.out("base");
    assert.equal(repo.run("capture", base).status, 0);
    const noise = (bytes: number) => randomBytes(bytes).toString("base64");

    repo.put(
      "dist/assets/index-AAAAAAAA.js",
      `export const a="${noise(300)}";`,
    );
    repo.put(
      "dist/index.html",
      PAGE(`<script>var more="${noise(6000)}"</script>`),
    );
    let after = repo.out("small");
    repo.run("capture", after);
    const small = repo.run("compare", base, after);
    assert.equal(small.status, 0, small.stderr);
    assert.match(small.stdout, /inline startup gzip \(separate/);

    repo.put(
      "dist/assets/index-AAAAAAAA.js",
      `export const a="${noise(900)}";`,
    );
    after = repo.out("large");
    repo.run("capture", after);
    const large = repo.run("compare", base, after);
    assert.equal(large.status, 1);
    assert.match(large.stderr, /initial js gzip grew by \d+ B \(limit 512 B\)/);
  } finally {
    repo.close();
  }
});

test("Capture refuses a tree without generated data and rejects unknown commands", () => {
  const repo = fixture();
  try {
    rmSync(join(repo.root, "public/study"), { recursive: true });
    const result = repo.run("capture", repo.out("missing"));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /public\/study is missing or empty/);
    assert.equal(repo.run("nonsense").status, 2);
  } finally {
    repo.close();
  }
});

test("Compare flags AI code that appears in a build without it", () => {
  const tree = (aiAssets: string[]) => ({
    meta: { label: "x" },
    generated: {},
    shipped: {},
    shell: {},
    bundle: {
      initial: { js: 1, css: 1, files: [] },
      inline: { gzip: 0, script: { bytes: 0 }, style: { bytes: 0 } },
      lazy: [],
      aiAssets,
    },
  });
  assert.deepEqual(compare(tree([]), tree([])).failures, []);
  assert.match(
    compare(tree([]), tree(["AiPanel.js"])).failures[0],
    /AI code appeared/,
  );
  assert.deepEqual(
    compare(tree(["AiPanel.js"]), tree(["AiPanel.js"])).failures,
    [],
  );
});

test("Walk visits nested files in a stable order and records symlinks without following them", () => {
  const repo = fixture();
  try {
    symlinkSync("../../elsewhere", join(repo.root, "public/study/link"));
    const files = Object.keys(walk(join(repo.root, "public/study")));
    assert.deepEqual(files, [
      "link",
      "v2/GEN/1/1-31.words.json.gz",
      "v2/inventory.json",
      "v2/lex/H1.json.gz",
    ]);
  } finally {
    repo.close();
  }
});
