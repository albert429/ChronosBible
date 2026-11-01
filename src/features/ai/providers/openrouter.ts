import type { OpenRouterConfig } from "../config.ts";
import { ROUTER_MODEL } from "../config.ts";
import { classifyCode, readChatStream, retryAtFrom } from "../sse.ts";
import {
  AiError,
  type AiMeta,
  type AiProvider,
  type AiRequest,
  type StreamCallbacks,
} from "../types.ts";

export type OpenRouterOptions = OpenRouterConfig & {
  /** App URL for OpenRouter attribution (ASCII). */
  referer: string;
  /** App name for attribution; must be ASCII (header values). */
  title: string;
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Map a non-OK response (status + parsed body) to an error; never exposes its text. */
export function classifyStatus(status: number, body: unknown): AiError {
  const error = isObject(body) && isObject(body.error) ? body.error : {};
  const kind = classifyCode(status, error.message, error.metadata);
  return new AiError(kind, false, {
    retryAt: status === 429 ? retryAtFrom(error.metadata) : undefined,
  });
}

async function readBody(response: Response): Promise<unknown> {
  try {
    const text = (await response.text()).slice(0, 8192);
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toAiError(error: unknown, signal: AbortSignal): AiError {
  if (error instanceof AiError) return error;
  if (signal.aborted) return new AiError("aborted");
  return new AiError("network");
}

export function createOpenRouter(
  options: OpenRouterOptions,
  fetcher: typeof fetch = fetch,
): AiProvider {
  const attempt = async (
    models: string[],
    request: AiRequest,
    signal: AbortSignal,
    callbacks: StreamCallbacks,
  ): Promise<AiMeta> => {
    let response: Response;
    try {
      response = await fetcher(`${options.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": options.referer,
          "X-OpenRouter-Title": options.title,
          "X-OpenRouter-App-Visibility": "hidden",
        },
        body: JSON.stringify({
          models,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt },
          ],
          stream: true,
          max_tokens: request.maxOutputTokens,
          temperature: 0.3,
          reasoning: { exclude: true },
        }),
        credentials: "omit",
        cache: "no-store",
        signal,
      });
    } catch (error) {
      throw toAiError(error, signal);
    }
    if (!response.ok)
      throw classifyStatus(response.status, await readBody(response));
    if (!response.body) throw new AiError("server");
    try {
      const end = await readChatStream(response.body, callbacks);
      return { provider: "openrouter", ...end };
    } catch (error) {
      throw toAiError(error, signal);
    }
  };

  return {
    id: "openrouter",
    async stream(request, signal, callbacks) {
      try {
        return await attempt(options.models, request, signal, callbacks);
      } catch (error) {
        // A stale slug or a data-policy mismatch: one last try with the router,
        // but never after text arrived (answers are not spliced).
        const routerOnly =
          options.models.length === 1 && options.models[0] === ROUTER_MODEL;
        if (
          error instanceof AiError &&
          error.kind === "unavailable" &&
          !error.afterFirstToken &&
          !routerOnly &&
          !signal.aborted
        )
          return attempt([ROUTER_MODEL], request, signal, callbacks);
        throw error;
      }
    },
  };
}
