import { AiError } from "../src/domain/ai/types.ts";
import type { AiProvider } from "./types.ts";
import type { Env } from "./env.ts";
import { classifyCode, readChatStream, retryAtFrom } from "./sse.ts";
import { bytes } from "./http.ts";

export function provider(
  env: Env,
  model: string,
  reserve: () => void,
): AiProvider {
  return {
    id: model,
    async stream(request, signal, callbacks) {
      signal.throwIfAborted();
      reserve(); // A failed dispatch still spends the provider's allowance.
      const response = await fetch(
        `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/openrouter/chat/completions`,
        {
          method: "POST",
          signal,
          // Explicit allowlist. No visitor cookies, IP, question metadata or forwarding headers.
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
            "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}`,
            "cf-aig-max-attempts": "1",
            "cf-aig-skip-cache": "true",
            "cf-aig-collect-log-payload": "false",
            "HTTP-Referer": env.AI_ORIGIN + "/",
            "X-OpenRouter-Title": "ChronosBible",
            "X-OpenRouter-App-Visibility": "hidden",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.prompt },
            ],
            stream: true,
            max_tokens: 2000,
            temperature: 0.3,
            reasoning: { exclude: true },
            provider: { allow_fallbacks: false },
          }),
        },
      );
      if (!response.ok) {
        let error: { message?: unknown; metadata?: unknown } = {};
        try {
          error =
            JSON.parse(
              new TextDecoder().decode(
                await bytes(response.body, 8192, signal),
              ),
            ).error ?? {};
        } catch {
          /* status alone is sufficient */
        }
        let retryAt = retryAtFrom(error.metadata);
        const retry = response.headers.get("retry-after");
        if (!retryAt && retry)
          retryAt = /^\d+$/.test(retry)
            ? Date.now() + Number(retry) * 1000
            : Date.parse(retry);
        throw new AiError(
          classifyCode(response.status, error.message, error.metadata),
          false,
          { retryAt: Number.isFinite(retryAt) ? retryAt : undefined },
        );
      }
      if (!response.body) throw new AiError("server");
      const end = await readChatStream(response.body, callbacks, signal);
      return { provider: "openrouter", ...end, model: end.model || model };
    },
  };
}
