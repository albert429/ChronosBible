import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { checkConventions, syncAdapters } from "../scripts/agents/adapters.mjs";

const repoRoot = resolve(import.meta.dirname, "..");

type Role = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  recommendedPaths: string[];
  skills: string[];
};

const SKILL_A = "bible150-alpha-skill";
const SKILL_B = "bible150-beta-skill";

function write(root: string, rel: string, text: string) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function read(root: string, rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function role(id: string, skills: string[]): Role {
  return {
    id,
    name: `bible150-${id}`,
    description: `The ${id} role: tidy "quoted" work`,
    instructions: `.agents/roles/${id}.md`,
    recommendedPaths: ["src/", "docs/audio.md"],
    skills,
  };
}

function skillText(name: string, extra = "") {
  return `---\nname: ${name}\ndescription: Does ${name} work when asked\n---\n\n# ${name}\n\nSee [the guide](references/guide.md).${extra}\n`;
}

/** A complete valid tree in a temporary directory. */
function fixture(
  roles: Role[] = [role("alpha", [SKILL_A]), role("beta", [SKILL_A, SKILL_B])],
) {
  const root = mkdtempSync(join(tmpdir(), "agents-adapters-"));
  write(
    root,
    ".agents/catalog.json",
    JSON.stringify({ version: 1, roles }, null, 2),
  );
  for (const r of roles) {
    write(
      root,
      r.instructions,
      `# ${r.name}\n\nOwn ${r.id} things. Use "quotes" and a \\ backslash.\n`,
    );
  }
  for (const name of [SKILL_A, SKILL_B]) {
    write(root, `.agents/skills/${name}/SKILL.md`, skillText(name));
    write(
      root,
      `.agents/skills/${name}/references/guide.md`,
      `# Guide for ${name}\n`,
    );
  }
  write(
    root,
    ".agents/templates/assignment.example.json",
    JSON.stringify({
      goal: "Do a thing",
      writablePaths: ["src/plan/"],
      dependencies: [],
      acceptanceChecks: ["npm test"],
    }),
  );
  write(
    root,
    ".agents/templates/handoff.example.json",
    JSON.stringify({
      tests: [{ command: "npm test", result: "passed" }],
      findings: [],
      remainingWork: [],
      artifacts: [".agents/artifacts/x/shot.png"],
    }),
  );
  write(
    root,
    ".agents/templates/local-profile.example.json",
    JSON.stringify({
      maxImplementationAgents: 3,
      playwrightPortBase: 4400,
      modelPreferences: { coordinator: "Opus" },
      mediaRoot: "/abs/media",
    }),
  );
  write(
    root,
    ".agents/README.md",
    "# Workflow\n\nSee [brief](templates/assignment.example.json).\n",
  );
  write(
    root,
    "AGENTS.md",
    `# Repository Guidelines\n\n${"word ".repeat(350)}\n\nSee [workflow](.agents/README.md).\n`,
  );
  write(root, "CLAUDE.md", "@AGENTS.md\n");
  return root;
}

async function withFixture(
  run: (root: string) => Promise<void>,
  roles?: Role[],
) {
  const root = fixture(roles);
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const snapshot = (root: string, dirs: string[]) =>
  dirs
    .flatMap((dir) =>
      existsSync(join(root, dir))
        ? readdirSync(join(root, dir), { recursive: true }).map(
            (f) => `${dir}/${f}`,
          )
        : [],
    )
    .sort();

test("sync generates Claude agents, Claude skill copies and Codex agents", async () => {
  await withFixture(async (root) => {
    const result = await syncAdapters(root);
    assert.equal(result.roles, 2);
    assert.equal(result.skills, 2);
    assert.equal(result.files, 2 * 2 + 4);

    const claude = read(root, ".claude/agents/bible150-alpha.md");
    assert.match(
      claude,
      /^---\nname: bible150-alpha\ndescription: "The alpha role: tidy \\"quoted\\" work"\n---\n/,
    );
    assert.doesNotMatch(
      claude.split("\n---\n")[0],
      /model|isolation|permissionMode|hooks/,
    );
    assert.match(
      claude,
      /<!-- generated: scripts\/agents\/adapters\.mjs \| source: \.agents\/roles\/alpha\.md/,
    );
    assert.match(claude, /Own alpha things\./);
    assert.match(claude, /assigned worktree/);
    assert.match(
      claude,
      /Edit only the files and directories your assignment lists/,
    );

    const toml = read(root, ".codex/agents/bible150-beta.toml");
    assert.match(toml, /^# generated: scripts\/agents\/adapters\.mjs/);
    assert.match(toml, /^name = "bible150-beta"$/m);
    assert.match(
      toml,
      /^description = "The beta role: tidy \\"quoted\\" work"$/m,
    );
    assert.match(toml, /^developer_instructions = """\n# bible150-beta\n/m);
    assert.match(toml, /a \\\\ backslash/);
    assert.doesNotMatch(toml, /^model\s*=/m);

    const skill = read(root, `.claude/skills/${SKILL_A}/SKILL.md`);
    assert.match(
      skill,
      /^---\nname: bible150-alpha-skill\ndescription: .*\n---\n\n<!-- generated: .*files: SKILL\.md references\/guide\.md/,
    );
    assert.equal(
      read(root, `.claude/skills/${SKILL_A}/references/guide.md`),
      read(root, `.agents/skills/${SKILL_A}/references/guide.md`),
    );
  });
});

test("sync is idempotent and check passes afterwards", async () => {
  await withFixture(async (root) => {
    await syncAdapters(root);
    const before = snapshot(root, [".claude", ".codex"]);
    const again = await syncAdapters(root);
    assert.deepEqual(again.changed, []);
    assert.deepEqual(snapshot(root, [".claude", ".codex"]), before);
    assert.deepEqual(await checkConventions(root), {
      roles: 2,
      skills: 2,
      files: 8,
    });
  });
});

test("the repository's own adapters are current", async () => {
  const result = await checkConventions(repoRoot);
  assert.equal(result.roles, 9);
  assert.equal(result.skills, 6);
});

test("check reports missing generated files and changed canonical sources", async () => {
  await withFixture(async (root) => {
    await assert.rejects(
      () => checkConventions(root),
      /bible150-alpha\.md: missing generated file/,
    );
    await syncAdapters(root);
    write(root, ".agents/roles/alpha.md", "# bible150-alpha\n\nChanged.\n");
    await assert.rejects(
      () => checkConventions(root),
      /bible150-alpha\.md: differs from the canonical source/,
    );
    await syncAdapters(root);
    assert.match(read(root, ".claude/agents/bible150-alpha.md"), /Changed\./);
    await checkConventions(root);

    write(root, `.agents/skills/${SKILL_A}/references/guide.md`, "# New\n");
    await assert.rejects(
      () => checkConventions(root),
      /references\/guide\.md: differs/,
    );
    write(root, `.claude/skills/${SKILL_A}/SKILL.md`, "hand edited\n");
    await assert.rejects(
      () => syncAdapters(root),
      /not a generated copy|not a generated file/,
    );
  });
});

test("check flags hand-edited and extra generated outputs", async () => {
  await withFixture(async (root) => {
    await syncAdapters(root);
    const file = ".codex/agents/bible150-beta.toml";
    write(root, file, read(root, file) + 'model = "x"\n');
    await assert.rejects(
      () => checkConventions(root),
      /bible150-beta\.toml: differs/,
    );
    await syncAdapters(root);
    write(root, `.claude/skills/${SKILL_A}/notes.md`, "mine\n");
    await assert.rejects(
      () => checkConventions(root),
      /notes\.md is not a generated resource/,
    );
    await assert.rejects(
      () => syncAdapters(root),
      /Refusing to overwrite[\s\S]*notes\.md/,
    );
    assert.equal(read(root, `.claude/skills/${SKILL_A}/notes.md`), "mine\n");
  });
});

test("sync refuses foreign files, even with the bible150 prefix, and writes nothing", async () => {
  await withFixture(async (root) => {
    write(root, ".claude/agents/bible150-beta.md", "my own agent\n");
    write(root, ".claude/agents/promo-video.md", "keep me\n");
    write(root, ".codex/agents/promo-video.toml", 'name = "promo-video"\n');
    write(root, ".codex/config.toml", "# user config\n");
    await assert.rejects(
      () => syncAdapters(root),
      /bible150-beta\.md exists but is not a generated file/,
    );
    assert.equal(
      read(root, ".claude/agents/bible150-beta.md"),
      "my own agent\n",
    );
    assert.equal(
      existsSync(join(root, ".claude/agents/bible150-alpha.md")),
      false,
    );
    assert.equal(existsSync(join(root, ".claude/skills")), false);
    assert.equal(read(root, ".claude/agents/promo-video.md"), "keep me\n");
    assert.equal(read(root, ".codex/config.toml"), "# user config\n");
  });
});

test("sync refuses a foreign skill directory but overwrites a marked one", async () => {
  await withFixture(async (root) => {
    write(
      root,
      `.claude/skills/${SKILL_A}/SKILL.md`,
      "---\nname: x\ndescription: y\n---\n",
    );
    await assert.rejects(() => syncAdapters(root), /not a generated copy/);
    rmSync(join(root, ".claude"), { recursive: true });
    await syncAdapters(root);
    write(
      root,
      ".claude/agents/bible150-alpha.md",
      read(root, ".claude/agents/bible150-alpha.md").replace(
        "Own alpha",
        "Edited alpha",
      ),
    );
    const result = await syncAdapters(root);
    assert.deepEqual(result.changed, [".claude/agents/bible150-alpha.md"]);
    assert.match(read(root, ".claude/agents/bible150-alpha.md"), /Own alpha/);
  });
});

test("removed roles and resources delete only generated outputs", async () => {
  await withFixture(async (root) => {
    await syncAdapters(root);
    write(root, ".claude/agents/bible150-legacy.md", "foreign legacy agent\n");
    write(root, ".claude/agents/other.md", "other\n");
    write(
      root,
      ".agents/catalog.json",
      JSON.stringify({
        version: 1,
        roles: [role("alpha", [SKILL_A, SKILL_B])],
      }),
    );
    rmSync(join(root, ".agents/roles/beta.md"));
    rmSync(join(root, `.agents/skills/${SKILL_A}/references`), {
      recursive: true,
    });
    write(
      root,
      `.agents/skills/${SKILL_A}/SKILL.md`,
      skillText(SKILL_A).replace(/\n\nSee .*\./, ""),
    );
    const result = await syncAdapters(root);
    assert.ok(result.changed.includes(".claude/agents/bible150-beta.md"));
    assert.equal(
      existsSync(join(root, ".claude/agents/bible150-beta.md")),
      false,
    );
    assert.equal(
      existsSync(join(root, ".codex/agents/bible150-beta.toml")),
      false,
    );
    assert.equal(
      existsSync(join(root, `.claude/skills/${SKILL_A}/references`)),
      false,
    );
    assert.equal(
      read(root, ".claude/agents/bible150-legacy.md"),
      "foreign legacy agent\n",
    );
    assert.equal(read(root, ".claude/agents/other.md"), "other\n");
    await checkConventions(root);
  });
});

test("a removed skill's generated directory is deleted but foreign files stay", async () => {
  await withFixture(async (root) => {
    await syncAdapters(root);
    write(
      root,
      ".agents/catalog.json",
      JSON.stringify({ version: 1, roles: [role("alpha", [SKILL_A])] }),
    );
    rmSync(join(root, `.agents/skills/${SKILL_B}`), { recursive: true });
    await assert.rejects(
      () => checkConventions(root),
      /bible150-beta-skill: generated skill with no canonical source|bible150-beta/,
    );
    await syncAdapters(root);
    assert.equal(existsSync(join(root, `.claude/skills/${SKILL_B}`)), false);
  });
});

test("invalid catalog metadata is reported with every problem", async () => {
  const bad = [
    { ...role("alpha", [SKILL_A]), name: "other-name" },
    { ...role("beta", [SKILL_A]), instructions: "../outside.md" },
    { ...role("gamma", [SKILL_A]), recommendedPaths: ["../etc", "/abs"] },
    { ...role("Delta", [SKILL_A]) },
    { ...role("eps", ["missing-skill"]) },
    { ...role("zeta", [SKILL_A]), description: "two\nlines" },
  ];
  await withFixture(async (root) => {
    const message = await syncAdapters(root).then(
      () => "",
      (error: Error) => error.message,
    );
    assert.match(message, /name must be "bible150-alpha"/);
    assert.match(message, /instructions must be "\.agents\/roles\/beta\.md"/);
    assert.match(message, /recommendedPaths must be/);
    assert.match(message, /id must be lowercase/);
    assert.match(message, /skills must be an array of bible150-\* skill names/);
    assert.match(message, /description must be one non-empty line/);
    assert.equal(existsSync(join(root, ".claude")), false);
  }, bad);
});

test("catalog skills must exist and every skill must be referenced", async () => {
  await withFixture(async (root) => {
    write(
      root,
      ".agents/catalog.json",
      JSON.stringify({
        version: 1,
        roles: [role("alpha", ["bible150-ghost"])],
      }),
    );
    await assert.rejects(
      () => checkConventions(root),
      /references missing skill "bible150-ghost"/,
    );
    await assert.rejects(
      () => checkConventions(root),
      new RegExp(`${SKILL_A}: no catalog role lists this skill`),
    );
  });
});

test("skill frontmatter, names and limits are validated", async () => {
  await withFixture(async (root) => {
    write(
      root,
      `.agents/skills/${SKILL_A}/SKILL.md`,
      `---\nname: wrong\ndescription: ok\nmodel: x\n---\n\nbody\n`,
    );
    write(
      root,
      `.agents/skills/${SKILL_B}/SKILL.md`,
      `---\nname: ${SKILL_B}\ndescription: ${"d".repeat(1025)}\n---\n`,
    );
    write(
      root,
      ".agents/skills/Bad_Name/SKILL.md",
      "---\nname: Bad_Name\ndescription: x\n---\n",
    );
    write(root, `.agents/skills/${SKILL_A}/references/bad name.md`, "x\n");
    const message = await checkConventions(root).then(
      () => "",
      (error: Error) => error.message,
    );
    assert.match(message, /frontmatter name must equal the directory name/);
    assert.match(message, /unsupported frontmatter key "model"/);
    assert.match(message, /description is over 1024 characters/);
    assert.match(message, /Bad_Name: skill directory must be/);
    assert.match(message, /use only letters, digits/);
    write(
      root,
      `.agents/skills/${SKILL_B}/SKILL.md`,
      `---\nname: ${SKILL_B}\ndescription: Use when: unquoted colon\n---\n`,
    );
    await assert.rejects(() => checkConventions(root), /quote the value/);
    write(root, `.agents/skills/${SKILL_B}/SKILL.md`, "no frontmatter\n");
    await assert.rejects(
      () => checkConventions(root),
      /missing YAML frontmatter/,
    );
  });
});

test("skill links must exist and stay inside the skill", async () => {
  await withFixture(async (root) => {
    write(
      root,
      `.agents/skills/${SKILL_A}/references/guide.md`,
      "[gone](missing.md) and [up](../../../README.md) and `[code](nope.md)` and [web](https://x.test/a) and [anchor](#top)\n",
    );
    const message = await checkLinks(root);
    assert.match(message, /link target missing\.md does not exist/);
    assert.match(message, /link \.\.\/\.\.\/\.\.\/README\.md leaves/);
    assert.doesNotMatch(message, /nope\.md|x\.test|#top/);
  });
});

async function checkLinks(root: string) {
  return checkConventions(root).then(
    () => "",
    (error: Error) => error.message,
  );
}

test("copied resource references resolve in the generated skill", async () => {
  await withFixture(async (root) => {
    await syncAdapters(root);
    const copy = `.claude/skills/${SKILL_A}`;
    const link =
      /\]\(([^)]+)\)/.exec(read(root, `${copy}/SKILL.md`))?.[1] ?? "";
    assert.equal(link, "references/guide.md");
    assert.ok(existsSync(join(root, copy, link)));
  });
});

test("symlinks and traversal are rejected", async () => {
  await withFixture(async (root) => {
    const outside = mkdtempSync(join(tmpdir(), "agents-outside-"));
    try {
      writeFileSync(join(outside, "secret.md"), "secret\n");
      symlinkSync(
        join(outside, "secret.md"),
        join(root, `.agents/skills/${SKILL_A}/references/link.md`),
      );
      await assert.rejects(
        () => checkConventions(root),
        /link\.md: symlinks are not allowed/,
      );
      await assert.rejects(
        () => syncAdapters(root),
        /symlinks are not allowed/,
      );
      rmSync(join(root, `.agents/skills/${SKILL_A}/references/link.md`));

      symlinkSync(outside, join(root, ".claude"));
      await assert.rejects(
        () => syncAdapters(root),
        /refusing symlink at \.claude\/agents/,
      );
      assert.deepEqual(readdirSync(outside), ["secret.md"]);
      rmSync(join(root, ".claude"));

      mkdirSync(join(root, ".codex"));
      symlinkSync(outside, join(root, ".codex/agents"));
      await assert.rejects(() => syncAdapters(root), /refusing symlink/);
      assert.deepEqual(readdirSync(outside), ["secret.md"]);
      rmSync(join(root, ".codex/agents"));

      rmSync(join(root, ".agents/roles/alpha.md"));
      symlinkSync(
        join(outside, "secret.md"),
        join(root, ".agents/roles/alpha.md"),
      );
      await assert.rejects(() => syncAdapters(root), /refusing symlink/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("a symlinked generated target is never written through", async () => {
  await withFixture(async (root) => {
    const outside = mkdtempSync(join(tmpdir(), "agents-outside-"));
    try {
      mkdirSync(join(root, ".claude/agents"), { recursive: true });
      writeFileSync(join(outside, "target.md"), "untouched\n");
      symlinkSync(
        join(outside, "target.md"),
        join(root, ".claude/agents/bible150-alpha.md"),
      );
      await assert.rejects(() => syncAdapters(root), /refusing symlink/);
      assert.equal(
        readFileSync(join(outside, "target.md"), "utf8"),
        "untouched\n",
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("templates and root instructions are validated", async () => {
  await withFixture(async (root) => {
    await syncAdapters(root);
    write(
      root,
      ".agents/templates/local-profile.example.json",
      JSON.stringify({
        maxImplementationAgents: 9,
        playwrightPortBase: 4400,
        allowRemoteActions: false,
        mediaRoot: "relative",
      }),
    );
    write(
      root,
      ".agents/templates/assignment.example.json",
      JSON.stringify({
        goal: "",
        writablePaths: ["../x"],
        dependencies: [],
        acceptanceChecks: [],
      }),
    );
    write(
      root,
      ".agents/templates/handoff.example.json",
      JSON.stringify({
        tests: [{ command: "x" }],
        findings: [],
        remainingWork: [],
        artifacts: ["artifacts/x.png"],
      }),
    );
    write(root, "AGENTS.md", "No title and short\n");
    write(root, "CLAUDE.md", "nothing\n");
    const message = await checkLinks(root);
    for (const expected of [
      /maxImplementationAgents must be an integer from 1 to 3/,
      /unsupported key "allowRemoteActions"/,
      /mediaRoot, when present, must be an absolute path/,
      /goal must be a non-empty string/,
      /writablePaths must be/,
      /acceptanceChecks must be a non-empty array/,
      /tests must be an array of \{command, result\}/,
      /artifacts must be paths under the shared \.agents\/artifacts\//,
      /AGENTS\.md: must start with a '# Title'/,
      /AGENTS\.md: 4 words/,
      /CLAUDE\.md: must import/,
    ]) {
      assert.match(message, expected);
    }
  });
});

test("check needs no tools or credentials and never writes", async () => {
  await withFixture(async (root) => {
    await syncAdapters(root);
    const before = snapshot(root, [".agents", ".claude", ".codex"]);
    const env = { ...process.env };
    for (const key of Object.keys(process.env)) delete process.env[key];
    try {
      await checkConventions(root);
    } finally {
      Object.assign(process.env, env);
    }
    assert.deepEqual(snapshot(root, [".agents", ".claude", ".codex"]), before);
  });
});
