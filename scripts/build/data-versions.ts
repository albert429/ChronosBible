// Content versions of the generated data folders, inlined into the app, the
// early-reading preload script and the service worker.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { Plugin } from "vite";
import { DATA_FOLDERS } from "../../src/features/offline/rules.ts";

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

/** The preload script in index.html names files as the app does. */
export function dataVersionsHtml(versions: Record<string, string>): Plugin {
  return {
    name: "data-versions-html",
    transformIndexHtml: (html) =>
      html.replace("__DATA_VERSIONS_JSON__", JSON.stringify(versions)),
  };
}
