import { defineConfig, loadEnv, type Plugin } from "vite";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { audioUrl } from "./src/audio/url.ts";
import { aiBuildConfig } from "./src/ai/config.ts";
import { chapterAvailability } from "./src/audio/availability.ts";
import {
  advertisedAudio,
  manifestOutputPath,
} from "./src/audio/publication.ts";
import { catalog } from "./src/bible/catalog.ts";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const optional = (path: string) => (existsSync(path) ? json(path) : undefined);

/** Never ship a manifest for audio this build does not advertise. */
function removeUnpublishedManifests(paths: string[]): Plugin {
  let outDir = "dist";
  return {
    name: "audio-unpublished-manifests",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const path of paths) rmSync(resolve(outDir, path), { force: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const { VITE_AUDIO_BASE_URL = "", VITE_AUDIO_CHAPTERS_ENABLED = "" } = env;
  if (VITE_AUDIO_BASE_URL)
    audioUrl("/audio/days/check.m4a", VITE_AUDIO_BASE_URL);
  if (!["", "true", "false"].includes(VITE_AUDIO_CHAPTERS_ENABLED))
    throw new Error('VITE_AUDIO_CHAPTERS_ENABLED must be "true" or "false".');
  const { days } = json("data/audio/catalog.json") as { days: number[] };
  const chapters: string[] =
    optional("data/audio/chapter-catalog.json")?.chapters ?? [];
  const readings: string[] =
    optional("data/audio/reading-catalog.json")?.readings ?? [];
  // A Git-only deployment remains a working text reader until its public
  // audio host is configured. Never advertise files absent from that build.
  // Hosted chapters and chronological playlists additionally need every file
  // in the verified upload inventory (src/audio/publication.ts).
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
    local: (src) => existsSync(resolve("public", "." + src)),
    inventory: optional("data/audio/publication.json"),
  });
  const unpublished = [
    ...days.filter((key) => !advertised.days.includes(key)),
    ...chapters.filter((key) => !advertised.chapters.includes(key)),
    ...readings.filter((key) => !advertised.readings.includes(key)),
  ].map(manifestOutputPath);
  // Optional AI explanations: off unless VITE_AI_PROVIDERS is set. Values are
  // inlined as constants so a disabled build drops every AI module.
  const ai = aiBuildConfig(env);
  return {
    plugins: [react(), removeUnpublishedManifests(unpublished)],
    define: {
      __AUDIO_BASE_URL__: JSON.stringify(VITE_AUDIO_BASE_URL),
      __AUDIO_DAYS__: JSON.stringify(advertised.days),
      __AUDIO_CHAPTERS__: JSON.stringify(
        chapterAvailability(catalog, advertised.chapters),
      ),
      __AUDIO_READINGS__: JSON.stringify(advertised.readings),
      __AI_ENABLED__: JSON.stringify(ai !== null),
      __AI_DAILY_CAP__: JSON.stringify(ai?.dailyCap ?? 0),
      __AI_ATTEMPT_CAP__: JSON.stringify(ai?.attemptCap ?? 0),
      __AI_CONFIG__: JSON.stringify(ai),
    },
  };
});
