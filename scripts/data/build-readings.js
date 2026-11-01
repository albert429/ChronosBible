import { readFileSync } from "node:fs";
import { join } from "node:path";
import { payload, publishOwned } from "../lib/ownership.js";
import { ROOT } from "../lib/paths.js";

/** The plan index and the day files this builder owns in its folder. */
export const READINGS_PATH = /^(?:plan|[1-9]\d{0,2})\.json$/;

/**
 * Writes the plan index and one file per day into `out`; returns the summary
 * line. With an `inventory`, day files an earlier build wrote and this one no
 * longer produces are removed (scripts/lib/ownership.js).
 * @param {{ out: string, root?: string, inventory?: string }} options
 */
export function buildReadings({ out, root = ROOT, inventory }) {
  const plan = JSON.parse(readFileSync(join(root, "data/plan.json"), "utf8"));
  const payloads = [
    payload(
      "plan.json",
      JSON.stringify(
        plan.map(({ passages, ...d }) => ({
          ...d,
          passages: passages.map(({ verses, ...p }) => p),
        })),
      ),
    ),
    ...plan.map((day) => payload(`${day.day}.json`, JSON.stringify(day))),
  ];
  publishOwned({
    base: out,
    payloads,
    safePath: (path) => READINGS_PATH.test(path),
    inventory,
    label: "reading",
  });
  return `Generated ${plan.length} static daily readings.`;
}
