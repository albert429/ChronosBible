import { join } from "node:path";
import { OWNERSHIP_DIR } from "../lib/ownership.js";
import { ROOT } from "../lib/paths.js";
import { buildBible } from "./build-bible.js";
import { buildAudioIndex } from "./build-audio-index.js";
import { buildChronology } from "./build-chronology.js";
import { buildReadings } from "./build-readings.js";
import { buildStudy, buildStudyLicense } from "./build-study.js";

const out = (name) => join(ROOT, "app/public", name);
// Inventories of what each builder last wrote into a shipped folder; kept
// outside app/public/ so they never ship (scripts/lib/ownership.js).
const inventory = (name) => join(ROOT, OWNERSHIP_DIR, `${name}.json`);
for (const summary of [
  buildReadings({ out: out("readings"), inventory: inventory("readings") }),
  buildBible({ out: out("bible"), inventory: inventory("bible") }),
  buildChronology({
    out: out("chronology"),
    inventory: inventory("chronology"),
  }),
  buildStudy({ out: out("study") }),
  buildStudyLicense({ out: out("licenses"), inventory: inventory("licenses") }),
  buildAudioIndex({ out: out("audio"), inventory: inventory("audio") }),
])
  console.log(summary);
