// Startup requests of a built app, measured in headless Chromium.
//
//   node scripts/measure-startup.mjs capture <dir> [--dist <folder>] [--root <repo>]
//   node scripts/measure-startup.mjs compare <baseline-dir> <candidate-dir>
//
// `capture` serves <dist> from a throwaway local server on a free port (no
// preview server to reuse or collide with), opens three entry places on a
// 390x844 phone viewport with service workers blocked, and records every
// request made until the page has been quiet for a moment: method, resource
// type, status, bytes and path with content hashes removed. Requests to other
// origins are aborted, and recorded as blocked. It writes <dir>/startup.json.
// `compare` prints per-place differences and exits 1 when a place makes more
// requests than the baseline did.
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};
const SETTLE_MS = 1500;

/** A static server over `directory`; unknown extension-less paths get the page. */
function serve(directory) {
  const root = resolve(directory);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let file = resolve(root, "." + decodeURIComponent(url.pathname));
    if (file !== root && !file.startsWith(root + sep)) file = root;
    const isFile = existsSync(file) && statSync(file).isFile();
    if (!isFile && !extname(file)) file = join(root, "index.html");
    try {
      const body = readFileSync(file);
      const gz = file.endsWith(".gz");
      res.writeHead(200, {
        "content-type": gz
          ? "application/gzip"
          : (TYPES[extname(file)] ?? "application/octet-stream"),
        "content-length": body.length,
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () => done(server)),
  );
}

/** A request address without content hashes, so builds compare. */
export const normalize = (pathAndQuery) =>
  pathAndQuery.replace(
    /\/assets\/(.+)-[A-Za-z0-9_-]{8}(\.[A-Za-z0-9]+)$/,
    "/assets/$1$2",
  );

export async function capture(root, dist = "dist") {
  const distDir = join(root, dist);
  if (!existsSync(join(distDir, "index.html")))
    throw new Error(`${dist}/index.html is missing: run the build first`);
  const { chromium } = await import("@playwright/test");
  const chronology = JSON.parse(
    readFileSync(join(distDir, "chronology/OT.json"), "utf8"),
  );
  const places = [
    ["plan-day-1", "/?day=1"],
    ["bible-GEN-1", "/?mode=bible&book=GEN&chapter=1"],
    [
      "chronological-OT-first",
      `/?mode=chronological&testament=OT&reading=${chronology.readings[0].id}`,
    ],
  ];
  const server = await serve(distDir);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: process.env.CHROMIUM_PATH
      ? ["--no-sandbox", "--disable-dev-shm-usage"]
      : [],
  });
  try {
    const result = { format: 1, dist, places: {} };
    for (const [name, path] of places) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        serviceWorkers: "block",
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const requests = [];
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        requests.push({
          method: route.request().method(),
          path: `${url.origin}${url.pathname}`,
          type: route.request().resourceType(),
          status: "blocked",
          bytes: 0,
        });
        return route.abort();
      });
      page.on("response", async (response) => {
        const request = response.request();
        const url = new URL(request.url());
        if (url.origin !== origin) return;
        requests.push({
          method: request.method(),
          path: normalize(url.pathname + url.search),
          type: request.resourceType(),
          status: response.status(),
          bytes: Number(response.headers()["content-length"] ?? 0),
        });
      });
      await page.goto(origin + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(SETTLE_MS);
      await context.close();
      requests.sort((a, b) =>
        a.path === b.path ? 0 : a.path < b.path ? -1 : 1,
      );
      const byType = {};
      for (const { type, bytes } of requests) {
        byType[type] ??= { count: 0, bytes: 0 };
        byType[type].count++;
        byType[type].bytes += bytes;
      }
      result.places[name] = {
        url: path,
        count: requests.length,
        bytes: requests.reduce((sum, r) => sum + r.bytes, 0),
        byType,
        requests,
      };
    }
    return result;
  } finally {
    await browser.close();
    server.close();
  }
}

export function compare(before, after) {
  const failures = [];
  const lines = [];
  for (const [name, a] of Object.entries(before.places)) {
    const b = after.places[name];
    if (!b) {
      failures.push(`[${name}] missing from the candidate`);
      continue;
    }
    const key = (r) => `${r.method} ${r.path} ${r.status}`;
    const count = (list) => {
      const map = new Map();
      for (const r of list) map.set(key(r), (map.get(key(r)) ?? 0) + 1);
      return map;
    };
    const ca = count(a.requests);
    const cb = count(b.requests);
    const added = [...cb]
      .filter(([k, n]) => n > (ca.get(k) ?? 0))
      .map(([k]) => k);
    const removed = [...ca]
      .filter(([k, n]) => n > (cb.get(k) ?? 0))
      .map(([k]) => k);
    lines.push(
      `${name}: ${a.count} -> ${b.count} requests, ${a.bytes} -> ${b.bytes} B`,
    );
    for (const k of added) lines.push(`    added:   ${k}`);
    for (const k of removed) lines.push(`    removed: ${k}`);
    if (b.count > a.count)
      failures.push(`[${name}] startup requests grew ${a.count} -> ${b.count}`);
  }
  return { failures, lines };
}

const read = (dir) => {
  const file = join(dir, "startup.json");
  if (!existsSync(file)) throw new Error(`no startup measurement at ${file}`);
  return JSON.parse(readFileSync(file, "utf8"));
};

export async function main(
  argv,
  defaultRoot = fileURLToPath(new URL("..", import.meta.url)),
) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++)
    if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  const [command, first, second] = positional;
  try {
    if (command === "capture" && first) {
      const result = await capture(
        resolve(flags.root ?? defaultRoot),
        flags.dist,
      );
      mkdirSync(first, { recursive: true });
      writeFileSync(
        join(first, "startup.json"),
        JSON.stringify(result, null, 2) + "\n",
      );
      for (const [name, place] of Object.entries(result.places))
        console.log(`${name}: ${place.count} requests, ${place.bytes} B`);
      return 0;
    }
    if (command === "compare" && first && second) {
      const { failures, lines } = compare(read(first), read(second));
      for (const line of lines) console.log(line);
      if (failures.length) {
        console.error(`\nFAILED:\n${failures.map((f) => `  ${f}`).join("\n")}`);
        return 1;
      }
      console.log("OK");
      return 0;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 2;
  }
  console.error(
    "Usage: measure-startup.mjs capture <dir> [--dist <folder>] [--root <repo>] | compare <baseline-dir> <candidate-dir>",
  );
  return 2;
}

const invoked = process.argv[1] ? realpathSync(resolve(process.argv[1])) : "";
if (invoked && realpathSync(fileURLToPath(import.meta.url)) === invoked)
  process.exitCode = await main(process.argv.slice(2));
