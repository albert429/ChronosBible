// The audio delivery contract (src/audio/contract.ts) against everything that
// restates it: committed manifests, the R2 staging folder and the upload
// command.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUDIO_CACHE_CONTROL,
  AUDIO_CONTENT_TYPE,
  AUDIO_MAX_BYTES,
  AUDIO_CHAPTER_MEDIA_PREFIX,
  AUDIO_CLIP_MEDIA_PREFIX,
  AUDIO_MEDIA_PATTERN,
  AUDIO_MEDIA_PREFIX,
  AUDIO_MEDIA_PREFIXES,
  AUDIO_HOST_ORIGIN,
  AUDIO_R2_BUCKET,
} from "../src/audio/contract.ts";
import { copyMedia } from "../scripts/prepare-audio-r2.mjs";
import { bulkPutArguments } from "../scripts/upload-audio-r2.mjs";

const json = (path: string) =>
  JSON.parse(readFileSync(new URL("../" + path, import.meta.url), "utf8"));

test("The media pattern accepts day-numbered fingerprinted M4A paths only", () => {
  for (const ok of [
    "/audio/days/001-d6739befab9eaf45cff3.m4a",
    "/audio/days/150-0.m4a",
    "/audio/chapters/assets/GEN-1-c4e1aeecbd85496dd30e.m4a",
    "/audio/chapters/assets/PSA-119-134d8f1f38a42ad54fb1.m4a",
    "/audio/chapters/assets/1CO-16-0.m4a",
    "/audio/clips/GEN-2-4-25-0a1b.m4a",
    "/audio/clips/PSA-119-1-176-0.m4a",
  ])
    assert.match(ok, AUDIO_MEDIA_PATTERN, ok);
  for (const bad of [
    "/audio/days/1-abc.m4a",
    "/audio/days/001-abc.mp3",
    "/audio/days/001-ABC.m4a",
    "/audio/days/001-abc.m4a?x=1",
    "/audio/days/001-abc.m4a/",
    "/audio/days/../001-abc.m4a",
    "/audio/days/001-.m4a",
    "audio/days/001-abc.m4a",
    "https://example.test/audio/days/001-abc.m4a",
    "/audio/chapters/assets/gen-1-abc.m4a",
    "/audio/chapters/assets/GEN-0-abc.m4a",
    "/audio/chapters/assets/GEN-1000-abc.m4a",
    "/audio/chapters/assets/GEN-1.m4a",
    "/audio/chapters/GEN-1-abc.m4a",
    "/audio/chapters/assets/../GEN-1-abc.m4a",
    "/audio/clips/GEN-2-abc.m4a",
    "/audio/clips/GEN-2-4-abc.m4a",
    "/audio/clips/GEN-2-0-25-abc.m4a",
    "/audio/clips/gen-2-4-25-abc.m4a",
    "/audio/clips/GEN-2-4-25.m4a",
  ])
    assert.doesNotMatch(bad, AUDIO_MEDIA_PATTERN, bad);
  assert.ok("/audio/days/001-abc.m4a".startsWith(AUDIO_MEDIA_PREFIX));
  assert.deepEqual(AUDIO_MEDIA_PREFIXES, [
    AUDIO_MEDIA_PREFIX,
    AUDIO_CHAPTER_MEDIA_PREFIX,
    AUDIO_CLIP_MEDIA_PREFIX,
  ]);
  assert.equal(AUDIO_MAX_BYTES, 8 * 1024 * 1024);
});

test("Every committed manifest matches the media contract", () => {
  const manifests = readdirSync(
    new URL("../data/audio/manifests/", import.meta.url),
  ).filter((name) => name.endsWith(".json"));
  assert.equal(manifests.length, json("data/audio/catalog.json").days.length);
  for (const name of manifests) {
    const { src, day } = json(`data/audio/manifests/${name}`);
    assert.match(src, AUDIO_MEDIA_PATTERN, name);
    assert.ok(
      src.startsWith(`${AUDIO_MEDIA_PREFIX}${String(day).padStart(3, "0")}-`),
      name,
    );
  }
});

test("Every committed chapter manifest matches the chapter media contract", () => {
  const { chapters } = json("data/audio/chapter-catalog.json");
  assert.equal(chapters.length, 1189);
  for (const identity of chapters) {
    const [, book, chapter] = identity.split(":");
    const manifest = json(`data/audio/chapters/${book}/${chapter}.json`);
    assert.equal(manifest.identity, identity);
    assert.match(manifest.src, AUDIO_MEDIA_PATTERN, identity);
    assert.ok(
      manifest.src.startsWith(
        `${AUDIO_CHAPTER_MEDIA_PREFIX}${book}-${chapter}-`,
      ),
      identity,
    );
  }
});

test("The upload command targets the contract's bucket with its headers", () => {
  assert.equal(AUDIO_HOST_ORIGIN, "https://audio.chronosbible.com");
  assert.deepEqual(bulkPutArguments("batch-01.json"), [
    "wrangler@4",
    "r2",
    "bulk",
    "put",
    AUDIO_R2_BUCKET,
    "--filename",
    "batch-01.json",
    "--content-type",
    AUDIO_CONTENT_TYPE,
    "--cache-control",
    AUDIO_CACHE_CONTROL,
    "--remote",
    "--concurrency",
    "20",
  ]);
  assert.equal(AUDIO_R2_BUCKET, "chronosbible-audio");
  assert.equal(AUDIO_CONTENT_TYPE, "audio/mp4");
  assert.equal(AUDIO_CACHE_CONTROL, "public, max-age=31536000, immutable");
  const { scripts } = json("package.json");
  assert.equal(scripts["audio:host:deploy"], undefined);
  assert.match(scripts["audio:host:upload"], /scripts\/upload-audio-r2\.mjs$/);
});

test("copyMedia stages both namespaces from any media root and refuses unsafe files", () => {
  const root = mkdtempSync(join(tmpdir(), "audio-bundle-"));
  try {
    const media = join(root, "media");
    const output = join(root, "out");
    const manifest = (name: string, src: string) => {
      writeFileSync(join(root, name), JSON.stringify({ src }));
      return join(root, name);
    };
    const day = "/audio/days/001-abc.m4a";
    const chapter = "/audio/chapters/assets/PSA-119-abc.m4a";
    for (const src of [day, chapter]) {
      mkdirSync(join(media, src, ".."), { recursive: true });
      writeFileSync(join(media, src), src);
    }
    copyMedia(
      [manifest("1.json", day), manifest("psa.json", chapter)],
      output,
      media,
    );
    for (const src of [day, chapter])
      assert.equal(readFileSync(output + src, "utf8"), src);
    // Over the size sanity limit: never truncated, refused instead.
    truncateSync(join(media, chapter), AUDIO_MAX_BYTES + 1);
    assert.throws(() => copyMedia([join(root, "psa.json")], output, media));
    assert.throws(() =>
      copyMedia([manifest("bad.json", "/audio/../secret.m4a")], output, media),
    );
    assert.ok(!existsSync(join(output, "secret.m4a")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
