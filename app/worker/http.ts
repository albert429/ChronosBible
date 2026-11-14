import { AiError } from "../src/features/ai/domain/types.ts";

export const HEADERS = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export function failure(error: unknown) {
  const e = error instanceof AiError ? error : new AiError("storage");
  const status =
    e.kind === "invalid"
      ? 400
      : ["origin", "challenge", "auth"].includes(e.kind)
        ? 403
        : ["quota", "cap", "attempts", "rate", "busy"].includes(e.kind)
          ? 429
          : 503;
  return Response.json(
    { error: { kind: e.kind, retryAt: e.retryAt } },
    {
      status,
      headers: {
        ...HEADERS,
        ...(e.retryAt
          ? {
              "Retry-After": String(
                Math.max(1, Math.ceil((e.retryAt - Date.now()) / 1000)),
              ),
            }
          : {}),
      },
    },
  );
}

export async function bytes(
  body: ReadableStream<Uint8Array> | null,
  max: number,
  signal?: AbortSignal,
) {
  if (!body) throw new AiError("invalid");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const stop = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) throw new AiError("invalid");
      chunks.push(value);
    }
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener("abort", stop);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function jsonBody(request: Request, signal = request.signal) {
  if (
    Number(request.headers.get("content-length")) > 16384 ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    throw new AiError("invalid");
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        await bytes(request.body, 16384, signal),
      ),
    ) as unknown;
  } catch {
    throw new AiError("invalid");
  }
}
