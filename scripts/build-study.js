// Publish verse study under public/study/ (CC BY-SA / CC BY data): one
// canonical set for every book, chapter and verse (build-study-canonical.js).
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCanonicalStudy } from "./build-study-canonical.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Writes the study files into `out`; returns the summary line. */
export function buildStudy({ out, root = ROOT }) {
  // The 150-day plan's per-day files are replaced by the canonical set; an
  // older build's copies would otherwise stay in public/ and ship.
  for (let day = 1; day <= 150; day++)
    for (const part of ["", ".tr", ".lex"])
      rmSync(join(out, `${day}${part}.json`), { force: true });
  const canonical = buildCanonicalStudy({ out, root });
  return `Canonical study: ${JSON.stringify(canonical)}.`;
}
