// /sw.js: an independent classic build, made after the app's files are known.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { build, type Plugin } from "vite";

/**
 * Build /sw.js once the app's files are known: a separate classic script
 * (src/features/offline/sw.ts), so it never imports a chunk the page shares. It caches
 * the page, every hashed file, the manifest and its icons. It writes only
 * sw.js into the app's output: never empties it or copies public/ again.
 */
export function serviceWorker(versions: Record<string, string>): Plugin {
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
      await build(
        serviceWorkerConfig({ root, outDir, files, build: build_, versions }),
      );
    },
  };
}

/** The worker's own Vite configuration: no config file, plugins or public/. */
export function serviceWorkerConfig({
  root,
  outDir,
  files,
  build: build_,
  versions,
}: {
  root: string;
  outDir: string;
  files: string[];
  build: string;
  versions: Record<string, string>;
}) {
  return {
    configFile: false as const,
    root,
    logLevel: "warn" as const,
    publicDir: false as const,
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
        entry: resolve(root, "src/features/offline/sw.ts"),
        formats: ["iife" as const],
        name: "sw",
        fileName: () => "sw.js",
      },
    },
  };
}
