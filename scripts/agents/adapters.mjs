import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
  rmdir,
} from "node:fs/promises";
import { dirname, join, posix } from "node:path";

/**
 * Generates the Claude and Codex adapters from the canonical `.agents/` tree
 * and validates repository conventions. Node built-ins only; no network, no
 * LLM CLI, no credentials.
 *
 * Both entry points resolve to `{ roles, skills, files }` (counts) and throw
 * one Error listing every problem with the fix, so a failure is actionable.
 */

const GENERATOR = "scripts/agents/adapters.mjs";
const FIX = 'run "npm run agents -- sync" after fixing canonical files';
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SKILL_FILES = 200;
const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SKILL_PATTERN = /^bible150-[a-z0-9]+(-[a-z0-9]+)*$/;
const RESOURCE_NAME = /^[A-Za-z0-9._-]+$/;
const ROOT_WORDS = { min: 300, max: 400 };

const CLAUDE_AGENTS = ".claude/agents";
const CLAUDE_SKILLS = ".claude/skills";
const CODEX_AGENTS = ".codex/agents";

const MARKER_LINE =
  /^(?:<!--|#) generated: scripts\/agents\/adapters\.mjs \| source: (\S+?)(?: \| files: ([^|]*?))? \|/m;

const COMMON_INSTRUCTIONS = `## Working agreement

- Work only in the directory you were launched in (your assigned worktree). Do not create nested worktrees or switch checkouts.
- Edit only the files and directories your assignment lists as writable. If it lists none, make no edits and report back. A role's default paths are recommendations, not permission.
- Inherit the permissions of the session that launched you; they are your limit, and this role is not a security sandbox.`;

/** @param {string} text */
function words(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** @param {unknown} value */
function isSafeRel(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 260) {
    return false;
  }
  if (
    /[\0\\]/.test(value) ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }
  const parts = value.replace(/\/$/, "").split("/");
  return parts.every((p) => p !== "" && p !== "." && p !== "..");
}

/** @param {unknown} value */
const isText = (value) => typeof value === "string" && value.trim() !== "";
/** @param {unknown} value */
const isTextList = (value) => Array.isArray(value) && value.every(isText);

/**
 * lstat each component under root; refuse symlinks. Returns the final Stats,
 * or null when the path (or a parent) does not exist.
 * @param {string} root
 * @param {string} rel
 */
async function statSafe(root, rel) {
  if (!isSafeRel(rel)) throw new Error(`unsafe path: ${JSON.stringify(rel)}`);
  let current = root;
  let stats = null;
  for (const part of rel.replace(/\/$/, "").split("/")) {
    current = join(current, part);
    try {
      stats = await lstat(current);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new Error(
        `refusing symlink at ${posix.relative(".", rel)} (${part}); replace it with a real file or directory`,
      );
    }
  }
  return stats;
}

/**
 * @param {string} root
 * @param {string} rel
 * @returns {Promise<Buffer | null>} null when missing
 */
async function readRegular(root, rel) {
  const stats = await statSafe(root, rel);
  if (!stats) return null;
  if (!stats.isFile()) throw new Error(`${rel} is not a regular file`);
  if (stats.size > MAX_FILE_BYTES)
    throw new Error(`${rel} is larger than ${MAX_FILE_BYTES} bytes`);
  return readFile(join(root, rel));
}

/**
 * @param {string} root
 * @param {string} rel
 */
async function readText(root, rel) {
  const data = await readRegular(root, rel);
  return data === null ? null : data.toString("utf8").replace(/\r\n/g, "\n");
}

/**
 * Sorted entry names of a real directory; [] when missing.
 * @param {string} root
 * @param {string} rel
 */
async function listDir(root, rel) {
  const stats = await statSafe(root, rel);
  if (!stats) return [];
  if (!stats.isDirectory()) throw new Error(`${rel} is not a directory`);
  return (await readdir(join(root, rel))).sort();
}

/**
 * Every regular file under a directory as relative paths; symlinks and other
 * special entries are reported as problems.
 * @param {string} root
 * @param {string} rel
 * @param {string[]} problems
 * @returns {Promise<string[]>}
 */
async function walkFiles(root, rel, problems) {
  const out = [];
  for (const name of await listDir(root, rel)) {
    const child = `${rel}/${name}`;
    const stats = await lstat(join(root, child));
    if (stats.isSymbolicLink()) {
      problems.push(
        `${child}: symlinks are not allowed in skills; copy the real file`,
      );
    } else if (stats.isDirectory()) {
      out.push(...(await walkFiles(root, child, problems)));
    } else if (stats.isFile()) {
      out.push(child);
    } else {
      problems.push(`${child}: only regular files and directories are allowed`);
    }
  }
  return out;
}

/** @param {string} raw @param {string} label @param {string[]} problems */
function scalar(raw, label, problems) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      // fall through
    }
    problems.push(`${label}: invalid double-quoted value`);
    return "";
  }
  if (value.startsWith("'")) {
    if (value.length > 1 && value.endsWith("'"))
      return value.slice(1, -1).replace(/''/g, "'");
    problems.push(`${label}: invalid single-quoted value`);
    return "";
  }
  if (
    /^[`&*!|>%@[\]{},#]/.test(value) ||
    /: | #/.test(value) ||
    value.endsWith(":")
  ) {
    problems.push(
      `${label}: quote the value (it contains YAML-special characters)`,
    );
  }
  return value;
}

/**
 * Minimal frontmatter reader: `key: value` lines only.
 * @param {string} text
 * @param {string} label
 * @param {string[]} problems
 */
function parseFrontmatter(text, label, problems) {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) {
    problems.push(
      `${label}: missing YAML frontmatter (--- name/description ---)`,
    );
    return null;
  }
  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of match[1].split("\n")) {
    if (!line.trim()) continue;
    const kv = /^([A-Za-z][\w-]*):[ ]+(\S.*)$/.exec(line);
    if (!kv) {
      problems.push(
        `${label}: unsupported frontmatter line ${JSON.stringify(line)}; use single-line "key: value"`,
      );
      continue;
    }
    if (kv[1] !== "name" && kv[1] !== "description") {
      problems.push(
        `${label}: unsupported frontmatter key "${kv[1]}"; only name and description are allowed`,
      );
      continue;
    }
    if (kv[1] in fields) {
      problems.push(`${label}: duplicate frontmatter key "${kv[1]}"`);
      continue;
    }
    fields[kv[1]] = scalar(kv[2], `${label} ${kv[1]}`, problems);
  }
  return { fields, end: match[0].length };
}

/** Relative markdown link targets, ignoring code. @param {string} text */
function markdownLinks(text) {
  const stripped = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
  const links = [];
  for (const m of stripped.matchAll(
    /\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
  )) {
    links.push(m[1]);
  }
  return links.filter((l) => !/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(l));
}

/**
 * Check relative links in a markdown file exist; when `within` is set they
 * must also stay inside that directory so copies keep working.
 * @param {string} root
 * @param {string} file
 * @param {string} text
 * @param {string | null} within
 * @param {string[]} problems
 */
async function checkLinks(root, file, text, within, problems) {
  for (const link of markdownLinks(text)) {
    const path = link.split(/[#?]/)[0];
    if (!path) continue;
    let decoded = path;
    try {
      decoded = decodeURI(path);
    } catch {
      // keep the raw path; the existence check reports it
    }
    const target = posix.normalize(posix.join(posix.dirname(file), decoded));
    if (
      target.startsWith("..") ||
      (within && !target.startsWith(`${within}/`))
    ) {
      problems.push(
        `${file}: link ${link} leaves ${within ?? "the repository"}; name repo files in code spans like \`docs/audio.md\` instead`,
      );
      continue;
    }
    try {
      if (!(await statSafe(root, target)))
        problems.push(`${file}: link target ${link} does not exist`);
    } catch (error) {
      problems.push(`${file}: ${error.message}`);
    }
  }
}

/** @param {unknown} value @param {string} label @param {string[]} problems */
function expectObject(value, label, problems) {
  if (value && typeof value === "object" && !Array.isArray(value))
    return /** @type {Record<string, unknown>} */ (value);
  problems.push(`${label}: expected a JSON object`);
  return null;
}

/** Text of a required file, or null after recording why not. @param {string} root @param {string} rel @param {string[]} problems */
async function readDoc(root, rel, problems) {
  try {
    const text = await readText(root, rel);
    if (text === null) problems.push(`${rel}: missing`);
    return text;
  } catch (error) {
    problems.push(`${rel}: ${error.message}`);
    return null;
  }
}

/** @param {string} root @param {string} rel @param {string[]} problems */
async function readJson(root, rel, problems) {
  const text = await readDoc(root, rel, problems);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    problems.push(`${rel}: invalid JSON (${error.message})`);
    return null;
  }
}

/** @param {Record<string, unknown>} obj @param {string[]} allowed @param {string} label @param {string[]} problems */
function rejectUnknownKeys(obj, allowed, label, problems) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key))
      problems.push(
        `${label}: unsupported key "${key}" (allowed: ${allowed.join(", ")})`,
      );
  }
}

/**
 * @param {string} root
 * @param {string[]} problems
 */
async function loadCatalog(root, problems) {
  const catalog = await readJson(root, ".agents/catalog.json", problems);
  if (!catalog) return [];
  const top = expectObject(catalog, ".agents/catalog.json", problems);
  if (!top) return [];
  if (top.version !== 1)
    problems.push(".agents/catalog.json: version must be 1");
  if (!Array.isArray(top.roles) || top.roles.length === 0) {
    problems.push(".agents/catalog.json: roles must be a non-empty array");
    return [];
  }
  const ids = new Set();
  const names = new Set();
  const roles = [];
  top.roles.forEach((entry, index) => {
    const label = `.agents/catalog.json roles[${index}]`;
    const role = expectObject(entry, label, problems);
    if (!role) return;
    rejectUnknownKeys(
      role,
      [
        "id",
        "name",
        "description",
        "instructions",
        "recommendedPaths",
        "skills",
      ],
      label,
      problems,
    );
    const { id, name, description, instructions, recommendedPaths, skills } =
      role;
    let valid = true;
    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      problems.push(`${label}: id must be lowercase words joined by hyphens`);
      valid = false;
    } else if (ids.has(id)) {
      problems.push(`${label}: duplicate id "${id}"`);
      valid = false;
    } else ids.add(id);
    if (typeof id === "string" && name !== `bible150-${id}`) {
      problems.push(`${label}: name must be "bible150-${id}"`);
      valid = false;
    } else if (typeof name === "string" && names.has(name)) {
      problems.push(`${label}: duplicate name "${name}"`);
      valid = false;
    } else if (typeof name === "string") names.add(name);
    if (
      !isText(description) ||
      /[\r\n\0]/.test(/** @type {string} */ (description)) ||
      /** @type {string} */ (description).length > 1024
    ) {
      problems.push(
        `${label}: description must be one non-empty line of at most 1024 characters`,
      );
      valid = false;
    }
    if (typeof id === "string" && instructions !== `.agents/roles/${id}.md`) {
      problems.push(`${label}: instructions must be ".agents/roles/${id}.md"`);
      valid = false;
    }
    if (
      !Array.isArray(recommendedPaths) ||
      recommendedPaths.length === 0 ||
      !recommendedPaths.every(isSafeRel)
    ) {
      problems.push(
        `${label}: recommendedPaths must be a non-empty array of repository-relative paths without ".." or absolute parts`,
      );
      valid = false;
    }
    if (
      !Array.isArray(skills) ||
      !skills.every((s) => typeof s === "string" && SKILL_PATTERN.test(s))
    ) {
      problems.push(
        `${label}: skills must be an array of bible150-* skill names`,
      );
      valid = false;
    }
    if (valid) {
      roles.push({
        id: /** @type {string} */ (id),
        name: /** @type {string} */ (name),
        description: /** @type {string} */ (description),
        instructions: /** @type {string} */ (instructions),
        skills: /** @type {string[]} */ (skills),
      });
    }
  });
  return roles;
}

/**
 * Read and validate every canonical skill directory.
 * @param {string} root
 * @param {string[]} problems
 * @returns {Promise<Map<string, Map<string, Buffer>>>} skill name -> relative file -> bytes
 */
async function loadSkills(root, problems) {
  const skills = new Map();
  for (const name of await listDir(root, ".agents/skills")) {
    const dir = `.agents/skills/${name}`;
    const stats = await lstat(join(root, dir));
    if (stats.isSymbolicLink()) {
      problems.push(`${dir}: symlinks are not allowed; use a real directory`);
      continue;
    }
    if (!stats.isDirectory()) {
      problems.push(`${dir}: only skill directories belong in .agents/skills`);
      continue;
    }
    const before = problems.length;
    if (!SKILL_PATTERN.test(name) || name.length > 64) {
      problems.push(
        `${dir}: skill directory must be a lowercase hyphenated bible150-* name of at most 64 characters`,
      );
    }
    const files = await walkFiles(root, dir, problems);
    if (files.length > MAX_SKILL_FILES)
      problems.push(`${dir}: more than ${MAX_SKILL_FILES} files`);
    /** @type {Map<string, Buffer>} */
    const contents = new Map();
    for (const file of files) {
      const rel = file.slice(dir.length + 1);
      if (
        !rel
          .split("/")
          .every(
            (part) => RESOURCE_NAME.test(part) && part !== "." && part !== "..",
          )
      ) {
        problems.push(
          `${file}: use only letters, digits, ".", "_" and "-" in resource names`,
        );
        continue;
      }
      try {
        const data = await readRegular(root, file);
        if (data) contents.set(rel, data);
      } catch (error) {
        problems.push(`${file}: ${error.message}`);
      }
    }
    const main = contents.get("SKILL.md");
    if (!main) {
      problems.push(`${dir}/SKILL.md: missing`);
      continue;
    }
    const text = main.toString("utf8").replace(/\r\n/g, "\n");
    const meta = parseFrontmatter(text, `${dir}/SKILL.md`, problems);
    if (meta) {
      if (meta.fields.name !== name)
        problems.push(
          `${dir}/SKILL.md: frontmatter name must equal the directory name "${name}"`,
        );
      const description = meta.fields.description;
      if (!description)
        problems.push(`${dir}/SKILL.md: frontmatter description is required`);
      else if (description.length > 1024)
        problems.push(`${dir}/SKILL.md: description is over 1024 characters`);
    }
    for (const [rel, data] of contents) {
      if (rel.endsWith(".md"))
        await checkLinks(
          root,
          `${dir}/${rel}`,
          data.toString("utf8"),
          dir,
          problems,
        );
    }
    if (problems.length === before) skills.set(name, contents);
  }
  return skills;
}

/** @param {string} root @param {string[]} problems */
async function checkTemplates(root, problems) {
  const dir = ".agents/templates";
  const assignment = await readJson(
    root,
    `${dir}/assignment.example.json`,
    problems,
  );
  if (assignment) {
    const label = `${dir}/assignment.example.json`;
    const a = expectObject(assignment, label, problems);
    if (a) {
      rejectUnknownKeys(
        a,
        ["goal", "writablePaths", "dependencies", "acceptanceChecks"],
        label,
        problems,
      );
      if (!isText(a.goal))
        problems.push(`${label}: goal must be a non-empty string`);
      if (
        !Array.isArray(a.writablePaths) ||
        a.writablePaths.length === 0 ||
        !a.writablePaths.every(isSafeRel)
      ) {
        problems.push(
          `${label}: writablePaths must be a non-empty array of repository-relative paths`,
        );
      }
      if (!isTextList(a.dependencies))
        problems.push(`${label}: dependencies must be an array of strings`);
      if (
        !isTextList(a.acceptanceChecks) ||
        /** @type {unknown[]} */ (a.acceptanceChecks).length === 0
      ) {
        problems.push(
          `${label}: acceptanceChecks must be a non-empty array of strings`,
        );
      }
    }
  }
  const handoff = await readJson(root, `${dir}/handoff.example.json`, problems);
  if (handoff) {
    const label = `${dir}/handoff.example.json`;
    const h = expectObject(handoff, label, problems);
    if (h) {
      rejectUnknownKeys(
        h,
        ["tests", "findings", "remainingWork", "artifacts"],
        label,
        problems,
      );
      const tests = h.tests;
      if (
        !Array.isArray(tests) ||
        !tests.every((t) => t && isText(t.command) && isText(t.result))
      ) {
        problems.push(
          `${label}: tests must be an array of {command, result} strings`,
        );
      }
      for (const key of ["findings", "remainingWork"]) {
        if (!isTextList(h[key]))
          problems.push(`${label}: ${key} must be an array of strings`);
      }
      if (
        !Array.isArray(h.artifacts) ||
        !h.artifacts.every(
          (p) => isSafeRel(p) && p.startsWith(".agents/artifacts/"),
        )
      ) {
        problems.push(
          `${label}: artifacts must be paths under the shared .agents/artifacts/`,
        );
      }
    }
  }
  const profile = await readJson(
    root,
    `${dir}/local-profile.example.json`,
    problems,
  );
  if (profile) {
    const label = `${dir}/local-profile.example.json`;
    const p = expectObject(profile, label, problems);
    if (p) {
      rejectUnknownKeys(
        p,
        [
          "maxImplementationAgents",
          "playwrightPortBase",
          "modelPreferences",
          "mediaRoot",
        ],
        label,
        problems,
      );
      const max = p.maxImplementationAgents;
      if (
        !Number.isInteger(max) ||
        /** @type {number} */ (max) < 1 ||
        /** @type {number} */ (max) > 3
      ) {
        problems.push(
          `${label}: maxImplementationAgents must be an integer from 1 to 3`,
        );
      }
      const port = p.playwrightPortBase;
      if (
        !Number.isInteger(port) ||
        /** @type {number} */ (port) < 1024 ||
        /** @type {number} */ (port) > 65000
      ) {
        problems.push(
          `${label}: playwrightPortBase must be an integer from 1024 to 65000`,
        );
      }
      if (
        p.mediaRoot !== undefined &&
        (!isText(p.mediaRoot) ||
          !/^(?:\/|[A-Za-z]:[\\/])/.test(/** @type {string} */ (p.mediaRoot)))
      ) {
        problems.push(
          `${label}: mediaRoot, when present, must be an absolute path`,
        );
      }
      if (p.modelPreferences !== undefined) {
        const prefs = expectObject(
          p.modelPreferences,
          `${label} modelPreferences`,
          problems,
        );
        if (prefs && !Object.values(prefs).every(isText))
          problems.push(`${label}: modelPreferences values must be strings`);
      }
    }
  }
}

/** @param {string} root @param {string[]} problems */
async function checkRootDocs(root, problems) {
  const agents = await readDoc(root, "AGENTS.md", problems);
  if (agents !== null) {
    if (!/^# \S/.test(agents))
      problems.push("AGENTS.md: must start with a '# Title' heading");
    const count = words(agents);
    if (count < ROOT_WORDS.min || count > ROOT_WORDS.max) {
      problems.push(
        `AGENTS.md: ${count} words; keep root instructions between ${ROOT_WORDS.min} and ${ROOT_WORDS.max} (move detail to .agents/README.md or docs/)`,
      );
    }
    await checkLinks(root, "AGENTS.md", agents, null, problems);
  }
  const claude = await readDoc(root, "CLAUDE.md", problems);
  if (claude !== null && !/^@AGENTS\.md$/m.test(claude)) {
    problems.push(
      "CLAUDE.md: must import the shared instructions with a line '@AGENTS.md'",
    );
  }
  const readme = await readDoc(root, ".agents/README.md", problems);
  if (readme !== null)
    await checkLinks(root, ".agents/README.md", readme, null, problems);
}

/**
 * Read all canonical sources. Throws if any are invalid.
 * @param {string} root
 * @param {{ docs: boolean }} options
 */
async function loadSource(root, { docs }) {
  /** @type {string[]} */
  const problems = [];
  const roles = await loadCatalog(root, problems);
  const skills = await loadSkills(root, problems);
  /** @type {Map<string, string>} */
  const prompts = new Map();
  const referenced = new Set();
  for (const role of roles) {
    let text;
    try {
      text = await readText(root, role.instructions);
    } catch (error) {
      problems.push(`${role.instructions}: ${error.message}`);
      continue;
    }
    if (text === null) {
      problems.push(
        `${role.instructions}: missing role prompt for "${role.id}"`,
      );
      // eslint-disable-next-line no-control-regex -- rejecting them is the point
    } else if (/[\0-\x08\x0b-\x1f]/.test(text)) {
      problems.push(`${role.instructions}: control characters are not allowed`);
    } else if (!text.startsWith(`# ${role.name}\n`)) {
      problems.push(
        `${role.instructions}: first line must be "# ${role.name}"`,
      );
    } else {
      prompts.set(role.id, text.trimEnd());
    }
    for (const skill of role.skills) {
      referenced.add(skill);
      if (
        !skills.has(skill) &&
        !problems.some((p) => p.includes(`.agents/skills/${skill}`))
      ) {
        problems.push(
          `catalog role "${role.id}" references missing skill "${skill}" (expected .agents/skills/${skill}/SKILL.md)`,
        );
      }
    }
  }
  for (const name of skills.keys()) {
    if (!referenced.has(name))
      problems.push(
        `.agents/skills/${name}: no catalog role lists this skill; add it to a role or remove the directory`,
      );
  }
  if (docs) {
    await checkTemplates(root, problems);
    await checkRootDocs(root, problems);
  }
  if (problems.length > 0)
    throw new Error(`Invalid agent sources:\n- ${problems.join("\n- ")}`);
  return { roles, skills, prompts };
}

/** @param {string} source */
const markdownMarker = (source) =>
  `<!-- generated: ${GENERATOR} | source: ${source} | do not edit; ${FIX} -->`;
/** @param {string} source */
const tomlMarker = (source) =>
  `# generated: ${GENERATOR} | source: ${source} | do not edit; ${FIX}`;

/** @param {string} text */
const tomlMultiline = (text) =>
  `"""\n${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}\n"""`;

/**
 * @typedef {{ id: string, name: string, description: string, instructions: string, skills: string[] }} Role
 * @typedef {{ data: Buffer | string, source: string | null }} Output
 */

/**
 * @param {{ roles: Role[], skills: Map<string, Map<string, Buffer>>, prompts: Map<string, string> }} source
 * @returns {Map<string, Output>} repo-relative path -> content
 */
function buildOutputs(source) {
  /** @type {Map<string, Output>} */
  const outputs = new Map();
  const add = (
    /** @type {string} */ path,
    /** @type {Buffer | string} */ data,
    source = null,
  ) => outputs.set(path, { data, source });
  for (const role of source.roles) {
    const prompt = /** @type {string} */ (source.prompts.get(role.id));
    const skillLine = role.skills.length
      ? `\nRelevant skills (load when the task fits): ${role.skills.map((s) => `\`${s}\``).join(", ")}.\n`
      : "";
    const body = `${prompt}\n\n${COMMON_INSTRUCTIONS}\n${skillLine}`;
    add(
      `${CLAUDE_AGENTS}/${role.name}.md`,
      `---\nname: ${role.name}\ndescription: ${JSON.stringify(role.description)}\n---\n\n${markdownMarker(role.instructions)}\n\n${body}`,
      role.instructions,
    );
    add(
      `${CODEX_AGENTS}/${role.name}.toml`,
      `${tomlMarker(role.instructions)}\nname = ${JSON.stringify(role.name)}\ndescription = ${JSON.stringify(role.description)}\ndeveloper_instructions = ${tomlMultiline(body.trimEnd())}\n`,
      role.instructions,
    );
  }
  for (const [name, files] of source.skills) {
    const list = [...files.keys()].sort();
    for (const rel of list) {
      const data = /** @type {Buffer} */ (files.get(rel));
      if (rel !== "SKILL.md") {
        add(`${CLAUDE_SKILLS}/${name}/${rel}`, data);
        continue;
      }
      const text = data.toString("utf8").replace(/\r\n/g, "\n");
      const end = /^---\n[\s\S]*?\n---\n?/.exec(text)?.[0].length ?? 0;
      const marker = `<!-- generated: ${GENERATOR} | source: .agents/skills/${name}/ | files: ${list.join(" ")} | do not edit; ${FIX} -->`;
      add(
        `${CLAUDE_SKILLS}/${name}/SKILL.md`,
        `${text.slice(0, end).replace(/\n?$/, "\n")}\n${marker}\n\n${text.slice(end).replace(/^\n+/, "")}`,
      );
    }
  }
  return outputs;
}

const sameBytes = (
  /** @type {Buffer | string} */ a,
  /** @type {Buffer | string} */ b,
) => Buffer.from(a).equals(Buffer.from(b));

/**
 * Whether an existing generated-looking file carries our marker and names the
 * expected source.
 * @param {string | null} text
 * @param {string | null} expectedSource
 */
function markerOf(text, expectedSource = null) {
  if (text === null) return null;
  const m = MARKER_LINE.exec(text);
  if (!m || (expectedSource && m[1] !== expectedSource)) return null;
  return { source: m[1], files: m[2] ? m[2].trim().split(/\s+/) : [] };
}

/**
 * Compare the desired outputs with disk.
 * @param {string} root
 * @param {Map<string, Output>} outputs
 * @param {{ roles: Role[], skills: Map<string, unknown> }} source
 */
async function inspectDisk(root, outputs, source) {
  /** @type {string[]} */ const conflicts = [];
  /** @type {string[]} */ const missing = [];
  /** @type {string[]} */ const drift = [];
  /** @type {string[]} */ const stale = [];
  /** @type {{ dir: string, files: string[] }[]} */ const staleDirs = [];
  /** @type {string[]} */ const extra = [];

  const wanted = new Set(outputs.keys());

  // Role files
  for (const [dir, ext] of [
    [CLAUDE_AGENTS, ".md"],
    [CODEX_AGENTS, ".toml"],
  ]) {
    for (const entry of await listDir(root, dir)) {
      if (!entry.startsWith("bible150-") || !entry.endsWith(ext)) continue;
      const rel = `${dir}/${entry}`;
      if (wanted.has(rel)) continue;
      const stats = await lstat(join(root, rel));
      if (stats.isSymbolicLink() || !stats.isFile()) continue;
      const text = await readText(root, rel);
      if (markerOf(text)?.source.startsWith(".agents/roles/")) stale.push(rel);
    }
  }

  // Skill directories
  for (const entry of await listDir(root, CLAUDE_SKILLS)) {
    if (!entry.startsWith("bible150-")) continue;
    if (source.skills.has(entry)) continue;
    const dir = `${CLAUDE_SKILLS}/${entry}`;
    const stats = await lstat(join(root, dir));
    if (stats.isSymbolicLink() || !stats.isDirectory()) continue;
    const marker = markerOf(
      await readText(root, `${dir}/SKILL.md`).catch(() => null),
      `.agents/skills/${entry}/`,
    );
    if (marker) staleDirs.push({ dir, files: marker.files });
  }

  /** @type {Map<string, string[]>} managed skill dirs -> files their marker lists */
  const managedDirs = new Map();
  for (const name of source.skills.keys()) {
    const dir = `${CLAUDE_SKILLS}/${name}`;
    const stats = await statSafe(root, dir);
    if (!stats) continue;
    if (!stats.isDirectory()) {
      conflicts.push(`${dir} exists and is not a directory`);
      continue;
    }
    const entries = await listDir(root, dir);
    const marker = markerOf(
      await readText(root, `${dir}/SKILL.md`).catch(() => null),
      `.agents/skills/${name}/`,
    );
    if (marker) managedDirs.set(dir, marker.files);
    else if (entries.length > 0)
      conflicts.push(
        `${dir} exists but ${dir}/SKILL.md is not a generated copy (no "generated:" marker); move or delete it to let sync manage this path`,
      );
  }

  for (const [rel, output] of outputs) {
    const dir = rel.startsWith(`${CLAUDE_SKILLS}/`)
      ? rel.split("/").slice(0, 3).join("/")
      : null;
    if (dir && !managedDirs.has(dir)) {
      const existing = await statSafe(root, dir);
      if (!existing || (await listDir(root, dir)).length === 0) {
        missing.push(rel);
        continue;
      }
      continue; // already reported as a conflict
    }
    const current = await readRegular(root, rel);
    if (current === null) {
      missing.push(rel);
      continue;
    }
    if (sameBytes(current, output.data)) continue;
    const listed = dir ? (managedDirs.get(dir) ?? []) : [];
    const name = dir ? rel.slice(dir.length + 1) : null;
    const owned = dir
      ? name === "SKILL.md" || listed.includes(/** @type {string} */ (name))
      : markerOf(current.toString("utf8"), output.source) !== null;
    if (owned) drift.push(rel);
    else
      conflicts.push(
        `${rel} exists but is not a generated file (no "generated:" marker); move or delete it to let sync manage this path`,
      );
  }

  for (const [dir, listed] of managedDirs) {
    const files = await walkFiles(root, dir, extra);
    for (const file of files) {
      const rel = file.slice(dir.length + 1);
      if (wanted.has(file)) continue;
      if (listed.includes(rel)) stale.push(file);
      else
        conflicts.push(
          `${file} is not a generated resource of ${dir} and not canonical; move it out or delete it`,
        );
    }
  }
  return { conflicts, missing, drift, stale, staleDirs, extra };
}

/**
 * Regenerate `.claude/agents`, `.claude/skills`, and `.codex/agents`.
 * Fails closed before writing anything if a foreign file occupies a target.
 * @param {string} root repository root
 */
export async function syncAdapters(root) {
  const source = await loadSource(root, { docs: false });
  const outputs = buildOutputs(source);
  const state = await inspectDisk(root, outputs, source);
  const blocking = [...state.conflicts, ...state.extra];
  if (blocking.length > 0) {
    throw new Error(
      `Refusing to overwrite files this generator does not own:\n- ${blocking.join("\n- ")}`,
    );
  }
  const written = [];
  for (const [rel, output] of outputs) {
    const target = join(root, rel);
    const current = await readRegular(root, rel);
    if (current && sameBytes(current, output.data)) continue;
    await mkdirSafe(root, dirname(rel));
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, output.data);
    await rename(temp, target);
    written.push(rel);
  }
  for (const rel of state.stale) await rm(join(root, rel));
  for (const { dir, files } of state.staleDirs) {
    for (const rel of files) {
      if (
        rel
          .split("/")
          .every(
            (part) => RESOURCE_NAME.test(part) && part !== "." && part !== "..",
          ) &&
        (await statSafe(root, `${dir}/${rel}`))
      ) {
        await rm(join(root, dir, rel));
      }
    }
    await pruneEmptyDirs(root, dir, true);
  }
  await pruneSkillDirs(root, outputs);
  return {
    ...counts(source, outputs),
    changed: [...written, ...state.stale, ...state.staleDirs.map((d) => d.dir)],
  };
}

/** @param {string} root @param {string} rel */
async function mkdirSafe(root, rel) {
  let current = "";
  for (const part of rel.split("/")) {
    current = current ? `${current}/${part}` : part;
    const stats = await statSafe(root, current);
    if (!stats) await mkdir(join(root, current));
    else if (!stats.isDirectory())
      throw new Error(`${current} exists and is not a directory`);
  }
}

/**
 * Remove now-empty directories left inside a managed skill dir (and the dir
 * itself when `self`); anything still holding files is left alone.
 */
async function pruneEmptyDirs(
  /** @type {string} */ root,
  /** @type {string} */ rel,
  self = false,
) {
  for (const name of await listDir(root, rel)) {
    const child = `${rel}/${name}`;
    if ((await lstat(join(root, child))).isDirectory())
      await pruneEmptyDirs(root, child, true);
  }
  if (self && (await listDir(root, rel)).length === 0)
    await rmdir(join(root, rel));
}

/** Drop empty subdirectories of retained generated skills after a resource was removed. */
async function pruneSkillDirs(
  /** @type {string} */ root,
  /** @type {Map<string, Output>} */ outputs,
) {
  const dirs = new Set();
  for (const rel of outputs.keys()) {
    if (rel.startsWith(`${CLAUDE_SKILLS}/`))
      dirs.add(rel.split("/").slice(0, 3).join("/"));
  }
  for (const dir of dirs) {
    for (const name of await listDir(root, dir)) {
      const child = `${dir}/${name}`;
      if ((await lstat(join(root, child))).isDirectory())
        await pruneEmptyDirs(root, child, true);
    }
  }
}

/** @param {{ roles: Role[], skills: Map<string, unknown> }} source @param {Map<string, Output>} outputs */
function counts(source, outputs) {
  return {
    roles: source.roles.length,
    skills: source.skills.size,
    files: outputs.size,
  };
}

/**
 * Validate catalog, roles, skills, templates, root instructions, and that the
 * generated adapters are present and current. Writes nothing.
 * @param {string} root repository root
 */
export async function checkConventions(root) {
  const source = await loadSource(root, { docs: true });
  const outputs = buildOutputs(source);
  const state = await inspectDisk(root, outputs, source);
  const problems = [
    ...state.missing.map((p) => `${p}: missing generated file`),
    ...state.drift.map(
      (p) =>
        `${p}: differs from the canonical source (stale or edited by hand)`,
    ),
    ...state.stale.map(
      (p) =>
        `${p}: generated output with no canonical source (role or resource was removed)`,
    ),
    ...state.staleDirs.map(
      (d) => `${d.dir}: generated skill with no canonical source`,
    ),
    ...state.conflicts,
    ...state.extra,
  ];
  if (problems.length > 0)
    throw new Error(
      `Agent conventions check failed (${FIX}):\n- ${problems.join("\n- ")}`,
    );
  return counts(source, outputs);
}
