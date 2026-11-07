// Real production Worker + SQLite Object, with outbound services replaced locally.
// No test routes or credentials are compiled into the deployed Worker.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { once } from "node:events";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import { bundle } from "./bundle.mjs";
const port = Number(process.env.PW_PORT || 4173) + 1;
const origin = `http://127.0.0.1:${port}`;
const scriptPath = await bundle();
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
let assetGate;
let releaseAssets;
function make(enabled = "true") {
  const options = convertV4MiniflareOptions({
    name: "ai-browser",
    modules: true,
    scriptPath,
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["enable_request_signal"],
    log: new Log(LogLevel.ERROR),
    bindings: {
      AI_ENABLED: enabled,
      AI_ENVIRONMENT: "production",
      AI_ORIGIN: origin,
      AI_GATEWAY_ACCOUNT_ID: "0".repeat(32),
      AI_GATEWAY_ID: "test",
      OPENROUTER_API_KEY: "sk-or-v1-playwright-dummy-key",
      AI_GATEWAY_TOKEN: "dummy-gateway-token",
      TURNSTILE_SECRET: "dummy-turnstile-secret",
      AI_COOKIE_SECRET: "dummy-cookie-secret".repeat(3),
    },
    durableObjects: { AI: { className: "AiCoordinator", useSQLite: true } },
    serviceBindings: {
      ASSETS: async (request) => {
        const url = new URL(request.url);
        if (assetGate && url.pathname.startsWith("/bible/"))
          await Promise.race([
            assetGate,
            new Promise((resolve) =>
              request.signal.addEventListener("abort", resolve, {
                once: true,
              }),
            ),
          ]);
        const path = resolve(
          "dist-ai",
          "." +
            (url.pathname === "/"
              ? "/index.html"
              : decodeURIComponent(url.pathname)),
        );
        if (!path.startsWith(resolve("dist-ai") + "/"))
          return new Response(null, { status: 403 });
        try {
          return new Response(await readFile(path), {
            headers: {
              "Content-Type": mime[extname(path)] ?? "application/octet-stream",
            },
          });
        } catch {
          return new Response(null, { status: 404 });
        }
      },
    },
    unsafeDirectSockets: [{ host: "127.0.0.1", port: 0 }],
    outboundService: "mock",
  });
  options.workers.push(
    ...convertV4MiniflareOptions({
      name: "mock",
      modules: true,
      compatibilityDate: "2026-10-01",
      compatibilityFlags: ["enable_request_signal"],
      script: `export default { fetch(request, env) {
    if (new URL(request.url).hostname === "challenges.cloudflare.com") return Response.json({success:true,hostname:"127.0.0.1",action:"ai_answer",challenge_ts:new Date().toISOString()});
    return env.GATEWAY.fetch(request);
  } };`,
      serviceBindings: {
        GATEWAY: { external: { address: `127.0.0.1:${port + 1}`, http: {} } },
      },
    }).workers,
  );
  return new Miniflare(options);
}
let mf = make();
await mf.ready;
const server = createServer(async (req, res) => {
  const control = new AbortController();
  res.on("close", () => {
    control.abort();
  });
  try {
    if (req.url?.startsWith("/__test/reset")) {
      releaseAssets?.();
      assetGate = undefined;
      await mf.dispose();
      mf = make(req.url.includes("disabled") ? "false" : "true");
      await mf.ready;
      res.writeHead(200);
      res.end("ok");
      return;
    }
    if (req.url === "/__test/hold-assets") {
      assetGate = new Promise((resolve) => {
        releaseAssets = resolve;
      });
      res.end("ok");
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await fetch(
      new URL(req.url ?? "/", await mf.unsafeGetDirectURL("ai-browser")),
      {
        method: req.method,
        headers: Object.fromEntries([
          ...Object.entries(req.headers)
            .filter(
              ([name, value]) =>
                value !== undefined &&
                name !== "host" &&
                name !== "accept-encoding",
            )
            .map(([name, value]) => [
              name,
              Array.isArray(value) ? value.join(", ") : String(value),
            ]),
          ["accept-encoding", "identity"],
        ]),
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        signal: control.signal,
      },
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.flushHeaders();
    if (response.body) {
      const reader = response.body.getReader();
      const stop = () => {
        void reader.cancel().catch(() => {});
      };
      control.signal.addEventListener("abort", stop, { once: true });
      try {
        while (!control.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!res.write(value))
            await once(res, "drain", { signal: control.signal });
        }
      } finally {
        control.signal.removeEventListener("abort", stop);
        await reader.cancel().catch(() => {});
      }
    }
    res.end();
  } catch {
    if (!res.headersSent) res.writeHead(503);
    res.end();
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Worker browser harness on ${origin}`),
);
const close = async () => {
  releaseAssets?.();
  server.close();
  await mf.dispose();
  process.exit();
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
