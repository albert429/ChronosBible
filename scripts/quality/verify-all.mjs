// The whole acceptance gate in one command: what CI runs, in CI's order.
//
//   npm run verify:all                 (PW_PORT=<n> moves the three browser-test servers)
//
// 1. `npm run validate` in CI's environment (audio fixtures on, a fixture
//    audio host): format, lint, types, unit tests and the build.
// 2. The Python tests.
// 3. `py_compile` over every Python file under scripts/, recursively.
// 4. The browser tests (`npm run test:e2e`: Chromium, mobile WebKit, AI build).
//
// The faster everyday gate stays `npm run validate`. The first failing step
// stops the run. Browsers need `npx playwright install chromium webkit`.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, isMain } from "../lib/paths.js";

/** The environment CI gives `npm run validate`. */
export const CI_ENVIRONMENT = {
  AUDIO_TEST_FIXTURES: "1",
  VITE_AUDIO_BASE_URL: "https://audio.example.test",
};

/** Every `.py` file under `directory` (recursively), sorted. */
export function pythonFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...pythonFiles(full));
    else if (entry.name.endsWith(".py")) found.push(full);
  }
  return found.sort();
}

/** The steps, as commands (no shell). `root` is the repository. */
export function verificationSteps(root = ROOT, environment = process.env) {
  return [
    {
      name: "validate (CI environment)",
      command: "npm",
      args: ["run", "validate"],
      env: { ...environment, ...CI_ENVIRONMENT },
    },
    {
      name: "Worker integration",
      command: "npm",
      args: ["run", "test:worker"],
      env: environment,
    },
    {
      name: "Import layers",
      command: "npm",
      args: ["run", "layers"],
      env: environment,
    },
    {
      name: "Python tests",
      command: "python3",
      args: ["-I", "scripts/quality/python-tests.py"],
      env: environment,
    },
    {
      name: "py_compile (recursive)",
      command: "python3",
      args: [
        "-m",
        "py_compile",
        ...pythonFiles(join(root, "scripts")).map((file) =>
          relative(root, file),
        ),
      ],
      env: environment,
    },
    {
      name: "browser tests",
      command: "npm",
      args: ["run", "test:e2e"],
      env: environment,
    },
  ];
}

/** Run steps in order; stop at the first failure. Returns the exit status. */
export function runSteps(
  steps,
  root = ROOT,
  run = spawnSync,
  log = console.log,
) {
  for (const step of steps) {
    log(`\n== ${step.name}`);
    const started = Date.now();
    const result = run(step.command, step.args, {
      cwd: root,
      env: step.env,
      stdio: "inherit",
    });
    const seconds = Math.round((Date.now() - started) / 1000);
    if (result.status !== 0) {
      log(`\nFAILED: ${step.name} (${seconds}s)`);
      return result.status || 1;
    }
    log(`ok: ${step.name} (${seconds}s)`);
  }
  log("\nverify:all passed");
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = runSteps(verificationSteps());
