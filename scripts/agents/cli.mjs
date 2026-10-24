#!/usr/bin/env node
// Shared-agent workflow CLI: `npm run agents -- <command>`. See .agents/README.md.
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { doctor } from "./doctor.mjs";
import { AgentsError } from "./git.mjs";
import { resolveContext } from "./state.mjs";
import { validateBrief, validateProfile, validateReport } from "./validate.mjs";
import { cleanup, create, handoff, init, status } from "./worktrees.mjs";

const USAGE = `usage: npm run agents -- <command>
  doctor [--json]                      check tools, state, ports (read-only)
  init                                 create agents/integration from origin/dev
  status [<id>] [--json]               show tasks, branches, ports (read-only)
  create <id> --role <id> --brief <file|json>
  handoff <id> --report <file|json>
  cleanup <id> [--apply] [--discard-generated]   dry run unless --apply
  sync                                 regenerate adapter files
  check                                validate catalog, roles, templates`;

const COMMANDS = {
  doctor: { options: { json: { type: "boolean" } } },
  init: {},
  status: { options: { json: { type: "boolean" } }, optionalId: true },
  create: {
    id: true,
    options: { role: { type: "string" }, brief: { type: "string" } },
    required: ["role", "brief"],
  },
  handoff: {
    id: true,
    options: { report: { type: "string" } },
    required: ["report"],
  },
  cleanup: {
    id: true,
    options: {
      apply: { type: "boolean" },
      "discard-generated": { type: "boolean" },
    },
  },
  sync: {},
  check: {},
};

class UsageError extends Error {}

/** A JSON argument: inline object text or a file path (relative to INIT_CWD). */
function readJsonArg(value, label) {
  const text = value.trim().startsWith("{")
    ? value
    : (() => {
        try {
          return readFileSync(
            resolve(process.env.INIT_CWD ?? process.cwd(), value),
            "utf8",
          );
        } catch (error) {
          throw new AgentsError(
            `${label}: cannot read ${value} (${error.code})`,
          );
        }
      })();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AgentsError(`${label}: invalid JSON (${error.message})`);
  }
}

function parse(argv) {
  const [command, ...rest] = argv;
  const spec = COMMANDS[command];
  if (!spec)
    throw new UsageError(
      command ? `unknown command ${command}` : "missing command",
    );
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: spec.options ?? {},
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new UsageError(error.message);
  }
  const { positionals } = parsed;
  const values = /** @type {Record<string, any>} */ (parsed.values);
  const maxPositionals = spec.id || spec.optionalId ? 1 : 0;
  if (positionals.length > maxPositionals)
    throw new UsageError(`unexpected argument ${positionals[maxPositionals]}`);
  if (spec.id && !positionals[0])
    throw new UsageError(`${command} needs a task id`);
  for (const name of spec.required ?? []) {
    if (!values[name]) throw new UsageError(`${command} needs --${name}`);
  }
  return { command, id: positionals[0], values };
}

async function loadAdapters() {
  try {
    // Built at runtime so the lifecycle commands work without this module.
    return await import(new URL("./adapters.mjs", import.meta.url).href);
  } catch (error) {
    if (
      error.code === "ERR_MODULE_NOT_FOUND" &&
      String(error.message).includes("adapters.mjs")
    ) {
      throw new AgentsError(
        "adapters module (scripts/agents/adapters.mjs) is not available",
      );
    }
    throw error;
  }
}

const count = (v) => (Array.isArray(v) ? v.length : v);
const summary = (r) =>
  `roles ${count(r?.roles)}, skills ${count(r?.skills)}, files ${count(r?.files)}`;

/** Templates must satisfy the same validators the lifecycle commands use. */
function checkTemplates(root) {
  const dir = join(root, ".agents", "templates");
  const read = (name) => JSON.parse(readFileSync(join(dir, name), "utf8"));
  const errors = [
    ...validateBrief(read("assignment.example.json")).errors,
    ...validateReport(read("handoff.example.json")).errors,
    ...validateProfile(
      read("local-profile.example.json"),
      "/nonexistent-checkout",
    ).errors,
  ];
  if (errors.length)
    throw new AgentsError(`templates invalid:\n- ${errors.join("\n- ")}`);
}

export async function main(
  argv,
  out = (line) => process.stdout.write(`${line}\n`),
) {
  const { command, id, values } = parse(argv);
  if (command === "doctor")
    return doctor(process.cwd(), out, { json: values.json });
  const ctx = resolveContext(process.cwd());
  switch (command) {
    case "init":
      await init(ctx, out);
      return 0;
    case "status":
      status(ctx, { json: values.json, id }, out);
      return 0;
    case "create":
      await create(
        ctx,
        id,
        { role: values.role, brief: readJsonArg(values.brief, "brief") },
        out,
      );
      return 0;
    case "handoff":
      await handoff(ctx, id, readJsonArg(values.report, "report"), out);
      return 0;
    case "cleanup":
      return cleanup(
        ctx,
        id,
        { apply: values.apply, discardGenerated: values["discard-generated"] },
        out,
      );
    case "sync": {
      const { syncAdapters } = await loadAdapters();
      out(`sync: ${summary(await syncAdapters(ctx.sourceRoot))}`);
      return 0;
    }
    case "check": {
      checkTemplates(ctx.sourceRoot);
      const { checkConventions } = await loadAdapters();
      out(
        `check: templates ok, ${summary(await checkConventions(ctx.sourceRoot))}`,
      );
      return 0;
    }
  }
  return 2;
}

const isMain =
  process.argv[1] &&
  realpathSync(process.argv[1]) ===
    realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  main(argv).then(
    (code) => (process.exitCode = code),
    (error) => {
      if (error instanceof UsageError) {
        process.stderr.write(`agents: ${error.message}\n${USAGE}\n`);
        process.exitCode = 2;
      } else if (error instanceof AgentsError) {
        process.stderr.write(`agents ${argv[0]}: ${error.message}\n`);
        process.exitCode = 1;
      } else {
        process.stderr.write(
          `agents ${argv[0]}: unexpected error: ${error.stack ?? error}\n`,
        );
        process.exitCode = 1;
      }
    },
  );
}
