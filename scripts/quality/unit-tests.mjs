// Discover maintained unit and integration suites without shell glob expansion.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, isMain } from "../lib/paths.js";

export function unitTests(root = ROOT) {
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(join(root, directory), {
      withFileTypes: true,
    })) {
      const name = join(directory, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.name.endsWith(".test.ts")) found.push(name);
    }
  };
  for (const directory of ["src", "scripts", "worker", "tests"])
    visit(directory);
  if (!found.length) throw new Error("No unit tests discovered");
  return found.sort();
}
if (isMain(import.meta.url)) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--test",
      ...process.argv.slice(2),
      ...unitTests(),
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
}
