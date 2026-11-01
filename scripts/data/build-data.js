import { join } from "node:path";
import { OWNERSHIP_DIR } from "../lib/ownership.js";
import { ROOT } from "../lib/paths.js";
import { buildBible } from "./build-bible.js";
import { buildAudioIndex } from "./build-audio-index.js";
import { buildChronology } from "./build-chronology.js";
import { buildReadings } from "./build-readings.js";
import { buildStudy } from "./build-study.js";

const out = (name) => join(ROOT, "public", name);
// Inventories of what each builder last wrote into a shipped folder; kept
// outside public/ so they never ship (scripts/lib/ownership.js).
const inventory = (name) => join(ROOT, OWNERSHIP_DIR, `${name}.json`);
for (const summary of [
  buildReadings({ out: out("readings"), inventory: inventory("readings") }),
  buildBible({ out: out("bible"), inventory: inventory("bible") }),
  buildChronology({
    out: out("chronology"),
    inventory: inventory("chronology"),
  }),
  buildStudy({ out: out("study") }),
  buildAudioIndex({ out: out("audio"), inventory: inventory("audio") }),
])
  console.log(summary);
