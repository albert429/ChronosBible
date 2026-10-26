// Word resources are stored as gzip to stay inside the static-host asset budget.
// Hosts may already decode Content-Encoding, so inspect bytes rather than headers.
const MAX_BYTES = 256 * 1024;
export const UNSUPPORTED_WORDS =
  "يتطلب عرض الكلمات الأصلية تحديث المتصفح. يمكنك قراءة الترجمات الأخرى الآن.";

async function limitedBytes(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) throw new Error("Empty study response");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Study response exceeds size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function decodeStudyWords(response: Response): Promise<unknown> {
  let bytes = await limitedBytes(response.body);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (bytes.byteLength > 30000)
      throw new Error("Compressed study response exceeds size limit");
    if (typeof DecompressionStream === "undefined")
      throw new Error(UNSUPPORTED_WORDS);
    const decoded = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    bytes = await limitedBytes(decoded);
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
