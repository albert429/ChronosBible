import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CI_ENVIRONMENT,
  pythonFiles,
  runSteps,
  verificationSteps,
} from "../scripts/quality/verify-all.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(root + "package.json", "utf8"));
const workflow = readFileSync(root + ".github/workflows/checks.yml", "utf8");

test("verify:all runs the checks CI runs, in CI's order, and validate keeps its own gate", () => {
  assert.equal(
    pkg.scripts["verify:all"],
    "node scripts/quality/verify-all.mjs",
  );
  assert.match(
    pkg.scripts.validate,
    /format:check.*lint.*typecheck.*npm test.*npm run build/,
  );
  assert.doesNotMatch(pkg.scripts.validate, /e2e|unittest/);
  const steps = verificationSteps(root, { PATH: "/bin", PW_PORT: "4470" });
  assert.deepEqual(
    steps.map((step) => [step.command, ...step.args.slice(0, 3)].join(" ")),
    [
      "npm run validate",
      "npm run test:worker",
      "npm run layers",
      "python3 -I -m unittest",
      "python3 -m py_compile scripts/align-audio.py",
      "npm run test:e2e",
    ],
  );
  // The same commands appear in the workflow, in the same order.
  const at = (text: string) => workflow.indexOf(text);
  assert.ok(
    at("npm run validate") <
      at("python3 -I -m unittest discover -s scripts/tests"),
  );
  assert.ok(at("unittest") < at("py_compile"));
  assert.ok(at("py_compile") < at("npm run test:e2e"));
});

test("Only validate gets the CI audio environment; the browser tests keep PW_PORT", () => {
  const [validate, , , python, , browser] = verificationSteps(root, {
    PATH: "/bin",
    PW_PORT: "4470",
  });
  for (const [key, value] of Object.entries(CI_ENVIRONMENT))
    assert.equal(validate.env[key], value);
  assert.equal(python.env.AUDIO_TEST_FIXTURES, undefined);
  assert.equal(browser.env.AUDIO_TEST_FIXTURES, undefined);
  assert.equal(browser.env.PW_PORT, "4470");
  assert.match(workflow, /AUDIO_TEST_FIXTURES: "1"/);
});

test("py_compile covers every Python file under scripts/, including the package and tests", () => {
  const compile = verificationSteps(root, {})[4];
  const files = compile.args.slice(2);
  assert.deepEqual(
    files,
    pythonFiles(root + "scripts").map((file: string) =>
      file.slice(root.length),
    ),
  );
  for (const expected of [
    "scripts/data/import.py",
    "scripts/lib/chronos_tools/ownership.py",
    "scripts/tests/test_chronos_tools.py",
  ])
    assert.ok(files.includes(expected), expected);
});

test("The first failing step stops the run and sets the exit status", () => {
  const ran: string[] = [];
  const steps = [
    { name: "a", command: "a", args: [], env: {} },
    { name: "b", command: "b", args: [], env: {} },
    { name: "c", command: "c", args: [], env: {} },
  ];
  const status = runSteps(
    steps,
    root,
    ((command: string) => {
      ran.push(command);
      return { status: command === "b" ? 3 : 0 };
    }) as never,
    () => {},
  );
  assert.equal(status, 3);
  assert.deepEqual(ran, ["a", "b"]);
  assert.equal(
    runSteps([steps[0]], root, (() => ({ status: 0 })) as never, () => {}),
    0,
  );
});
