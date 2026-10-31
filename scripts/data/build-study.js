// Publish verse study under public/study/ (CC BY-SA / CC BY data): one
// canonical set for every book, chapter and verse (build-study-canonical.js).
import { lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildCanonicalStudy } from "./build-study-canonical.js";
import { ROOT } from "../lib/paths.js";

/** Writes the study files into `out`; returns the summary line. */
export function buildStudy({ out, root = ROOT }) {
  // The 150-day plan's per-day files are replaced by the canonical set; an
  // older build's copies would otherwise stay in public/ and ship. Their
  // builder kept no inventory, so the owned set is this fixed list of 450
  // names. Only regular files are removed; anything else stops the build.
  const retired = [];
  for (let day = 1; day <= 150; day++)
    for (const part of ["", ".tr", ".lex"]) {
      const path = join(out, `${day}${part}.json`);
      let entry;
      try {
        entry = lstatSync(path);
      } catch {
        continue;
      }
      if (!entry.isFile())
        throw new Error(
          `public/study/${day}${part}.json is not a regular file; refusing removal`,
        );
      retired.push(path);
    }
  for (const path of retired) rmSync(path);
  const canonical = buildCanonicalStudy({ out, root });
  return `Canonical study: ${JSON.stringify(canonical)}.`;
}
