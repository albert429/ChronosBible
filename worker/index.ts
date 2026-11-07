import { AiError } from "../src/domain/ai/types.ts";
import { PROMPT_VERSION } from "../src/domain/ai/chips.ts";
import { AiCoordinator } from "./coordinator.ts";
import { configured, DEVICE_LIMITS, type Env } from "./env.ts";
import { failure, HEADERS } from "./http.ts";
export { AiCoordinator };

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/ai/")) return env.ASSETS.fetch(request);
    if (
      url.search ||
      !["/api/ai/v1/status", "/api/ai/v1/answer"].includes(url.pathname)
    )
      return new Response(null, { status: 404, headers: HEADERS });
    const status = url.pathname.endsWith("/status");
    if (request.method !== (status ? "GET" : "POST"))
      return new Response(null, { status: 405, headers: HEADERS });
    if (
      !status &&
      (request.headers.get("Origin") !== env.AI_ORIGIN ||
        ["cross-site", "same-site"].includes(
          request.headers.get("Sec-Fetch-Site") ?? "",
        ))
    )
      return failure(new AiError("origin"));
    if (!configured(env))
      return status
        ? Response.json(
            {
              available: false,
              cacheRevision: String(PROMPT_VERSION),
              limits: DEVICE_LIMITS,
              usage: { answers: 0, attempts: 0 },
              resets: { device: 0, provider: 0 },
            },
            { headers: HEADERS },
          )
        : failure(new AiError("disabled"));
    if (Number(request.headers.get("content-length")) > 16384)
      return failure(new AiError("invalid"));
    const stub = env.AI.get(
      env.AI.idFromName(`chronos-ai-${env.AI_ENVIRONMENT}`),
    );
    const requestId = crypto.randomUUID();
    const cancel = () => {
      ctx.waitUntil(
        stub
          .fetch("https://internal/cancel", {
            method: "POST",
            headers: { "x-ai-request-id": requestId },
          })
          .then(() => {})
          .catch(() => {}),
      );
    };
    request.signal.addEventListener("abort", cancel, { once: true });
    try {
      const forwarded = new Request(request);
      forwarded.headers.set("x-ai-request-id", requestId);
      const response = await stub.fetch(forwarded);
      if (!response.body) {
        request.signal.removeEventListener("abort", cancel);
        return response;
      }
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(stream) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              request.signal.removeEventListener("abort", cancel);
              stream.close();
            } else stream.enqueue(chunk.value);
          } catch (error) {
            cancel();
            stream.error(error);
          }
        },
        async cancel() {
          cancel();
          request.signal.removeEventListener("abort", cancel);
          await reader.cancel().catch(() => {});
        },
      });
      if (request.signal.aborted) cancel();
      return new Response(body, response);
    } catch {
      request.signal.removeEventListener("abort", cancel);
      return failure(new AiError("storage"));
    }
  },
} satisfies ExportedHandler<Env>;
