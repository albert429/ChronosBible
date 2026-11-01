// The browser tests' production-like server (scripts/quality/static-server.mjs)
// and the SSE stub: stored gzip bytes as on Cloudflare, and an occupied port
// is a failure, never a reused (possibly stale) server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { serve } from "../scripts/quality/static-server.mjs";

const script = (path: string) =>
  fileURLToPath(new URL(`../scripts/${path}`, import.meta.url));
const portOf = (server: Server) => (server.address() as AddressInfo).port;

function site(t: { after: (fn: () => void) => void }) {
  const base = mkdtempSync(join(tmpdir(), "static server "));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "built app");
  mkdirSync(join(root, "study/v2/GEN/1"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<p>app</p>");
  writeFileSync(join(root, "sw.js"), "self.x=1");
  writeFileSync(join(base, "secret.txt"), "outside");
  const words = gzipSync(JSON.stringify({ v: 2, book: "GEN" }));
  writeFileSync(join(root, "study/v2/GEN/1/1-31.words.json.gz"), words);
  return { root, words };
}

function get(port: number, path: string, method = "GET") {
  return new Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  }>((done, fail) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: { "accept-encoding": "gzip, br" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          done({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", fail);
    req.end();
  });
}

test("Study words are served as the stored gzip bytes, like production", async (t) => {
  const { root, words } = site(t);
  const server = await serve(root);
  t.after(() => server.close());
  const port = portOf(server);
  const response = await get(port, "/study/v2/GEN/1/1-31.words.json.gz?v=1");
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/gzip");
  assert.equal(response.headers["content-encoding"], undefined);
  assert.deepEqual(response.body, words);
  for (const path of ["/", "/?day=1", "/index.html"]) {
    const page = await get(port, path);
    assert.equal(page.status, 200, path);
    assert.equal(page.body.toString(), "<p>app</p>", path);
    assert.match(String(page.headers["content-type"]), /^text\/html/);
  }
  assert.match(
    String((await get(port, "/sw.js")).headers["content-type"]),
    /^text\/javascript/,
  );
  const head = await get(port, "/sw.js", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  for (const path of [
    "/missing.json",
    "/missing",
    "/../secret.txt",
    "/%2e%2e/secret.txt",
    "/study/",
    "/%E0%A4%A",
  ])
    assert.equal((await get(port, path)).status, 404, path);
  assert.equal((await get(port, "/", "POST")).status, 405);
});

test("A taken port fails the server instead of reusing whatever answers there", async (t) => {
  const { root } = site(t);
  const holder = createServer((_req, res) => res.end("stale"));
  await new Promise<void>((done) => holder.listen(0, "127.0.0.1", done));
  t.after(() => holder.close());
  const port = portOf(holder);
  await assert.rejects(serve(root, { port }), { code: "EADDRINUSE" });
  const child = spawn(
    process.execPath,
    [script("quality/static-server.mjs"), root, "--port", String(port)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.match(stderr, new RegExp(`Port ${port} is already in use`));
  // The stale server is untouched.
  assert.equal((await get(port, "/")).body.toString(), "stale");
});

test("The SSE stub also refuses a taken port", async (t) => {
  const holder = createServer((_req, res) => res.end("stale"));
  await new Promise<void>((done) => holder.listen(0, "127.0.0.1", done));
  t.after(() => holder.close());
  const port = portOf(holder);
  const child = spawn(process.execPath, [script("quality/sse-stub.mjs")], {
    env: { ...process.env, SSE_STUB_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.match(stderr, /already in use/);
});

test("The server CLI needs a built folder and a port", async (t) => {
  const { root } = site(t);
  for (const [args, code] of [
    [[root], 2],
    [[root, "--port", "x"], 2],
    [[join(root, "study"), "--port", "1"], 1],
  ] as const) {
    const child = spawn(
      process.execPath,
      [script("quality/static-server.mjs"), ...args],
      { stdio: "ignore" },
    );
    assert.equal((await once(child, "exit"))[0], code, args.join(" "));
  }
});
