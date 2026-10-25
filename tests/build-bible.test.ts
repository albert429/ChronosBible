import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  buildBible,
  prepareBible,
  readBibleChapters,
} from "../scripts/build-bible.js";
import { catalog } from "../src/bible/catalog.ts";
import { validBibleChapter } from "../src/bible/client.ts";
import type { BibleChapter } from "../src/bible/types.ts";
import type { Day } from "../src/plan/readings.ts";

const root = new URL("../", import.meta.url).pathname;
const chapters: BibleChapter[] = readBibleChapters(root);
const byKey = new Map(
  chapters.map((chapter) => [`${chapter.usfm}:${chapter.chapter}`, chapter]),
);
const source = () =>
  JSON.parse(
    gunzipSync(readFileSync(join(root, "data/bible/source.json.gz"))).toString(
      "utf8",
    ),
  );
const digest = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

test("The pinned Bible has 66 books, 1189 chapters, 31104 verses and complete canonical bounds", () => {
  assert.equal(catalog.length, 66);
  assert.equal(catalog[0].usfm, "GEN");
  assert.equal(catalog.at(-1)?.usfm, "REV");
  assert.equal(catalog.filter((book) => book.testament === "OT").length, 39);
  assert.equal(chapters.length, 1189);
  assert.equal(
    chapters.reduce((sum, chapter) => sum + chapter.verseCount, 0),
    31104,
  );
  assert.equal(
    chapters
      .filter(
        (chapter) =>
          catalog.find((book) => book.usfm === chapter.usfm)?.testament ===
          "NT",
      )
      .reduce((sum, chapter) => sum + chapter.verseCount, 0),
    7959,
  );
  for (const chapter of chapters)
    assert.equal(
      validBibleChapter(chapter, `bible:${chapter.usfm}:${chapter.chapter}`),
      true,
    );
});

test("All 7959 unique NT verses exactly match the unchanged chronological plan", () => {
  const plan: Day[] = JSON.parse(
    readFileSync(join(root, "data/plan.json"), "utf8"),
  );
  const codes = new Map(catalog.map((book) => [book.name, book.usfm]));
  const unique = new Set<string>();
  for (const day of plan)
    for (const passage of day.passages) {
      const code = codes.get(passage.book)!;
      const chapter = byKey.get(`${code}:${passage.chapter}`)!;
      for (const verse of passage.verses) {
        assert.equal(
          chapter.passages[0].verses[verse.number - 1].text,
          verse.text,
          `${code}.${passage.chapter}.${verse.number}`,
        );
        unique.add(`${code}.${passage.chapter}.${verse.number}`);
      }
    }
  assert.equal(unique.size, 7959);
});

test("Genuine headings, superscriptions, acrostics and within-verse paragraphs remain separate", () => {
  const blocks = chapters.flatMap((chapter) => chapter.structure);
  assert.equal(blocks.filter((block) => block.kind === "heading").length, 1998);
  assert.equal(
    blocks.filter((block) => block.kind === "superscription").length,
    120,
  );
  assert.equal(blocks.filter((block) => block.kind === "acrostic").length, 22);
  assert.equal(blocks.filter((block) => block.marker === "qc").length, 1);
  assert.equal(
    blocks.filter(
      (block) =>
        block.kind === "paragraph" &&
        block.offset > 0 &&
        block.text === undefined,
    ).length,
    20,
  );
  assert.equal(
    blocks.filter(
      (block) => block.text?.startsWith("-") && block.text.endsWith("-"),
    ).length,
    5,
  );
  const psalm = byKey.get("PSA:119")!;
  assert.deepEqual(
    psalm.structure
      .filter((block) => block.kind === "acrostic")
      .map((block) => block.verse),
    Array.from({ length: 22 }, (_, i) => i * 8 + 1),
  );
  assert.equal(byKey.get("PSA:3")!.structure[0].kind, "superscription");
  assert.equal(byKey.get("GEN:1")!.structure[0].text, "البدء");
  const genesis = byKey.get("GEN:35")!;
  const split = genesis.structure.find(
    (block) => block.verse === 22 && block.offset > 0,
  )!;
  assert.equal(split.text, undefined);
  assert.ok(
    Array.from(genesis.passages[0].verses[21].text)
      .slice(split.offset)
      .join("")
      .startsWith("وَكَانَ بَنُو"),
  );
});

test("The Node-only builder emits deterministic lazy files inside the chapter payload budget", () => {
  const scratch = mkdtempSync(join(tmpdir(), "bible-build-"));
  try {
    assert.match(
      buildBible({ root, out: scratch }),
      /Generated 1189 canonical chapters/,
    );
    for (const chapter of chapters) {
      const bytes = readFileSync(
        join(scratch, chapter.usfm, `${chapter.chapter}.json`),
      );
      assert.equal(bytes.toString("utf8"), JSON.stringify(chapter));
      assert.ok(gzipSync(bytes).length <= 12 * 1024);
    }
    assert.deepEqual(
      JSON.parse(readFileSync(join(scratch, "catalog.json"), "utf8")),
      catalog,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("Malformed source chapters fail conversion and tampered committed sources fail checksums", () => {
  const broken = source();
  broken.books[0].chapters[0].verses[1].number = 1;
  assert.throws(() => prepareBible(broken), /Invalid canonical chapter GEN:1/);
  const scratch = mkdtempSync(join(tmpdir(), "bible-tamper-"));
  try {
    cpSync(join(root, "data/bible"), join(scratch, "data/bible"), {
      recursive: true,
    });
    const path = join(scratch, "data/bible/catalog.json");
    writeFileSync(path, "[]");
    assert.throws(() => readBibleChapters(scratch), /checksum mismatch/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("Committed normalization and provenance hashes are reproducible", () => {
  const provenance = JSON.parse(
    readFileSync(join(root, "data/bible/provenance.json"), "utf8"),
  );
  const compressed = readFileSync(join(root, "data/bible/source.json.gz"));
  const normalized = gunzipSync(compressed);
  assert.equal(digest(compressed), provenance.gzipSha256);
  assert.equal(digest(normalized), provenance.sourceSha256);
  assert.equal(
    normalized.toString("utf8"),
    `${JSON.stringify(JSON.parse(normalized.toString("utf8")))}\n`,
  );
  assert.equal(
    digest(readFileSync(join(root, "data/bible/catalog.json"))),
    provenance.catalogSha256,
  );
});
