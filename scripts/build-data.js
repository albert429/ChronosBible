import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBible } from "./build-bible.js";
import { buildAudioIndex } from "./build-audio-index.js";
import { buildChronology } from "./build-chronology.js";
import { buildReadings } from "./build-readings.js";
import { buildStudy } from "./build-study.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const out = (name) => join(ROOT, "public", name);
for (const summary of [
  buildReadings({ out: out("readings") }),
  buildBible({ out: out("bible") }),
  buildChronology({ out: out("chronology") }),
  buildStudy({ out: out("study") }),
  buildAudioIndex({ out: out("audio") }),
])
  console.log(summary);
