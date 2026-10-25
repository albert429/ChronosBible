import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { AUDIO_BASE_URL } from "../scripts/cloudflare-app.mjs";
import {
  AUDIO_HOST_ORIGIN,
  AUDIO_MEDIA_PREFIXES,
} from "../src/audio/contract.ts";

const json = (path: string) =>
  JSON.parse(readFileSync(new URL("../" + path, import.meta.url), "utf8"));

// The R2 host is the only audio host; old app URLs permanently redirect to it.
test("Cloudflare builds load audio from the contract's R2 origin", () => {
  assert.equal(AUDIO_BASE_URL, AUDIO_HOST_ORIGIN);
});

test("wrangler.json serves the dist assets only, with no Worker code", () => {
  const config = json("wrangler.json");
  assert.deepEqual(config.assets, { directory: "./dist" });
  assert.equal(config.main, undefined);
  assert.equal(
    config.build.command,
    "node scripts/cloudflare-app.mjs build production",
  );
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(
    json("package.json").scripts["app:host:deploy"],
    "node scripts/cloudflare-app.mjs deploy production",
  );
  assert.ok(
    !existsSync(
      new URL("../hosting/cloudflare-app/worker.js", import.meta.url),
    ),
  );
});

test("Dev has a separate Worker and domain with the same assets-only setup", () => {
  const config = json("wrangler.json");
  assert.equal(config.name, "chronosbible");
  assert.deepEqual(config.routes, [
    { pattern: "chronosbible.com", custom_domain: true },
  ]);
  assert.equal(config.env.dev.name, "chronosbible-dev");
  assert.deepEqual(config.env.dev.routes, [
    { pattern: "dev.chronosbible.com", custom_domain: true },
  ]);
  assert.deepEqual(config.env.dev.assets, config.assets);
  assert.equal(config.env.dev.main, undefined);
  assert.equal(config.env.dev.workers_dev, false);
  assert.equal(config.env.dev.preview_urls, false);
  assert.equal(
    config.env.dev.build.command,
    "node scripts/cloudflare-app.mjs build dev",
  );
  assert.equal(
    json("package.json").scripts["app:host:deploy:dev"],
    "node scripts/cloudflare-app.mjs deploy dev",
  );
});

test("_redirects sends exactly the media namespaces to R2 with a 301", () => {
  const rules = readFileSync(
    new URL("../hosting/cloudflare-app/_redirects", import.meta.url),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => line.split(/\s+/));
  assert.deepEqual(
    rules,
    AUDIO_MEDIA_PREFIXES.map((prefix) => [
      `${prefix}*`,
      `${AUDIO_HOST_ORIGIN}${prefix}:splat`,
      "301",
    ]),
  );
  // A splat rule matches by prefix: none may reach the JSON manifests.
  for (const path of [
    "/audio/1.json",
    "/audio/chapters/GEN/1.json",
    "/audio/chrono/OT/gen-1.json",
  ])
    assert.ok(
      !rules.some(([from]) => path.startsWith(from.slice(0, -1))),
      path,
    );
});

test("vercel.json redirects the same namespaces permanently", () => {
  const { redirects, headers } = json("vercel.json");
  assert.deepEqual(
    redirects,
    AUDIO_MEDIA_PREFIXES.map((prefix) => ({
      source: `${prefix}:file`,
      destination: `${AUDIO_HOST_ORIGIN}${prefix}:file`,
      permanent: true,
    })),
  );
  assert.equal(json("vercel.json").rewrites, undefined);
  // Only the manifests stay on Vercel, and they keep revalidating.
  assert.ok(
    !JSON.stringify(headers).includes("Vercel-CDN-Cache-Control"),
    "media headers are gone",
  );
  for (const prefix of AUDIO_MEDIA_PREFIXES)
    assert.ok(
      !headers.some((rule: { source: string }) =>
        rule.source.startsWith(prefix),
      ),
      prefix,
    );
});

test("Versioned Scripture data is immutable on both hosts; the shell revalidates", () => {
  const immutable = "public, max-age=31536000, immutable";
  const cloudflare = readFileSync(
    new URL("../hosting/cloudflare-app/_headers", import.meta.url),
    "utf8",
  );
  const { headers } = json("vercel.json");
  const vercel = (source: string) =>
    headers.find((rule: { source: string }) => rule.source === source)
      ?.headers[0].value;
  for (const folder of ["assets", "bible", "chronology", "readings", "study"]) {
    assert.match(
      cloudflare,
      new RegExp(`^/${folder}/\\*\\n  Cache-Control: ${immutable}$`, "m"),
    );
    assert.equal(vercel(`/${folder}/(.*)`), immutable, folder);
  }
  // Pages and audio manifests keep their default revalidation.
  assert.doesNotMatch(cloudflare, /^\/(audio|index\.html|sw\.js)/m);
  assert.equal(vercel("/"), "public, max-age=0, must-revalidate");
});
