// The audio delivery contract (src/audio/contract.ts) against everything that
// restates it: committed manifests and vercel.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
  AUDIO_CACHE_CONTROL,
  AUDIO_CONTENT_TYPE,
  AUDIO_MAX_BYTES,
  AUDIO_MEDIA_PATTERN,
  AUDIO_MEDIA_PREFIX,
  AUDIO_HOST_ORIGIN,
  AUDIO_R2_BUCKET,
} from "../src/audio/contract.ts";

const json = (path: string) =>
  JSON.parse(readFileSync(new URL("../" + path, import.meta.url), "utf8"));

test("The media pattern accepts day-numbered fingerprinted M4A paths only", () => {
  for (const ok of [
    "/audio/days/001-d6739befab9eaf45cff3.m4a",
    "/audio/days/150-0.m4a",
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
  ])
    assert.doesNotMatch(bad, AUDIO_MEDIA_PATTERN, bad);
  assert.ok("/audio/days/001-abc.m4a".startsWith(AUDIO_MEDIA_PREFIX));
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

test("vercel.json redirects media to the R2 host and keeps manifests revalidating", () => {
  const { redirects, rewrites, headers } = json("vercel.json");
  assert.equal(rewrites, undefined);
  assert.deepEqual(
    redirects.map((rule: { source: string }) => rule.source),
    [AUDIO_MEDIA_PREFIX, "/audio/chapters/assets/", "/audio/clips/"].map(
      (prefix) => `${prefix}:file`,
    ),
  );
  for (const rule of redirects) {
    assert.equal(rule.permanent, true);
    assert.equal(rule.destination, `${AUDIO_HOST_ORIGIN}${rule.source}`);
  }
  assert.ok(
    !headers.some((rule: { source: string }) =>
      rule.source.startsWith(AUDIO_MEDIA_PREFIX),
    ),
    "media headers belong to the R2 host",
  );
});

test("The R2 host is the contract's bucket and origin", () => {
  assert.equal(AUDIO_R2_BUCKET, "chronosbible-audio");
  assert.equal(AUDIO_HOST_ORIGIN, "https://audio.chronosbible.com");
  assert.equal(AUDIO_CONTENT_TYPE, "audio/mp4");
  assert.equal(AUDIO_CACHE_CONTROL, "public, max-age=31536000, immutable");
});
