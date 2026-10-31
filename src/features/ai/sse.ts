import { AiError, type AiErrorKind, type StreamCallbacks } from "./types.ts";

export const MAX_LINE = 65536;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Map an OpenRouter error code (HTTP-style number, or a string) to a kind. */
export function classifyCode(
  code: unknown,
  message: unknown,
  metadata: unknown,
): AiErrorKind {
  const text = typeof message === "string" ? message : "";
  const numeric = typeof code === "number" ? code : Number(code);
  if (Number.isFinite(numeric)) {
    if (numeric === 401) return "auth";
    if (numeric === 402) return "quota";
    if (numeric === 403) return "refused";
    if (numeric === 400 || numeric === 404) return "unavailable";
    if (numeric === 429) {
      if (/per[- ]?day|daily/i.test(text)) return "quota";
      const provider = isObject(metadata) ? metadata.provider_name : undefined;
      // An upstream provider's own rate limit, not our shared allowance.
      if (typeof provider === "string" && provider !== "") return "server";
      return "rate";
    }
    return "server";
  }
  const name = String(code ?? "").toLowerCase();
  if (/rate/.test(name)) return "rate";
  if (/moderation|content|refusal|policy/.test(name)) return "refused";
  return "server";
}

/** Reset time from a 429 body's metadata.headers, as epoch ms, when present. */
export function retryAtFrom(metadata: unknown): number | undefined {
  const headers = isObject(metadata) ? metadata.headers : undefined;
  const raw = isObject(headers) ? headers["X-RateLimit-Reset"] : undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value < 1e12 ? value * 1000 : value;
}

export function errorFrom(
  error: unknown,
  afterFirstToken: boolean,
  model?: string,
): AiError {
  const e = isObject(error) ? error : {};
  return new AiError(
    classifyCode(e.code, e.message, e.metadata),
    afterFirstToken,
    { model, retryAt: retryAtFrom(e.metadata) },
  );
}

/**
 * Read an OpenRouter chat-completions SSE stream. Only `delta.content` is
 * answer text; keep-alive comments and hidden reasoning count as activity.
 */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  callbacks: StreamCallbacks,
): Promise<{ model: string; finish: "stop" | "length" }> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let model = "";
  let gotText = false;
  let finish: "stop" | "length" | undefined;
  let done = false;

  const handleLine = (raw: string) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line) return;
    if (line.startsWith(":")) {
      callbacks.onActivity?.();
      return;
    }
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") {
      done = true;
      return;
    }
    let chunk: unknown;
    try {
      chunk = JSON.parse(payload);
    } catch {
      throw new AiError("server", gotText, { model });
    }
    if (!isObject(chunk)) return;
    if (
      typeof chunk.model === "string" &&
      chunk.model &&
      chunk.model !== model
    ) {
      model = chunk.model;
      callbacks.onMeta?.(model);
    }
    if (chunk.error !== undefined) throw errorFrom(chunk.error, gotText, model);
    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
    if (!isObject(choice)) return;
    const delta = isObject(choice.delta) ? choice.delta : {};
    if (
      (typeof delta.reasoning === "string" && delta.reasoning) ||
      Array.isArray(delta.reasoning_details)
    )
      callbacks.onActivity?.();
    if (typeof delta.content === "string" && delta.content) {
      gotText = true;
      callbacks.onText(delta.content);
    }
    const reason = choice.finish_reason;
    if (reason === "error") throw new AiError("server", gotText, { model });
    if (reason === "content_filter")
      throw new AiError("refused", gotText, { model });
    if (reason === "length") finish = "length";
    else if (typeof reason === "string" && reason && finish === undefined)
      finish = "stop";
  };

  const drain = (final: boolean) => {
    const lines = buffer.split("\n");
    buffer = final ? "" : (lines.pop() ?? "");
    if (buffer.length > MAX_LINE)
      throw new AiError("server", gotText, { model });
    for (const line of lines) {
      handleLine(line);
      if (done) return;
    }
  };

  try {
    while (!done) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buffer += decoder.decode(value, { stream: true });
      drain(false);
    }
    if (!done) {
      buffer += decoder.decode();
      drain(true);
    }
  } finally {
    if (done) reader.cancel().catch(() => {});
  }
  if (!gotText) throw new AiError("empty", false, { model });
  if (!done && finish === undefined)
    throw new AiError("network", true, { model });
  return { model, finish: finish ?? "stop" };
}
