// Split data/study/* into per-day static files under public/study/ (CC BY-SA / CC BY data).
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { verseId } from "../src/bible/verse.ts";
import { usfmByName } from "./lib/books.js";
import { buildCanonicalStudy } from "./build-study-canonical.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

// Tuned so the busiest day fits BUDGETS (400-character definitions did not).
export const DEF_CHARS = 160;
export const BUDGETS = { core: 30000, lex: 35000, tr: 30000 };

const fail = (message) => {
  throw new Error("build-study: " + message);
};

const shortLex = ({ l, g, d }) => ({
  l,
  g,
  d:
    d.length <= DEF_CHARS
      ? d
      : d.slice(0, DEF_CHARS).replace(/\s+\S*$/, "") + "…",
});

/** Writes the per-day study files into `out`; returns the summary line. */
export function buildStudy({ out, root = ROOT }) {
  const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
  const plan = read("data/plan.json");
  const greek = read("data/study/greek.json");
  const lexicon = read("data/study/lexicon.json");
  const nav = read("data/study/nav.json");
  const kjv = read("data/study/kjv.json");
  mkdirSync(out, { recursive: true });
  const usfmFor = usfmByName(root);

  const write = (name, data) => {
    const body = JSON.stringify(data);
    writeFileSync(join(out, name), body);
    return gzipSync(body).length;
  };

  const max = { core: 0, lex: 0, tr: 0 };
  const firstEntry = new Map();
  for (const day of plan) {
    const p = day.passages.map((passage) => {
      const code = usfmFor.get(passage.book);
      if (!code) fail("unknown book " + passage.book);
      return code;
    });
    const verses = {};
    const lex = {};
    // Other translations load only when a reader opens that section.
    const tr = {};
    day.passages.forEach((passage, index) => {
      for (const verse of passage.verses) {
        const id = verseId(p[index], passage.chapter, verse.number);
        const g = greek[id] || [];
        const count = verse.text.split(" ").length;
        for (const [, , strong, , , a0, a1] of g) {
          if (a0 !== null && !(a0 <= a1 && a1 < count))
            fail(`alignment out of range at ${id}`);
          if (lexicon[strong]) lex[strong] = shortLex(lexicon[strong]);
        }
        const entry = { g };
        tr[id] = {};
        if (nav[id] !== undefined) tr[id].n = nav[id];
        if (kjv[id] !== undefined) tr[id].e = kjv[id];
        const previous = firstEntry.get(id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(entry))
          fail("repeated verse differs: " + id);
        firstEntry.set(id, entry);
        verses[id] = entry;
      }
    });
    const sizes = {
      core: write(`${day.day}.json`, { v: 1, day: day.day, p, verses }),
      lex: write(`${day.day}.lex.json`, { v: 1, day: day.day, lex }),
      tr: write(`${day.day}.tr.json`, { v: 1, day: day.day, verses: tr }),
    };
    for (const [kind, size] of Object.entries(sizes)) {
      if (size > BUDGETS[kind])
        fail(
          `day ${day.day} ${kind} is ${size} B gzipped (budget ${BUDGETS[kind]})`,
        );
      max[kind] = Math.max(max[kind], size);
    }
  }
  const canonical = buildCanonicalStudy({ out, root });
  return `Canonical study: ${JSON.stringify(canonical)}. Generated ${plan.length} study days (max gzip: core ${max.core} B, lex ${max.lex} B, translations ${max.tr} B).`;
}
