import {
  AiError,
  type AiEvent,
  type AiMeta,
  type AiStatus,
  type AnswerRequest,
  type StreamCallbacks,
} from "../../domain/ai/types.ts";

function apiError(value: unknown) {
  const error = (value as { error?: { kind?: string; retryAt?: number } })
    ?.error;
  const kinds = [
    "invalid",
    "origin",
    "challenge",
    "disabled",
    "busy",
    "storage",
    "cap",
    "attempts",
    "quota",
    "rate",
    "auth",
    "refused",
    "unavailable",
    "server",
    "network",
    "timeout",
    "empty",
    "aborted",
  ];
  return new AiError(
    kinds.includes(error?.kind ?? "")
      ? (error!.kind as AiError["kind"])
      : "server",
    false,
    { retryAt: error?.retryAt },
  );
}
export async function aiStatus(signal: AbortSignal): Promise<AiStatus> {
  const response = await fetch("/api/ai/v1/status", {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw apiError(data);
  if (
    typeof data.available !== "boolean" ||
    typeof data.cacheRevision !== "string" ||
    !Number.isInteger(data.usage?.answers) ||
    !Number.isInteger(data.usage?.attempts) ||
    !Number.isInteger(data.limits?.answers)
  )
    throw new AiError("server");
  return data;
}
export async function answer(
  input: AnswerRequest,
  signal: AbortSignal,
  callbacks: StreamCallbacks,
): Promise<AiMeta> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch("/api/ai/v1/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(input),
      signal,
    });
    if (!response.ok) throw apiError(await response.json());
    if (
      !response.body ||
      !response.headers.get("content-type")?.startsWith("text/event-stream")
    )
      throw new AiError("server");
    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "",
      event = "",
      data = "",
      text = "";
    const dispatch = (): AiMeta | undefined => {
      if (!data) return;
      const e = { event, data: JSON.parse(data) } as AiEvent;
      data = "";
      event = "";
      if (e.event === "meta" && e.data.model) callbacks.onMeta?.(e.data.model);
      else if (e.event === "activity") callbacks.onActivity?.();
      else if (e.event === "quota") callbacks.onQuota?.(e.data);
      else if (e.event === "delta") {
        if (typeof e.data.text !== "string" || e.data.text.length > 6000)
          throw new AiError("server");
        if (callbacks.onSnapshot) callbacks.onSnapshot(e.data.text);
        else callbacks.onText(e.data.text.slice(text.length));
        text = e.data.text;
      } else if (e.event === "error")
        throw new AiError(e.data.kind, !!text, {
          model: e.data.model,
          retryAt: e.data.retryAt,
        });
      else if (e.event === "done") return e.data;
    };
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 65536) throw new AiError("server", !!text);
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
        else if (!line) {
          const meta = dispatch();
          if (meta) return meta;
        }
      }
    }
    throw new AiError("network", !!text);
  } catch (error) {
    if (signal.aborted) throw new AiError("aborted");
    if (error instanceof AiError) throw error;
    throw new AiError("network");
  } finally {
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
