// A static server over a built app that answers the way the production host
// does, for browser tests and startup measurements.
//
//   node scripts/quality/static-server.mjs <dist> --port <n> [--host 127.0.0.1]
//
// Production (Cloudflare static assets) serves the stored study word files
// (`*.json.gz`) as `application/gzip` bytes without Content-Encoding, so the
// app decodes them itself; `vite preview` instead marks them Content-Encoding:
// gzip and the browser decodes them. This server keeps production's behavior.
// `/` (and any `/…/`) is the folder's index.html; anything else that is not a
// file is 404. It sends no cache validators, so nothing is reused across
// requests. A port that is already taken is an error: the server never shares
// a port with, or silently stands in for, another (stale) server.
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { isMain } from "../lib/paths.js";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".gz": "application/gzip",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

/** The file a request path names inside `root`, or undefined. */
export function resolveFile(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  let file = resolve(root, "." + decoded);
  if (file !== root && !file.startsWith(root + sep)) return undefined;
  if (decoded.endsWith("/")) file = join(file, "index.html");
  try {
    return statSync(file).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

/** Response headers for a served file: its type and length, nothing else. */
export const headersFor = (file, length) => ({
  "content-type": TYPES[extname(file)] ?? "application/octet-stream",
  "content-length": length,
});

/**
 * Serve `directory` on `host:port` (0 picks a free port). Resolves with the
 * listening server; rejects when the port is taken or cannot be used.
 * @returns {Promise<import("node:http").Server>}
 */
export function serve(directory, { port = 0, host = "127.0.0.1" } = {}) {
  const root = resolve(directory);
  const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD")
      return res.writeHead(405, { allow: "GET, HEAD" }).end();
    const url = new URL(req.url ?? "/", "http://localhost");
    const file = resolveFile(root, url.pathname);
    if (!file) return res.writeHead(404).end();
    let body;
    try {
      body = readFileSync(file);
    } catch {
      return res.writeHead(404).end();
    }
    res.writeHead(200, headersFor(file, body.length));
    res.end(req.method === "HEAD" ? undefined : body);
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, host, () => {
      server.off("error", fail);
      done(server);
    });
  });
}

export async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { port: { type: "string" }, host: { type: "string" } },
  });
  const [directory, ...extra] = positionals;
  const port = Number(values.port);
  if (!directory || extra.length || !Number.isInteger(port) || port <= 0) {
    console.error("Usage: static-server.mjs <dist> --port <n> [--host <h>]");
    return 2;
  }
  try {
    statSync(join(directory, "index.html"));
  } catch {
    console.error(`${directory}/index.html is missing: build it first`);
    return 1;
  }
  const host = values.host ?? "127.0.0.1";
  try {
    await serve(directory, { port, host });
  } catch (error) {
    console.error(
      error?.code === "EADDRINUSE"
        ? `Port ${port} is already in use; stop that server first (a stale server is never reused).`
        : `Cannot serve on ${host}:${port}: ${error?.message ?? error}`,
    );
    return 1;
  }
  console.log(`Serving ${resolve(directory)} at http://${host}:${port}`);
  return undefined;
}

if (isMain(import.meta.url))
  main(process.argv.slice(2)).then((code) => {
    if (code !== undefined) process.exit(code);
  });
