// Audio manifests are generated for every catalogued recording; a build ships
// only the ones it advertises.
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/** Never ship a manifest for audio this build does not advertise. */
export function removeUnpublishedManifests(paths: string[]): Plugin {
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
