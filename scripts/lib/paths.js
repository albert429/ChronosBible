// The one repository-root resolution for the JavaScript tools. Scripts live in
// scripts/<workflow>/, so their own location never decides where the
// repository is; they import ROOT (or pass an explicit root in tests).
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute, symlink-resolved repository root (two levels above this file). */
export const ROOT = realpathSync(
  fileURLToPath(new URL("../../", import.meta.url)),
);

/** A path inside the repository. */
export const repoPath = (...parts) => join(ROOT, ...parts);

/** True when this module is the script Node was started with. */
export function isMain(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
