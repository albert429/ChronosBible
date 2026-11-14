// Feature ownership with pure domain, client and UI roles.
// Shared contracts live in core; see docs/development.md.
import path from "node:path";

/** Features may import their own folder plus these features. */
export const FEATURE_EDGES = {
  ai: [],
  appearance: ["audio"],
  audio: [],
  bible: ["profiles"],
  chronology: [],
  navigation: [
    "appearance",
    "offline",
    "profiles",
    "streak",
    "bible",
    "chronology",
    "plan",
  ],
  offline: [],
  plan: ["streak", "profiles"],
  profiles: [],
  reader: ["appearance", "audio", "profiles", "streak", "study"],
  streak: ["profiles"],
  study: ["ai", "appearance"],
};

/** Each domain area may import itself and these areas. */
export const DOMAIN_EDGES = {
  ai: [],
  scripture: [],
  reading: ["scripture"],
  profiles: ["scripture", "reading"],
  audio: ["scripture", "reading"],
  study: ["scripture", "reading"],
};

/** Feature modules that build and tool code may import (plain, React-free). */
export const TOOL_FEATURE_FILES = ["features/offline/rules.ts"];

const posix = (value) => value.split(path.sep).join("/");

/**
 * Where a repository-relative path sits in the layering, or undefined for
 * files outside src/ (tooling).
 */
export function placeOf(relative) {
  const parts = posix(relative).split("/");
  if (parts[0] === "worker") return { layer: "worker", area: "" };
  if (parts[0] !== "src") return undefined;
  if (parts.length === 2) return { layer: "root", area: "" };
  const [, layer, area, role] = parts;
  if (layer === "core") return { layer: "domain", area, unit: `core/${area}` };
  if (layer === "features" && (role === "domain" || role === "data"))
    return { layer: role, area, unit: `features/${area}/${role}` };
  if (layer === "shared" && area === "network")
    return { layer: "data", area: "network", unit: "shared/network" };
  if (layer === "app" || layer === "assets") return { layer, area: "" };
  return { layer, area };
}

const label = (place) =>
  place.layer === "data" || !place.area
    ? place.layer
    : `${place.layer}/${place.area}`;

/**
 * Why `from` may not import `to` (both from placeOf), or undefined when the
 * edge is allowed. `toFile` is the target path relative to src/.
 */
export function violation(from, to, toFile) {
  if (to.layer === "worker")
    return !from || from.layer === "worker"
      ? undefined
      : "browser code cannot import worker implementation or secrets";
  if (from?.layer === "worker")
    return to.layer === "domain" || (to.layer === "shared" && to.area === "lib")
      ? undefined
      : "worker imports only worker, domain and shared/lib";
  if (to.layer === "app" && from?.layer !== "app" && from?.layer !== "root")
    return "nothing imports app/ except src/main.tsx";
  if (!from) {
    if (to.layer === "domain" || to.layer === "data") return undefined;
    if (to.layer === "shared" && to.area === "lib") return undefined;
    if (TOOL_FEATURE_FILES.includes(toFile)) return undefined;
    return `build and tool code may import only core, feature domain/data, shared/network, shared/lib and ${TOOL_FEATURE_FILES.join(", ")}`;
  }
  if (from.layer === "domain") {
    if (to.layer === "shared" && to.area === "lib") return undefined;
    if (to.layer !== "domain")
      return "domain is pure: it imports only domain and shared/lib";
    if (to.area === from.area || DOMAIN_EDGES[from.area]?.includes(to.area))
      return undefined;
    return `domain/${from.area} may import only ${["itself", ...(DOMAIN_EDGES[from.area] ?? [])].join(", ")} (scripture <- reading <- profiles, audio, study)`;
  }
  if (from.layer === "data") {
    if (to.layer === "domain" || to.layer === "data") return undefined;
    return "data imports only domain and data";
  }
  if (from.layer === "shared") {
    if (from.area === "lib") {
      if (to.layer === "shared" && to.area === "lib") return undefined;
      return "shared/lib is pure: it imports only shared/lib";
    }
    if (to.layer === "features" || to.layer === "data")
      return "shared never imports features, app or data";
    return undefined;
  }
  if (from.layer === "features") {
    if (to.layer !== "features") return undefined;
    if (to.area === from.area || FEATURE_EDGES[from.area]?.includes(to.area))
      return undefined;
    return `features/${from.area} may not import features/${to.area}; allowed: ${FEATURE_EDGES[from.area]?.join(", ") || "none"}`;
  }
  return undefined;
}

/** The place and path (relative to src/) of an import target, if inside src/. */
export function targetOf(root, importer, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const absolute = path.resolve(path.dirname(importer), specifier);
  const relative = posix(path.relative(root, absolute));
  const place = placeOf(relative);
  if (!place) return undefined;
  return { place, file: relative.slice("src/".length) };
}

function describe(from, to) {
  return `${from ? label(from) : "tooling"} -> ${label(to)}`;
}

const rule = {
  meta: {
    type: "problem",
    docs: { description: "Enforce the layering of src/" },
    schema: [],
    messages: {
      forbidden: "Forbidden import ({{edge}}): {{reason}}.",
    },
  },
  create(context) {
    const root = context.cwd;
    const file = context.filename;
    const from = placeOf(posix(path.relative(root, file)));
    const check = (node, source) => {
      if (!source || source.type !== "Literal") return;
      if (typeof source.value !== "string") return;
      const to = targetOf(root, file, source.value);
      if (!to) return;
      const reason = violation(from, to.place, to.file);
      if (reason)
        context.report({
          node,
          messageId: "forbidden",
          data: { edge: describe(from, to.place), reason },
        });
    };
    return {
      ImportDeclaration: (node) => check(node, node.source),
      ExportAllDeclaration: (node) => check(node, node.source),
      ExportNamedDeclaration: (node) => check(node, node.source),
      ImportExpression: (node) => check(node, node.source),
    };
  },
};

export default { rules: { "import-boundaries": rule } };
