import { build, defineConfig, loadEnv, type Plugin } from "vite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { audioUrl } from "./src/audio/url.ts";
import { aiBuildConfig } from "./src/ai/config.ts";
import { chapterAvailability } from "./src/audio/availability.ts";
import {
  advertisedAudio,
  manifestOutputPath,
} from "./src/audio/publication.ts";
import { catalog } from "./src/bible/catalog.ts";
import { DATA_FOLDERS } from "./src/pwa/rules.ts";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const optional = (path: string) => (existsSync(path) ? json(path) : undefined);

/**
 * A short content hash of each generated data folder under public/: the
 * client names files with it, so hosting can cache them for good. A missing
 * folder has no version and its files are fetched by their plain address.
 */
export function dataVersions(root = "public"): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const folder of DATA_FOLDERS) {
    const base = join(root, folder);
    if (!existsSync(base)) continue;
    const files = (
      readdirSync(base, { recursive: true, withFileTypes: true }) as {
        isFile(): boolean;
        name: string;
        parentPath: string;
      }[]
    )
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .sort();
    if (!files.length) continue;
    const hash = createHash("sha256");
    for (const file of files)
      hash.update(relative(base, file)).update("\0").update(readFileSync(file));
    versions[folder] = hash.digest("hex").slice(0, 10);
  }
  return versions;
}

/**
 * Build /sw.js once the app's files are known: a separate classic script
 * (src/pwa/sw.ts), so it never imports a chunk the page shares. It caches
 * the page, every hashed file, the manifest and its icons.
 */
function serviceWorker(versions: Record<string, string>): Plugin {
  let outDir = "dist";
  let root = process.cwd();
  return {
    name: "service-worker",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle(_options, bundle) {
      const icons = existsSync(resolve(root, "public/icons"))
        ? readdirSync(resolve(root, "public/icons")).map((f) => `/icons/${f}`)
        : [];
      const files = [
        "/",
        "/manifest.json",
        ...icons,
        ...Object.keys(bundle)
          .filter((file) => file.startsWith("assets/"))
          .map((file) => `/${file}`),
      ].sort();
      // The page, manifest and icons are not fingerprinted: their bytes mark
      // the build too, so changing only them still offers an update.
      const page = bundle["index.html"];
      const hash = createHash("sha256")
        .update(JSON.stringify([files, versions]))
        .update(page?.type === "asset" ? page.source : "");
      for (const file of ["/manifest.json", ...icons])
        if (existsSync(resolve(root, `public${file}`)))
          hash.update(readFileSync(resolve(root, `public${file}`)));
      const build_ = hash.digest("hex").slice(0, 10);
      await build({
        configFile: false,
        root,
        logLevel: "warn",
        publicDir: false,
        define: {
          __SW_SHELL__: JSON.stringify(files),
          __SW_BUILD__: JSON.stringify(build_),
          __DATA_VERSIONS__: JSON.stringify(versions),
        },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          lib: {
            entry: resolve(root, "src/pwa/sw.ts"),
            formats: ["iife"],
            name: "sw",
            fileName: () => "sw.js",
          },
        },
      });
    },
  };
}

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

export default defineConfig(({ command, mode }) => {
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
  const versions = dataVersions();
  return {
    plugins: [
      react(),
      removeUnpublishedManifests(unpublished),
      serviceWorker(versions),
      {
        // The preload script in index.html names files as the app does.
        name: "data-versions-html",
        transformIndexHtml: (html) =>
          html.replace("__DATA_VERSIONS_JSON__", JSON.stringify(versions)),
      },
    ],
    define: {
      __AUDIO_BASE_URL__: JSON.stringify(VITE_AUDIO_BASE_URL),
      __AUDIO_DAYS__: JSON.stringify(advertised.days),
      __AUDIO_CHAPTERS__: JSON.stringify(
        chapterAvailability(catalog, advertised.chapters),
      ),
      __AUDIO_READINGS__: JSON.stringify(advertised.readings),
      __DATA_VERSIONS__: JSON.stringify(versions),
      // Registered from production builds only (src/pwa/register.ts).
      __SERVICE_WORKER__: JSON.stringify(command === "build"),
      __AI_ENABLED__: JSON.stringify(ai !== null),
      __AI_DAILY_CAP__: JSON.stringify(ai?.dailyCap ?? 0),
      __AI_ATTEMPT_CAP__: JSON.stringify(ai?.attemptCap ?? 0),
      __AI_CONFIG__: JSON.stringify(ai),
    },
  };
});
