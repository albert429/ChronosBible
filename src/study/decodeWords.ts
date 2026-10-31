// Word resources are stored as gzip to stay inside the static-host asset budget.
// Hosts may already decode Content-Encoding, so inspect bytes rather than headers.
const MAX_BYTES = 256 * 1024;
const MAX_COMPRESSED = 30000;
const tooLarge = () => new Error("Study response exceeds size limit");

function joined(chunks: Uint8Array[], length: number) {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

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
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return joined(chunks, length);
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>) {
  if (typeof DecompressionStream !== "undefined")
    return limitedBytes(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
    );
  // Safari before 16.4 has no DecompressionStream; only those browsers load
  // this small decoder, with the same decoded-size limit.
  const { Gunzip } = await import("fflate");
  const chunks: Uint8Array[] = [];
  let length = 0;
  new Gunzip((chunk) => {
    length += chunk.byteLength;
    if (length > MAX_BYTES) throw tooLarge();
    chunks.push(chunk);
  }).push(bytes, true);
  return joined(chunks, length);
}

export async function decodeStudyWords(response: Response): Promise<unknown> {
  let bytes = await limitedBytes(response.body);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (bytes.byteLength > MAX_COMPRESSED)
      throw new Error("Compressed study response exceeds size limit");
    bytes = await gunzip(bytes);
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
