import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  buildCanonicalStudy,
  chapterPayloads,
  readCanonicalStudy,
  publishStudyPayloads,
  STUDY_BUDGETS,
  STUDY_WORDS_RAW_LIMIT,
} from "../scripts/build-study-canonical.js";
import { readBibleChapters } from "../scripts/build-bible.js";
import { scanAssets } from "../scripts/cloudflare-app.mjs";
import type { GreekToken, StudyWords } from "../src/study/types.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

test("All canonical verses publish bounded words and translations with unchanged NT Greek", (t) => {
  const out = mkdtempSync(join(tmpdir(), "canonical-study-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const target = join(out, "study");
  const stats = buildCanonicalStudy({ out: target, root });
  assert.equal(stats.chapters, 1189);
  assert.equal(stats.verses, 31104);
  assert.ok(stats.bytes < 25 * 1024 * 1024);
  assert.ok(stats.maxWordRaw <= STUDY_WORDS_RAW_LIMIT);
  assert.ok(stats.maxWordGzip <= STUDY_BUDGETS.words);
  assert.ok(stats.maxTranslationGzip <= STUDY_BUDGETS.translations);
  assert.ok(stats.maxLexiconGzip <= STUDY_BUDGETS.lexicon);
  scanAssets(out, {});
  const source = readCanonicalStudy(root);
  const greek = JSON.parse(
    readFileSync(join(root, "data/study/greek.json"), "utf8"),
  ) as Record<string, GreekToken[]>;
  let covered = 0;
  for (const chapter of readBibleChapters(root)) {
    const directory = join(target, "v2", chapter.usfm, String(chapter.chapter));
    const index = JSON.parse(
      readFileSync(join(directory, "index.json"), "utf8"),
    );
    assert.equal(index.book, chapter.usfm);
    assert.equal(index.chapter, chapter.chapter);
    let next = 1;
    for (const range of index.ranges) {
      assert.equal(range.start, next);
      const wordBytes = readFileSync(
        join(directory, `${range.key}.words.json.gz`),
      );
      const words = JSON.parse(
        gunzipSync(wordBytes).toString("utf8"),
      ) as StudyWords;
      const tr = JSON.parse(
        readFileSync(join(directory, `${range.key}.tr.json`), "utf8"),
      );
      for (let verse = range.start; verse <= range.end; verse++) {
        const id = `${chapter.usfm}.${chapter.chapter}.${verse}`;
        assert.deepEqual(tr.verses[verse], source.translations[id]);
        const tokens = words.verses[String(verse)].w;
        assert.ok(tokens.length > 0, id);
        if (greek[id])
          assert.deepEqual(
            tokens,
            greek[id].map((token) => [...token, "grc"]),
          );
        else assert.deepEqual(tokens, source.ot[id]);
        // STEP joins a gloss's words with "_"; readers see spaces.
        assert.ok(!tokens.some((token) => token[4].includes("_")), id);
        covered++;
      }
      next = range.end + 1;
    }
    assert.equal(next, chapter.verseCount + 1);
  }
  assert.equal(covered, 31104);

  // Exact published values, so the data is not only checked against itself.
  const strongs = (book: string, chapter: number, verse: number) =>
    publishedWords(target, book, chapter, verse).map((token) => token[2]);
  // Gen 4:8 without the LXX "let us go to the field" of the BHS apparatus.
  assert.deepEqual(strongs("GEN", 4, 8), [
    ...["H9001", "H0559", "H7014B", "H0413", "H1893", "H0251G", "H9023"],
    ...["H9001", "H1961", "H9003", "H1961", "H9048", "H9003", "H7704G"],
    ...["H7014B", "H9001", "H6965B", "H0413", "H1893", "H0251G", "H9023"],
    ...["H9001", "H2026", "H9033"],
  ]);
  assert.ok(!strongs("1SA", 13, 1).some((s) => ["H7970", "H0705"].includes(s)));
  assert.equal(strongs("GEN", 19, 22).filter((s) => s === "H7121H").length, 1);
  // Arabic/KJV numbering where the Hebrew differs (Mal 3:19, Joel 3:1) and a
  // Psalm whose Hebrew verses 1-2 are its title.
  assert.deepEqual(strongs("MAL", 4, 1).slice(0, 3), [
    "H3588A",
    "H2009",
    "H0935G",
  ]);
  assert.deepEqual(strongs("JOL", 2, 28).slice(0, 3), [
    "H9001",
    "H1961",
    "H0310A",
  ]);
  assert.deepEqual(strongs("PSA", 51, 1).slice(0, 3), [
    "H2603A",
    "H9030",
    "H0430G",
  ]);
  const daniel = publishedWords(target, "DAN", 2, 4);
  assert.equal(daniel[0][7], "he");
  assert.equal(daniel.at(-1)?.[7], "arc");
  const lexicon = (shard: string) =>
    JSON.parse(readFileSync(join(target, "v2/lex", `${shard}.json`), "utf8"))
      .lex as Record<string, { l: string; g: string }>;
  assert.deepEqual(lexicon("H30").H3068G, {
    l: "\u05d9\u05b0\u05d4\u05b9\u05d5\u05b8\u05d4",
    g: "LORD",
    d: "",
  });
  assert.equal(lexicon("H48").H4872.g, "Moses");
  assert.equal(lexicon("H34").H3478.g, "Israel");
  assert.equal(lexicon("H90").H9005.g, "to/for");
});

function publishedWords(
  target: string,
  book: string,
  chapter: number,
  verse: number,
) {
  const directory = join(target, "v2", book, String(chapter));
  const index = JSON.parse(readFileSync(join(directory, "index.json"), "utf8"));
  const range = index.ranges.find(
    (r: { start: number; end: number }) => verse >= r.start && verse <= r.end,
  );
  const words = JSON.parse(
    gunzipSync(
      readFileSync(join(directory, `${range.key}.words.json.gz`)),
    ).toString("utf8"),
  ) as StudyWords;
  return words.verses[String(verse)].w;
}

test("Oversized chapters split at shared verse boundaries deterministically", () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({
    number: index + 1,
    words: [[`word ${index}`, "x", "H0001", "H", "father", 0, 0, "he"]],
    translations: { n: `translation ${index}`, e: `text ${index}` },
  }));
  const whole = chapterPayloads("GEN", 1, rows);
  const smaller = { ...STUDY_BUDGETS, words: whole[0].compressed.length - 1 };
  const split = chapterPayloads("GEN", 1, rows, smaller);
  assert.ok(split.length > 1);
  assert.deepEqual(
    split.map((part) => part.range),
    [
      { start: 1, end: 4, key: "1-4" },
      { start: 5, end: 8, key: "5-8" },
    ],
  );
  assert.deepEqual(split, chapterPayloads("GEN", 1, rows, smaller));
  assert.throws(
    () => chapterPayloads("GEN", 1, [rows[0]], { ...smaller, words: 1 }),
    /single verse/,
  );
});

test("Regeneration removes only obsolete inventory-owned files", (t) => {
  const out = mkdtempSync(join(tmpdir(), "canonical-inventory-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const original = "GEN/1/1-31.words.json.gz";
  publishStudyPayloads(out, [[original, Buffer.from("first")]]);
  const foreign = join(out, "v2/notes.txt");
  writeFileSync(foreign, "preserve me");
  publishStudyPayloads(out, [["GEN/1/1-15.words.json.gz", Buffer.from("new")]]);
  assert.equal(existsSync(join(out, "v2", original)), false);
  assert.equal(readFileSync(foreign, "utf8"), "preserve me");
  const changed = join(out, "v2/GEN/1/1-15.words.json.gz");
  writeFileSync(changed, "user modified this output");
  assert.throws(
    () => publishStudyPayloads(out, [[original, Buffer.from("replacement")]]),
    /refusing removal/,
  );
  assert.equal(readFileSync(changed, "utf8"), "user modified this output");
});
