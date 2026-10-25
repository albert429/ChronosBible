import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { readingTranscript, validManifest } from "../src/audio/manifest.ts";
import { readBibleChapters } from "./build-bible.js";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Publishes every catalogued manifest into `out`; returns the summary line. */
export function buildAudioIndex({ out, root = ROOT }) {
  const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
  const { days } = read("data/audio/catalog.json");
  const plan = read("data/plan.json");
  mkdirSync(out, { recursive: true });
  for (const day of days) {
    const reading = plan.find((entry) => entry.day === day);
    if (!reading) throw new Error(`Invalid audio day ${day}`);
    const manifest = read(`data/audio/manifests/${day}.json`);
    if (!validManifest(manifest, String(day)))
      throw new Error(`Audio manifest for day ${day} is malformed.`);
    const hash = createHash("sha256")
      .update(readingTranscript(reading))
      .digest("hex");
    if (manifest.readingHash !== hash)
      throw new Error(
        `Audio for day ${day} is stale. Rebuild it from the updated Scripture.`,
      );
    writeFileSync(join(out, `${day}.json`), JSON.stringify(manifest));
  }
  const chapterCatalog = join(root, "data/audio/chapter-catalog.json");
  const chapters = existsSync(chapterCatalog)
    ? read("data/audio/chapter-catalog.json").chapters
    : [];
  if (chapters.length) {
    const readings = new Map(
      readBibleChapters(root).map((reading) => [
        `bible:${reading.usfm}:${reading.chapter}`,
        reading,
      ]),
    );
    for (const identity of chapters) {
      const reading = readings.get(identity);
      if (!reading) throw new Error(`Invalid audio chapter ${identity}`);
      const [, book, chapter] = identity.split(":");
      const manifest = read(`data/audio/chapters/${book}/${chapter}.json`);
      if (!validManifest(manifest, identity))
        throw new Error(`Audio manifest for chapter ${identity} is malformed.`);
      const hash = createHash("sha256")
        .update(readingTranscript(reading))
        .digest("hex");
      if (manifest.readingHash !== hash)
        throw new Error(
          `Audio for chapter ${identity} is stale. Rebuild it from the updated Scripture.`,
        );
      const directory = join(out, "chapters", book);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, `${chapter}.json`),
        JSON.stringify(manifest),
      );
    }
  }
  const readingCatalog = join(root, "data/audio/reading-catalog.json");
  const readings = existsSync(readingCatalog)
    ? read("data/audio/reading-catalog.json").readings
    : [];
  for (const identity of readings) {
    const [, testament, id] = identity.split(":");
    const manifest = read(`data/audio/readings/${testament}/${id}.json`);
    if (!validManifest(manifest, identity))
      throw new Error(`Audio playlist for ${identity} is malformed.`);
    // Written beside the others; vite.config.ts drops any it does not advertise.
    const directory = join(out, "chrono", testament);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${id}.json`), JSON.stringify(manifest));
  }
  return `Prepared ${days.length} audio manifests, ${chapters.length} chapter manifests and ${readings.length} reading playlists (recordings are hosted separately).`;
}
