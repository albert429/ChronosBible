import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { isMain } from "../lib/paths.js";
export async function bundle(
  entry = "worker/index.ts",
  outfile = "artifacts/worker/index.mjs",
) {
  mkdirSync("artifacts/worker", { recursive: true });
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
  });
  return outfile;
}
if (isMain(import.meta.url)) await bundle();
