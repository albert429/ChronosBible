import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyStatus,
  createOpenRouter,
  type OpenRouterOptions,
} from "../src/ai/providers/openrouter.ts";
import { AiError, type AiErrorKind, type AiRequest } from "../src/ai/types.ts";

type Call = {
  url: string;
  init: RequestInit & { headers: Record<string, string>; body: string };
};

const options: OpenRouterOptions = {
  id: "openrouter",
  apiKey: "sk-or-v1-test",
  models: ["google/gemma-4-31b-it:free", "openrouter/free"],
  baseUrl: "https://openrouter.ai/api/v1",
  referer: "https://example.app/",
  title: "ChronosBible",
};
const request: AiRequest = {
  system: "نظام",
  prompt: "سؤال",
  maxOutputTokens: 2000,
};
const sse = (...chunks: unknown[]) =>
  new Response(
    chunks
      .map((c) =>
        typeof c === "string" ? c : `data: ${JSON.stringify(c)}\n\n`,
      )
      .join(""),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  );
const ok = (model = "google/gemma-4-31b-it:free") =>
  sse(
    { model, choices: [{ delta: { content: "إجابة" } }] },
    { model, choices: [{ delta: {}, finish_reason: "stop" }] },
    "data: [DONE]\n\n",
  );
const callbacks = () => ({ onText() {}, onMeta() {}, onActivity() {} });

test("Sends one ASCII-only streaming request with the free model list", async () => {
  const calls: Call[] = [];
  const provider = createOpenRouter(options, async (url, init) => {
    calls.push({ url: String(url), init: init as Call["init"] });
    return ok();
  });
  const meta = await provider.stream(
    request,
    new AbortController().signal,
    callbacks(),
  );
  assert.deepEqual(meta, {
    provider: "openrouter",
    model: "google/gemma-4-31b-it:free",
    finish: "stop",
  });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "omit");
  assert.equal(init.cache, "no-store");
  for (const [name, value] of Object.entries(init.headers)) {
    assert.match(name, /^[\x21-\x7E]+$/);
    assert.match(value, /^[\x20-\x7E]+$/, name);
  }
  assert.equal(init.headers.Authorization, "Bearer sk-or-v1-test");
  assert.equal(init.headers["X-OpenRouter-Title"], "ChronosBible");
  assert.equal(init.headers["X-OpenRouter-App-Visibility"], "hidden");
  assert.equal(init.headers["HTTP-Referer"], "https://example.app/");
  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), [
    "max_tokens",
    "messages",
    "models",
    "reasoning",
    "stream",
    "temperature",
  ]);
  assert.deepEqual(body.models, options.models);
  assert.equal(body.stream, true);
  assert.deepEqual(body.reasoning, { exclude: true });
  assert.deepEqual(body.messages, [
    { role: "system", content: "نظام" },
    { role: "user", content: "سؤال" },
  ]);
});

test("HTTP errors map to kinds without exposing server text", () => {
  const cases: [number, unknown, AiErrorKind][] = [
    [401, {}, "auth"],
    [402, {}, "quota"],
    [
      403,
      {
        error: { code: 403, message: "flagged", metadata: { reasons: ["x"] } },
      },
      "refused",
    ],
    [400, {}, "unavailable"],
    [
      404,
      {
        error: {
          code: 404,
          message: "No endpoints found matching your data policy",
        },
      },
      "unavailable",
    ],
    [408, {}, "server"],
    [502, {}, "server"],
    [503, {}, "server"],
    [
      429,
      {
        error: {
          code: 429,
          message: "Rate limit exceeded: free-models-per-day. Add 10 credits",
        },
      },
      "quota",
    ],
    [
      429,
      {
        error: {
          code: 429,
          message: "Rate limit exceeded: free-models-per-min.",
          metadata: {
            provider_name: null,
            headers: { "X-RateLimit-Reset": "1760054460000" },
          },
        },
      },
      "rate",
    ],
    [
      429,
      {
        error: {
          code: 429,
          message: "Provider returned error",
          metadata: { provider_name: "Google AI Studio" },
        },
      },
      "server",
    ],
  ];
  for (const [status, body, kind] of cases) {
    const error = classifyStatus(status, body);
    assert.equal(error.kind, kind, `${status} ${JSON.stringify(body)}`);
    assert.doesNotMatch(error.message, /flagged|endpoints|credits/);
  }
  assert.equal(classifyStatus(429, cases[9][1]).retryAt, 1760054460000);
});

test("An unavailable model list gets exactly one retry through the free router", async () => {
  const bodies: unknown[] = [];
  const provider = createOpenRouter(options, async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)).models);
    return bodies.length === 1
      ? Response.json(
          { error: { code: 404, message: "No endpoints found" } },
          { status: 404 },
        )
      : ok("thinkingmachines/inkling:free");
  });
  const meta = await provider.stream(
    request,
    new AbortController().signal,
    callbacks(),
  );
  assert.equal(meta.model, "thinkingmachines/inkling:free");
  assert.deepEqual(bodies, [options.models, ["openrouter/free"]]);

  let count = 0;
  const routerOnly = createOpenRouter(
    { ...options, models: ["openrouter/free"] },
    async () => {
      count++;
      return Response.json({}, { status: 404 });
    },
  );
  await assert.rejects(
    routerOnly.stream(request, new AbortController().signal, callbacks()),
    (e: AiError) => e.kind === "unavailable",
  );
  assert.equal(count, 1);
});

test("No router retry once text has arrived: answers are never spliced", async () => {
  for (const code of [400, "404"]) {
    let calls = 0;
    const provider = createOpenRouter(options, async () => {
      calls += 1;
      return calls === 1
        ? sse(
            {
              model: "google/gemma-4-31b-it:free",
              choices: [{ delta: { content: "بداية" } }],
            },
            {
              error: { code, message: "bad" },
              choices: [{ delta: { content: "" }, finish_reason: "error" }],
            },
          )
        : ok("other/model:free");
    });
    let text = "";
    await assert.rejects(
      provider.stream(request, new AbortController().signal, {
        ...callbacks(),
        onText(delta) {
          text += delta;
        },
      }),
      (error) =>
        error instanceof AiError &&
        error.kind === "unavailable" &&
        error.afterFirstToken === true,
    );
    assert.equal(calls, 1, String(code));
    assert.equal(text, "بداية");
  }
});

test("Network failures and aborts are told apart", async () => {
  const offline = createOpenRouter(options, async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(
    offline.stream(request, new AbortController().signal, callbacks()),
    (e) => e instanceof AiError && e.kind === "network",
  );

  const controller = new AbortController();
  const slow = createOpenRouter(
    options,
    (_url, init) =>
      new Promise((_, reject) => {
        const signal = init?.signal;
        assert.ok(signal);
        signal.addEventListener("abort", () => reject(signal.reason));
      }),
  );
  const pending = slow.stream(request, controller.signal, callbacks());
  controller.abort("stop");
  await assert.rejects(
    pending,
    (e) => e instanceof AiError && e.kind === "aborted",
  );
});
