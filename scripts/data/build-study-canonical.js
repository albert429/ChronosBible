import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  STUDY_WORDS_GZIP_LIMIT,
  STUDY_WORDS_RAW_LIMIT,
} from "../../src/domain/study/limits.ts";
import { publishOwned } from "../lib/ownership.js";
import { readBibleChapters } from "./build-bible.js";

// The word-range limits are the ones the app's decoder and the hosting audit
// enforce (src/domain/study/limits.ts). Translation and lexicon budgets are
// build-only: nothing at run time checks them.
export { STUDY_WORDS_RAW_LIMIT };
export const STUDY_BUDGETS = {
  words: STUDY_WORDS_GZIP_LIMIT,
  translations: 30000,
  lexicon: 35000,
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => Buffer.from(JSON.stringify(value));
const fail = (message) => {
  throw new Error(`build-study-canonical: ${message}`);
};

export function readCanonicalStudy(root) {
  const folder = join(root, "data/study");
  const compressed = readFileSync(join(folder, "canonical.json.gz"));
  const provenance = JSON.parse(
    readFileSync(join(folder, "canonical-provenance.json"), "utf8"),
  );
  const pins = JSON.parse(
    readFileSync(join(folder, "canonical-sources.json"), "utf8"),
  );
  if (
    pins.stepCommit !== provenance.stepCommit ||
    JSON.stringify(pins.sources) !== JSON.stringify(provenance.sources) ||
    JSON.stringify(pins.legacyNt) !== JSON.stringify(provenance.legacyNt)
  )
    fail("provenance differs from reviewed source pins");
  if (hash(compressed) !== provenance.gzipSha256)
    fail("canonical study archive checksum mismatch");
  for (const [name, expected] of Object.entries(provenance.legacyNt || {})) {
    if (
      !["greek.json", "lexicon.json"].includes(name) ||
      hash(readFileSync(join(folder, name))) !== expected
    )
      fail("legacy NT study checksum mismatch");
  }
  if (Object.keys(provenance.legacyNt || {}).length !== 2)
    fail("missing legacy NT source pins");
  const raw = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
  if (
    hash(raw) !== provenance.sourceSha256 ||
    hash(readFileSync(join(root, "data/bible/source.json.gz"))) !==
      provenance.bibleGzipSha256
  )
    fail("canonical source or Bible checksum mismatch");
  const data = JSON.parse(raw.toString("utf8"));
  if (data.v !== 2 || !data.ot || !data.translations || !data.lexicon)
    fail("invalid canonical study source");
  return data;
}

/** Both resources share contiguous ranges, even when only one needs splitting. */
export function chapterPayloads(
  book,
  chapter,
  verseRows,
  budgets = STUDY_BUDGETS,
) {
  const output = [];
  function visit(rows) {
    const start = rows[0].number;
    const end = rows.at(-1).number;
    const header = { v: 2, book, chapter, start, end };
    const words = json({
      ...header,
      verses: Object.fromEntries(
        rows.map((row) => [row.number, { w: row.words }]),
      ),
    });
    const tr = json({
      ...header,
      verses: Object.fromEntries(
        rows.map((row) => [row.number, row.translations]),
      ),
    });
    const compressed = gzipSync(words, { level: 9 });
    if (
      words.length > STUDY_WORDS_RAW_LIMIT ||
      compressed.length > budgets.words ||
      gzipSync(tr).length > budgets.translations
    ) {
      if (rows.length === 1)
        fail(`single verse exceeds budget: ${book}.${chapter}.${start}`);
      const middle = Math.floor(rows.length / 2);
      visit(rows.slice(0, middle));
      visit(rows.slice(middle));
    } else
      output.push({
        range: { start, end, key: `${start}-${end}` },
        words,
        compressed,
        tr,
      });
  }
  if (!verseRows.length) fail("empty chapter");
  visit(verseRows);
  return output;
}

function validateWords(words, id, text) {
  if (!Array.isArray(words) || !words.length) fail(`missing words at ${id}`);
  const count = text.split(" ").length;
  for (const token of words) {
    if (
      !Array.isArray(token) ||
      token.length !== 8 ||
      !token.slice(0, 5).every((field) => typeof field === "string") ||
      !token[0] ||
      !/^[GH]\d{4}[A-Za-z]*(?:[ /]G\d{4}[A-Za-z]*)*$/.test(token[2]) ||
      !["grc", "he", "arc"].includes(token[7]) ||
      (token[7] === "grc") !== token[2].startsWith("G") ||
      !(
        (token[5] === null && token[6] === null) ||
        (Number.isInteger(token[5]) &&
          Number.isInteger(token[6]) &&
          token[5] >= 0 &&
          token[5] <= token[6] &&
          token[6] < count)
      )
    )
      fail(`invalid original-language token at ${id}`);
  }
}

const validText = (value) =>
  typeof value === "string"
    ? value.length > 0
    : value &&
      typeof value.b === "string" &&
      /^\d+-\d+$/.test(value.b) &&
      typeof value.t === "string" &&
      value.t.length > 0;

export function buildCanonicalStudy({ out, root }) {
  const source = readCanonicalStudy(root);
  const greek = JSON.parse(
    readFileSync(join(root, "data/study/greek.json"), "utf8"),
  );
  const legacyLex = JSON.parse(
    readFileSync(join(root, "data/study/lexicon.json"), "utf8"),
  );
  const lexicon = { ...legacyLex, ...source.lexicon };
  const stats = {
    chapters: 0,
    verses: 0,
    ranges: 0,
    files: 0,
    bytes: 0,
    maxWordGzip: 0,
    maxWordRaw: 0,
    maxTranslationGzip: 0,
    maxLexiconGzip: 0,
  };
  const used = new Set();
  const expectedOt = new Set();
  const expectedTranslations = new Set();
  const payloads = [];
  // Validate all data and request budgets before publishing any v2 assets.
  for (const reading of readBibleChapters(root)) {
    const { usfm: book, chapter } = reading;
    const rows = reading.passages[0].verses.map((verse) => {
      const id = `${book}.${chapter}.${verse.number}`;
      const words =
        source.ot[id] || greek[id]?.map((token) => [...token, "grc"]);
      validateWords(words, id, verse.text);
      for (const token of words) used.add(token[2]);
      const translations = source.translations[id];
      if (
        !translations ||
        !validText(translations.n) ||
        !validText(translations.e)
      )
        fail(`missing translation at ${id}`);
      if (source.ot[id]) expectedOt.add(id);
      expectedTranslations.add(id);
      stats.verses++;
      return { number: verse.number, words, translations };
    });
    const parts = chapterPayloads(book, chapter, rows);
    stats.chapters++;
    stats.ranges += parts.length;
    const folder = `${book}/${chapter}`;
    payloads.push([
      `${folder}/index.json`,
      json({ v: 2, book, chapter, ranges: parts.map((part) => part.range) }),
    ]);
    for (const part of parts) {
      payloads.push([
        `${folder}/${part.range.key}.words.json.gz`,
        part.compressed,
      ]);
      payloads.push([`${folder}/${part.range.key}.tr.json`, part.tr]);
      stats.maxWordGzip = Math.max(stats.maxWordGzip, part.compressed.length);
      stats.maxWordRaw = Math.max(stats.maxWordRaw, part.words.length);
      stats.maxTranslationGzip = Math.max(
        stats.maxTranslationGzip,
        gzipSync(part.tr).length,
      );
    }
  }
  if (
    expectedOt.size !== Object.keys(source.ot).length ||
    expectedOt.size !== 23145 ||
    expectedTranslations.size !== Object.keys(source.translations).length ||
    stats.verses !== 31104 ||
    stats.chapters !== 1189
  )
    fail("canonical coverage differs from source");
  const shards = new Map();
  for (const strong of [...used].sort()) {
    const entry = lexicon[strong];
    if (
      !entry ||
      ![entry.l, entry.g, entry.d].every((s) => typeof s === "string")
    )
      fail(`missing lexicon entry ${strong}`);
    const key = strong.slice(0, 3);
    if (!shards.has(key)) shards.set(key, {});
    shards.get(key)[strong] = {
      ...entry,
      d:
        entry.d.length > 160
          ? entry.d.slice(0, 160).replace(/\s+\S*$/, "") + "…"
          : entry.d,
    };
  }
  for (const [shard, lex] of shards) {
    const body = json({ v: 2, shard, lex });
    const size = gzipSync(body).length;
    if (size > STUDY_BUDGETS.lexicon)
      fail(`lexicon shard ${shard} exceeds budget`);
    stats.maxLexiconGzip = Math.max(stats.maxLexiconGzip, size);
    payloads.push([`lex/${shard}.json`, body]);
  }
  const published = publishStudyPayloads(out, payloads);
  stats.files = published.files;
  stats.bytes = published.bytes;
  return stats;
}

/** Study path names: chapter indexes and ranges, and lexicon shards. */
export const STUDY_PATH =
  /^(?:[1-3]?[A-Z]{2,3}\/[1-9]\d*\/(?:index\.json|[1-9]\d*-[1-9]\d*\.(?:tr\.json|words\.json\.gz))|lex\/[GH]\d{2}\.json)$/;

/**
 * Publish into `out`/v2 and record the set in its inventory.json, which the
 * app's offline pack also reads. Removes only unmodified obsolete files
 * recorded by an earlier successful build (scripts/lib/ownership.js).
 */
export function publishStudyPayloads(out, payloads) {
  const base = join(out, "v2");
  const { files, bytes } = publishOwned({
    base,
    payloads,
    safePath: (path) => STUDY_PATH.test(path),
    inventory: join(base, "inventory.json"),
    version: 2,
    label: "study",
    fail,
  });
  return { files, bytes };
}
