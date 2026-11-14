import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { bundle } from "../../scripts/worker/bundle.mjs";
export const ORIGIN = "https://chronos.test";
export const bindings = {
  AI_ENABLED: "true",
  AI_ENVIRONMENT: "production",
  AI_ORIGIN: ORIGIN,
  AI_GATEWAY_ACCOUNT_ID: "0".repeat(32),
  AI_GATEWAY_ID: "chronos-test",
  OPENROUTER_API_KEY: "sk-or-v1-worker-test-key",
  AI_GATEWAY_TOKEN: "gateway-test-token",
  TURNSTILE_SECRET: "turnstile-test-secret",
  AI_COOKIE_SECRET: "cookie-test-secret".repeat(3),
};
export const answerScript = (text = "إجابة تجريبية.") =>
  new Response(
    `data: ${JSON.stringify({ model: "google/gemma-4-31b-it:free", choices: [{ delta: { content: text } }] })}\n\n` +
      'data: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    { headers: { "Content-Type": "text/event-stream" } },
  );
export async function assetResponse(request, directory = "public") {
  const url = new URL(request.url);
  if (url.pathname === "/ai-data-version.json")
    return Response.json({ bible: "0123456789", study: "0123456789" });
  const path = resolve(directory, "." + decodeURIComponent(url.pathname));
  if (!path.startsWith(resolve(directory) + "/"))
    return new Response(null, { status: 403 });
  try {
    return new Response(await readFile(path), {
      headers: {
        "Content-Type":
          extname(path) === ".json"
            ? "application/json"
            : "application/octet-stream",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
export async function harness(options = {}) {
  await bundle("worker/tests/entry.ts", "artifacts/worker/test.mjs");
  const log = [],
    calls = [];
  let gateway = async () => answerScript(),
    assets = assetResponse,
    turnstile;
  const mf = new Miniflare({
    ...convertV4MiniflareOptions({
      name: "ai-test",
      modules: true,
      scriptPath: "artifacts/worker/test.mjs",
      compatibilityDate: "2026-10-01",
      compatibilityFlags: ["enable_request_signal"],
      log: new Log(LogLevel.ERROR),
      bindings: { ...bindings, ...options.bindings },
      durableObjects: { AI: { className: "AiCoordinator", useSQLite: true } },
      durableObjectsPersist: options.persist ?? false,
      serviceBindings: { ASSETS: (request) => assets(request) },
      outboundService: async (request) => {
        const url = new URL(request.url);
        if (url.hostname === "challenges.cloudflare.com") {
          const input = await request.json();
          calls.push(input.response);
          return Response.json(
            turnstile ?? {
              success: input.response !== "invalid",
              action: "ai_answer",
              hostname: new URL(options.bindings?.AI_ORIGIN ?? ORIGIN).hostname,
              challenge_ts: new Date().toISOString(),
            },
          );
        }
        if (url.hostname !== "gateway.ai.cloudflare.com")
          throw new Error("Live calls forbidden");
        const body = await request.json();
        log.push({
          body,
          headers: Object.fromEntries(request.headers),
          url: request.url,
        });
        return gateway(request, body);
      },
    }),
    resourcePersistencePath: options.persist,
  });
  await mf.ready;
  const namespace = await mf.getDurableObjectNamespace("AI");
  const stub = namespace.get(
    namespace.idFromName(
      `chronos-ai-${options.bindings?.AI_ENVIRONMENT ?? "production"}`,
    ),
  );
  const sql = async (sql, args = []) =>
    (
      await stub.fetch("https://test/__test/sql", {
        method: "POST",
        body: JSON.stringify({ sql, args }),
      })
    ).json();
  const ledger = async (args) =>
    (
      await stub.fetch("https://test/__test/ledger", {
        method: "POST",
        body: JSON.stringify(args),
      })
    ).json();
  const status = async (cookie = "") =>
    mf.dispatchFetch(ORIGIN + "/api/ai/v1/status", { headers: { cookie } });
  const identify = async () =>
    (await status()).headers.get("set-cookie").split(";")[0];
  const answer = async (input = {}, cookie = "", extra = {}) =>
    mf.dispatchFetch(ORIGIN + "/api/ai/v1/answer", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "Content-Type": "application/json",
        cookie,
        ...extra.headers,
      },
      body: JSON.stringify({
        verseId: "MAT.8.15",
        chip: "explain",
        turnstileToken: crypto.randomUUID(),
        ...input,
      }),
      ...extra,
    });
  return {
    mf,
    log,
    calls,
    sql,
    ledger,
    status,
    identify,
    answer,
    gateway(fn) {
      gateway = fn;
    },
    assets(fn) {
      assets = fn;
    },
    turnstile(value) {
      turnstile = value;
    },
    close: () => mf.dispose(),
  };
}
