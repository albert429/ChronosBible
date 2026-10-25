import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { catalog as defaultCatalog } from "../src/bible/catalog.ts";
import { validBibleChapter } from "../src/bible/client.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Pure conversion from the committed source schema to the public chapter schema. */
export function prepareBible(source, catalog = defaultCatalog) {
  if (
    source?.version !== 1 ||
    !Array.isArray(source.books) ||
    source.books.length !== 66
  )
    throw new Error("Invalid canonical Bible source");
  const chapters = [];
  for (const [index, book] of source.books.entries()) {
    const entry = catalog[index];
    if (
      !entry ||
      book.usfm !== entry.usfm ||
      book.name !== entry.name ||
      book.testament !== entry.testament ||
      !Array.isArray(book.chapters) ||
      book.chapters.length !== entry.chapters
    )
      throw new Error(`Invalid canonical book ${book?.usfm}`);
    for (const [chapterIndex, original] of book.chapters.entries()) {
      const count = entry.verseCounts[chapterIndex];
      const chapter = {
        mode: "bible",
        usfm: book.usfm,
        book: book.name,
        chapter: chapterIndex + 1,
        verseCount: count,
        passages: [
          {
            book: book.name,
            chapter: chapterIndex + 1,
            start: 1,
            end: count,
            verses: original.verses,
          },
        ],
        structure: original.structure,
      };
      if (
        original.chapter !== chapter.chapter ||
        !validBibleChapter(chapter, `bible:${book.usfm}:${chapter.chapter}`)
      )
        throw new Error(
          `Invalid canonical chapter ${book.usfm}:${original.chapter}`,
        );
      chapters.push(chapter);
    }
  }
  const count = chapters.reduce((sum, chapter) => sum + chapter.verseCount, 0);
  if (chapters.length !== 1189 || count !== 31104)
    throw new Error(
      "Canonical Bible coverage differs from 1189 chapters / 31104 verses",
    );
  return chapters;
}

/** Read the small committed source once; no Python, archive or network at build time. */
export function readBibleChapters(root = ROOT) {
  const folder = join(root, "data/bible");
  const provenance = JSON.parse(
    readFileSync(join(folder, "provenance.json"), "utf8"),
  );
  const compressed = readFileSync(join(folder, "source.json.gz"));
  const normalized = gunzipSync(compressed);
  const catalogBytes = readFileSync(join(folder, "catalog.json"));
  if (
    sha256(compressed) !== provenance.gzipSha256 ||
    sha256(normalized) !== provenance.sourceSha256 ||
    sha256(catalogBytes) !== provenance.catalogSha256
  )
    throw new Error("Canonical Bible source checksum mismatch");
  const catalog = JSON.parse(catalogBytes.toString("utf8"));
  if (JSON.stringify(catalog) !== JSON.stringify(defaultCatalog))
    throw new Error("Canonical catalog differs from the application catalog");
  return prepareBible(JSON.parse(normalized.toString("utf8")), catalog);
}

/** Validate all chapters and payload budgets before writing any public output. */
export function buildBible({ out, root = ROOT }) {
  const chapters = readBibleChapters(root);
  const payloads = chapters.map((chapter) => ({
    chapter,
    json: JSON.stringify(chapter),
  }));
  let largest = 0;
  for (const { chapter, json } of payloads) {
    const bytes = gzipSync(json).length;
    largest = Math.max(largest, bytes);
    if (bytes > 12 * 1024)
      throw new Error(
        `Canonical chapter ${chapter.usfm}:${chapter.chapter} exceeds 12KB gzip`,
      );
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "catalog.json"), JSON.stringify(defaultCatalog));
  for (const { chapter, json } of payloads) {
    const folder = join(out, chapter.usfm);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${chapter.chapter}.json`), json);
  }
  return `Generated ${chapters.length} canonical chapters; largest ${largest} bytes gzip.`;
}
