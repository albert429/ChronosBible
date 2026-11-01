// Audio manifests are generated for every catalogued recording; a build ships
// only the ones it advertises.
import { lstatSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { AUDIO_MANIFEST_PATH } from "../lib/audio-manifests.js";

/**
 * Never ship a manifest for audio this build does not advertise. `published`
 * lists the advertised manifests' output paths (`audio/...`). Every other
 * file under audio/ with a manifest name is removed from the build output,
 * catalogued or not, so a stale copy left in public/audio cannot ship. Other
 * files there (local recordings in a development build) are left alone.
 */
export function removeUnpublishedManifests(published: string[]): Plugin {
  let outDir = "dist";
  const keep = new Set(published);
  return {
    name: "audio-unpublished-manifests",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const path of manifestFiles(join(outDir, "audio")))
        if (!keep.has(`audio/${path}`))
          rmSync(join(outDir, "audio", path), { force: true });
    },
  };
}

/** Regular files below `base` named like a manifest, as relative POSIX paths. */
function manifestFiles(base: string, prefix = ""): string[] {
  let entries;
  try {
    if (lstatSync(base).isSymbolicLink()) return [];
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return manifestFiles(join(base, entry.name), path);
    return entry.isFile() && AUDIO_MANIFEST_PATH.test(path) ? [path] : [];
  });
}
