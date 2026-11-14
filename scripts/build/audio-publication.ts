// The build's audio inputs: which daily, chapter and chronological recordings
// this build may advertise, and so the only manifests it ships.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chapterAvailability } from "../../src/features/audio/domain/availability.ts";
import {
  advertisedAudio,
  manifestOutputPath,
} from "../../src/features/audio/domain/publication.ts";
import { audioUrl } from "../../src/features/audio/domain/url.ts";
import { catalog } from "../../src/core/scripture/catalog.ts";

export interface AudioPublication {
  /** VITE_AUDIO_BASE_URL, validated ("" for none). */
  base: string;
  advertised: ReturnType<typeof advertisedAudio>;
  /** Compact per-chapter flags for __AUDIO_CHAPTERS__. */
  chapterFlags: string;
  /** Output paths (under the build's outDir) of the advertised manifests. */
  published: string[];
}

/**
 * Validate the audio settings and read the committed audio catalogs. Throws
 * on an unsafe host or an unrecognised chapter flag before anything is read.
 */
export function audioPublication(
  env: Record<string, string | undefined>,
  root = process.cwd(),
): AudioPublication {
  const { VITE_AUDIO_BASE_URL = "", VITE_AUDIO_CHAPTERS_ENABLED = "" } = env;
  if (VITE_AUDIO_BASE_URL)
    audioUrl("/audio/days/check.m4a", VITE_AUDIO_BASE_URL);
  if (!["", "true", "false"].includes(VITE_AUDIO_CHAPTERS_ENABLED))
    throw new Error('VITE_AUDIO_CHAPTERS_ENABLED must be "true" or "false".');
  const json = (path: string) =>
    JSON.parse(readFileSync(join(root, path), "utf8"));
  const optional = (path: string) =>
    existsSync(join(root, path)) ? json(path) : undefined;
  const { days } = json("data/audio/catalog.json") as { days: number[] };
  const chapters: string[] =
    optional("data/audio/chapter-catalog.json")?.chapters ?? [];
  const readings: string[] =
    optional("data/audio/reading-catalog.json")?.readings ?? [];
  // A Git-only deployment remains a working text reader until its public
  // audio host is configured. Never advertise files absent from that build.
  // Hosted chapters and chronological playlists additionally need every file
  // in the verified upload inventory (src/features/audio/domain/publication.ts).
  const advertised = advertisedAudio({
    base: VITE_AUDIO_BASE_URL,
    chaptersEnabled: VITE_AUDIO_CHAPTERS_ENABLED === "true",
    days: days.map((key) => ({
      key,
      manifest: json(`data/audio/manifests/${key}.json`),
    })),
    chapters: chapters.map((key) => {
      const [, book, chapter] = key.split(":");
      return {
        key,
        manifest: json(`data/audio/chapters/${book}/${chapter}.json`),
      };
    }),
    readings: readings.map((key) => {
      const [, testament, id] = key.split(":");
      return {
        key,
        manifest: json(`data/audio/readings/${testament}/${id}.json`),
      };
    }),
    local: (src) => existsSync(resolve(root, "public", "." + src)),
    inventory: optional("data/audio/publication.json"),
  });
  const published = [
    ...advertised.days,
    ...advertised.chapters,
    ...advertised.readings,
  ].map(manifestOutputPath);
  return {
    base: VITE_AUDIO_BASE_URL,
    advertised,
    chapterFlags: chapterAvailability(catalog, advertised.chapters),
    published,
  };
}
