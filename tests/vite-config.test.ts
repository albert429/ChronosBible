// Which audio days vite.config.ts advertises as __AUDIO_DAYS__. The config reads
// data/ and public/ relative to the working directory, so it runs here inside a
// scratch repository, with the build's VITE_* variables cleared.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigEnv, UserConfigFn } from "vite";
import config, { dataVersions } from "../vite.config.ts";

assert.equal(typeof config, "function");
const makeConfig = config as UserConfigFn;
const env: ConfigEnv = {
  command: "build",
  mode: "production",
  isSsrBuild: false,
  isPreview: false,
};

const original = process.cwd();
const root = mkdtempSync(join(tmpdir(), "vite-config-"));
mkdirSync(join(root, "data/audio/manifests"), { recursive: true });
mkdirSync(join(root, "public/audio/days"), { recursive: true });
writeFileSync(
  join(root, "data/audio/catalog.json"),
  JSON.stringify({ days: [1, 2, 3] }),
);
for (const day of [1, 2, 3])
  writeFileSync(
    join(root, `data/audio/manifests/${day}.json`),
    JSON.stringify({ src: `/audio/days/00${day}-abc.m4a` }),
  );
// Only days 1 and 3 have their recording in this checkout.
for (const file of ["001-abc.m4a", "003-abc.m4a"])
  writeFileSync(join(root, "public/audio/days", file), "");
// Two catalogued chapters; only Genesis 1 has its recording here.
mkdirSync(join(root, "data/audio/chapters/GEN"), { recursive: true });
mkdirSync(join(root, "data/audio/chapters/REV"), { recursive: true });
mkdirSync(join(root, "public/audio/chapters/assets"), { recursive: true });
writeFileSync(
  join(root, "data/audio/chapter-catalog.json"),
  JSON.stringify({ chapters: ["bible:GEN:1", "bible:REV:22"] }),
);
for (const [book, chapter] of [
  ["GEN", 1],
  ["REV", 22],
])
  writeFileSync(
    join(root, `data/audio/chapters/${book}/${chapter}.json`),
    JSON.stringify({
      src: `/audio/chapters/assets/${book}-${chapter}-abc.m4a`,
    }),
  );
writeFileSync(join(root, "public/audio/chapters/assets/GEN-1-abc.m4a"), "");
// Revelation 22 was uploaded and verified (src/audio/publication.ts).
writeFileSync(
  join(root, "data/audio/publication.json"),
  JSON.stringify({
    version: 1,
    releases: [
      {
        id: "r1",
        verified: "2026-10-16T00:00:00Z",
        host: "https://app.example",
        method: "ranges",
        files: 1,
      },
    ],
    files: {
      "/audio/chapters/assets/REV-22-abc.m4a": {
        bytes: 1,
        sha256: "0".repeat(64),
        release: "r1",
      },
    },
  }),
);
process.chdir(root);
for (const name of Object.keys(process.env))
  if (name.startsWith("VITE_")) delete process.env[name];
after(() => {
  process.chdir(original);
  rmSync(root, { recursive: true, force: true });
});

async function audioDays(base?: string) {
  if (base === undefined) delete process.env.VITE_AUDIO_BASE_URL;
  else process.env.VITE_AUDIO_BASE_URL = base;
  const resolved = await makeConfig(env);
  return JSON.parse(String(resolved.define?.__AUDIO_DAYS__));
}

test("Without an audio host, only days whose recording is bundled are advertised", async () => {
  assert.deepEqual(await audioDays(), [1, 3]);
  assert.deepEqual(await audioDays(""), [1, 3]);
});

test('A same-origin "/" base or an https host advertises every cataloged day', async () => {
  assert.deepEqual(await audioDays("/"), [1, 2, 3]);
  assert.deepEqual(await audioDays("https://audio.example.test"), [1, 2, 3]);
});

async function audioChapters(base?: string, enabled?: string) {
  if (base === undefined) delete process.env.VITE_AUDIO_BASE_URL;
  else process.env.VITE_AUDIO_BASE_URL = base;
  if (enabled === undefined) delete process.env.VITE_AUDIO_CHAPTERS_ENABLED;
  else process.env.VITE_AUDIO_CHAPTERS_ENABLED = enabled;
  try {
    const flags: string = JSON.parse(
      String((await makeConfig(env)).define?.__AUDIO_CHAPTERS__),
    );
    assert.equal(flags.length, 1189);
    return [...flags].flatMap((flag, index) => (flag === "1" ? [index] : []));
  } finally {
    delete process.env.VITE_AUDIO_CHAPTERS_ENABLED;
  }
}

test("Bundled chapter recordings are advertised compactly", async () => {
  assert.deepEqual(await audioChapters(), [0]);
  assert.deepEqual(await audioChapters(undefined, "true"), [0]);
});

test("An audio host alone never advertises chapters absent from the build", async () => {
  for (const base of ["/", "https://audio.example.test"]) {
    assert.deepEqual(await audioChapters(base), [0]);
    assert.deepEqual(await audioChapters(base, ""), [0]);
    assert.deepEqual(await audioChapters(base, "false"), [0]);
  }
});

test("VITE_AUDIO_CHAPTERS_ENABLED=true advertises every hosted chapter", async () => {
  assert.deepEqual(await audioChapters("/", "true"), [0, 1188]);
  assert.deepEqual(
    await audioChapters("https://audio.example.test", "true"),
    [0, 1188],
  );
});

test("The chapter flag leaves the advertised days unchanged", async () => {
  process.env.VITE_AUDIO_CHAPTERS_ENABLED = "true";
  try {
    assert.deepEqual(await audioDays(), [1, 3]);
    assert.deepEqual(await audioDays("/"), [1, 2, 3]);
  } finally {
    delete process.env.VITE_AUDIO_CHAPTERS_ENABLED;
  }
});

test("An unrecognised chapter flag fails the build", async () => {
  for (const enabled of ["1", "yes", "TRUE"])
    await assert.rejects(
      audioChapters("/", enabled),
      /VITE_AUDIO_CHAPTERS_ENABLED/,
    );
});

test("An unsafe audio host fails the build", async () => {
  for (const base of [
    "http://audio.example.test",
    "//audio.example.test",
    "/audio",
    "https://audio.example.test/private",
  ])
    await assert.rejects(audioDays(base), Error, base);
});

test("AI constants are off unless a provider is configured", async () => {
  delete process.env.VITE_AUDIO_BASE_URL;
  const resolved = await makeConfig(env);
  assert.equal(resolved.define?.__AI_ENABLED__, "false");
  assert.equal(resolved.define?.__AI_CONFIG__, "null");
});

test("The audio host is inlined as __AUDIO_BASE_URL__", async () => {
  async function baseUrl(base?: string) {
    if (base === undefined) delete process.env.VITE_AUDIO_BASE_URL;
    else process.env.VITE_AUDIO_BASE_URL = base;
    return (await makeConfig(env)).define?.__AUDIO_BASE_URL__;
  }
  assert.equal(await baseUrl(), '""');
  assert.equal(await baseUrl("/"), '"/"');
  assert.equal(
    await baseUrl("https://audio.example.test"),
    '"https://audio.example.test"',
  );
});

test("Each data folder is versioned by its content, names included", async () => {
  // The scratch checkout has no generated data yet: plain addresses.
  assert.equal((await makeConfig(env)).define?.__DATA_VERSIONS__, "{}");
  mkdirSync(join(root, "public/bible/GEN"), { recursive: true });
  mkdirSync(join(root, "public/readings"), { recursive: true });
  writeFileSync(join(root, "public/bible/GEN/1.json"), "{}");
  writeFileSync(join(root, "public/readings/1.json"), "{}");
  const first = dataVersions();
  assert.deepEqual(Object.keys(first).sort(), ["bible", "readings"]);
  assert.match(first.bible, /^[0-9a-f]{10}$/);
  assert.equal(
    (await makeConfig(env)).define?.__DATA_VERSIONS__,
    JSON.stringify(first),
  );
  writeFileSync(join(root, "public/bible/GEN/1.json"), '{"v":2}');
  const changed = dataVersions();
  assert.notEqual(changed.bible, first.bible);
  assert.equal(changed.readings, first.readings);
  rmSync(join(root, "public/bible/GEN/1.json"));
  writeFileSync(join(root, "public/bible/GEN/2.json"), '{"v":2}');
  assert.notEqual(dataVersions().bible, changed.bible);
});
