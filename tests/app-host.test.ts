import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../hosting/cloudflare-app/worker.js";
import { AUDIO_PAGES_ORIGIN } from "../src/audio/contract.ts";

const json = (path: string) =>
  JSON.parse(readFileSync(new URL("../" + path, import.meta.url), "utf8"));

const PREFIXES = ["/audio/days/", "/audio/chapters/assets/", "/audio/clips/"];

// Stubs the global fetch for one call and records what reached the "origin".
async function run(
  path: string,
  init: RequestInit = {},
  upstream = () => new Response("origin", { status: 200 }),
) {
  const upstreamCalls: Request[] = [];
  const assetCalls: Request[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: Request) => {
    upstreamCalls.push(input);
    return upstream();
  }) as typeof fetch;
  try {
    const response = await worker.fetch(
      new Request(`https://chronosbible.com${path}`, init),
      {
        ASSETS: {
          fetch: async (request: Request) => {
            assetCalls.push(request);
            return new Response("asset");
          },
        },
      },
    );
    return { response, upstreamCalls, assetCalls };
  } finally {
    globalThis.fetch = real;
  }
}

test("Media paths are proxied to the audio origin with the same path", async () => {
  for (const prefix of PREFIXES) {
    const { response, upstreamCalls, assetCalls } = await run(
      `${prefix}001-abc.m4a?v=2`,
    );
    assert.equal(await response.text(), "origin");
    assert.equal(assetCalls.length, 0);
    assert.equal(upstreamCalls.length, 1);
    assert.equal(
      upstreamCalls[0].url,
      `${AUDIO_PAGES_ORIGIN}${prefix}001-abc.m4a?v=2`,
    );
  }
});

test("Range and conditional headers reach the origin and a 206 returns unchanged", async () => {
  const partial = () =>
    new Response(new Uint8Array([1, 2]), {
      status: 206,
      headers: {
        "Content-Range": "bytes 0-1/256",
        "Content-Type": "audio/mp4",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  const { response, upstreamCalls } = await run(
    "/audio/days/001-abc.m4a",
    {
      headers: {
        Range: "bytes=0-1",
        "If-Range": '"etag"',
        "If-None-Match": '"etag"',
      },
    },
    partial,
  );
  const sent = upstreamCalls[0].headers;
  assert.equal(sent.get("Range"), "bytes=0-1");
  assert.equal(sent.get("If-Range"), '"etag"');
  assert.equal(sent.get("If-None-Match"), '"etag"');
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 0-1/256");
  assert.equal(response.headers.get("Content-Type"), "audio/mp4");
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    new Uint8Array([1, 2]),
  );
});

test("HEAD is proxied and other methods are refused without an upstream call", async () => {
  const head = await run("/audio/clips/x.m4a", { method: "HEAD" });
  assert.equal(head.upstreamCalls.length, 1);
  assert.equal(head.upstreamCalls[0].method, "HEAD");

  for (const method of ["POST", "PUT", "DELETE"]) {
    const { response, upstreamCalls, assetCalls } = await run(
      "/audio/days/001-abc.m4a",
      { method, body: "x" },
    );
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET, HEAD");
    assert.equal(upstreamCalls.length, 0);
    assert.equal(assetCalls.length, 0);
  }
});

test("Everything else is served from the static assets", async () => {
  for (const path of [
    "/",
    "/index.html",
    "/audio/1.json",
    "/audio/days/",
    "/audio/days/a/b.m4a",
    "/audio/chapters/assets/a/b.m4a",
    "/audio/chapters/x.m4a",
    "/audio/clips/a/b",
    "/assets/index-abc.js",
  ]) {
    const { response, upstreamCalls, assetCalls } = await run(path);
    assert.equal(await response.text(), "asset", path);
    assert.equal(upstreamCalls.length, 0, path);
    assert.equal(assetCalls.length, 1, path);
  }
});

test("The worker's audio origin is the contract's Pages origin", () => {
  const source = readFileSync(
    new URL("../hosting/cloudflare-app/worker.js", import.meta.url),
    "utf8",
  );
  assert.equal(
    /const AUDIO_ORIGIN = "([^"]+)"/.exec(source)?.[1],
    AUDIO_PAGES_ORIGIN,
  );
});

test("wrangler.json serves assets from dist and runs the worker for media only", () => {
  const config = json("wrangler.json");
  assert.equal(config.assets.directory, "./dist");
  assert.equal(config.assets.binding, "ASSETS");
  assert.deepEqual(
    config.assets.run_worker_first,
    PREFIXES.map((prefix) => `${prefix}*`),
  );
  assert.equal(config.main, "hosting/cloudflare-app/worker.js");
  assert.match(config.build.command, /^VITE_AUDIO_BASE_URL=\/ npm run build /);
  assert.match(
    config.build.command,
    /cp hosting\/cloudflare-app\/_headers dist\/_headers/,
  );
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(
    json("package.json").scripts["app:host:deploy"],
    "npx wrangler@4 deploy",
  );
});

test("Every vercel.json rewrite is covered by the worker's routes", () => {
  const { assets } = json("wrangler.json");
  const { rewrites } = json("vercel.json");
  assert.ok(rewrites.length > 0);
  for (const { source, destination } of rewrites) {
    assert.ok(
      assets.run_worker_first.some((pattern: string) =>
        source.startsWith(pattern.slice(0, -1)),
      ),
      source,
    );
    assert.ok(destination.startsWith(AUDIO_PAGES_ORIGIN), destination);
  }
});
