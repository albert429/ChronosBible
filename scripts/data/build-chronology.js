/** Prepare both testaments, enforce output budgets and publish owned files. */
import { gzipSync } from "node:zlib";
import { readBibleChapters } from "./build-bible.js";
import { payload, publishOwned } from "../lib/ownership.js";
import { ROOT } from "../lib/paths.js";
import {
  TESTAMENTS,
  checkReview,
  readChronologyInputs,
} from "./chronology/source.js";
import { prepareTestament } from "./chronology/readings.js";

const CATALOG_GZIP_BUDGET = 32 * 1024;

/** Reads all inputs once and prepares both testaments (no file output). */
export function prepareChronology(root = ROOT) {
  const inputs = readChronologyInputs(root);
  const audit = checkReview(inputs.source, inputs.review);
  const chapters = new Map(
    readBibleChapters(root).map((c) => [`${c.usfm}:${c.chapter}`, c]),
  );
  const chapterOf = (usfm, chapter) => chapters.get(`${usfm}:${chapter}`);
  const testaments = Object.fromEntries(
    TESTAMENTS.map((t) => [t, prepareTestament(t, inputs, chapterOf)]),
  );
  return { inputs, audit, testaments };
}

/** The catalogs and reading definitions this builder owns in its folder. */
export const CHRONOLOGY_PATH =
  /^(?:OT|NT)(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?\.json$/;

/**
 * Writes `<out>/OT.json`, `<out>/NT.json` and `<out>/<T>/<id>.json` once both
 * testaments are valid and within budget. With an `inventory`, definitions an
 * earlier build wrote and this one no longer produces are removed; nothing
 * else in the folder is touched (scripts/lib/ownership.js).
 * @param {{ out: string, root?: string, inventory?: string }} options
 */
export function buildChronology({ out, root = ROOT, inventory }) {
  const { testaments } = prepareChronology(root);
  const summary = [];
  /** @type {[string, Buffer][]} */
  const payloads = [];
  for (const testament of TESTAMENTS) {
    const { catalog, definitions } = testaments[testament];
    const json = JSON.stringify(catalog);
    const bytes = gzipSync(json).length;
    if (bytes > CATALOG_GZIP_BUDGET)
      throw new Error(
        `${testament} chronology catalog exceeds ${CATALOG_GZIP_BUDGET} bytes gzip`,
      );
    payloads.push(payload(`${testament}.json`, json));
    for (const definition of definitions)
      payloads.push(
        payload(
          `${testament}/${definition.id}.json`,
          JSON.stringify(definition),
        ),
      );
    summary.push(
      `${testament} ${definitions.length} readings (${bytes} bytes gzip catalog)`,
    );
  }
  publishOwned({
    base: out,
    payloads,
    safePath: (path) => CHRONOLOGY_PATH.test(path),
    inventory,
    label: "chronology",
  });
  return `Generated chronology: ${summary.join("; ")}.`;
}
