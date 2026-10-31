import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  readingTranscript,
  validManifest,
} from "../../src/domain/audio/manifest.ts";
import { readBibleChapters } from "./build-bible.js";
import { ROOT } from "../lib/paths.js";
import { AUDIO_MANIFEST_PATH } from "../lib/audio-manifests.js";
import { payload, publishOwned } from "../lib/ownership.js";

/**
 * Publishes every catalogued manifest into `out`; returns the summary line.
 * Every manifest is validated before any is written. With an `inventory`,
 * manifests an earlier build published and this one no longer produces are
 * removed (unless modified), so a dropped recording cannot linger.
 * @param {{ out: string, root?: string, inventory?: string,
 *   warn?: (message: string) => void }} options
 */
export function buildAudioIndex({
  out,
  root = ROOT,
  inventory,
  warn = console.warn,
}) {
  const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
  const { days } = read("data/audio/catalog.json");
  const plan = read("data/plan.json");
  /** @type {[string, Buffer][]} */
  const payloads = [];
  const publish = (path, manifest) =>
    payloads.push(payload(path, JSON.stringify(manifest)));
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
    publish(`${day}.json`, manifest);
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
      publish(`chapters/${book}/${chapter}.json`, manifest);
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
    // Written beside the others; the build drops any it does not advertise.
    publish(`chrono/${testament}/${id}.json`, manifest);
  }
  const { unowned } = publishOwned({
    base: out,
    payloads,
    safePath: (path) => AUDIO_MANIFEST_PATH.test(path),
    inventory,
    label: "audio manifest",
    listUnowned: Boolean(inventory),
  });
  if (unowned.length)
    warn(
      `public/audio holds ${unowned.length} manifest(s) no build owns (${unowned.slice(0, 3).join(", ")}${unowned.length > 3 ? ", ..." : ""}); the build will not ship them. Remove them if they are stale.`,
    );
  return `Prepared ${days.length} audio manifests, ${chapters.length} chapter manifests and ${readings.length} reading playlists (recordings are hosted separately).`;
}
