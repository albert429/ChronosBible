// Directory-level import graph of src/: its edges, cycles and boundary
// violations. The same table that drives the ESLint rule
// (scripts/quality/import-boundaries.mjs) checks every edge, and the strongly
// connected components catch cycles between features, which the per-edge rule
// cannot see.
//
//   node scripts/quality/layers.mjs [repository]     (exit 1 on a cycle or violation)

import fs from "node:fs";
import path from "node:path";
import { isMain } from "../lib/paths.js";
import { placeOf, violation } from "./import-boundaries.mjs";

const SOURCE = /\.(?:ts|tsx)$/;
const EXTENSIONS = ["", ".ts", ".tsx", ".js", "/index.tsx", "/index.ts"];
const SPECIFIER =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["'](\.[^"']*)["']/g;

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Graph units preserve physical ownership and domain/data roles for cycles. */
function unitOf(relative) {
  const place = placeOf(relative);
  if (!place) return undefined;
  return (
    place.unit ?? (place.area ? `${place.layer}/${place.area}` : place.layer)
  );
}

/** Strongly connected components with more than one unit (Tarjan). */
export function cyclesOf(edges) {
  const nodes = new Set([
    ...edges.keys(),
    ...[...edges.values()].flatMap((set) => [...set]),
  ]);
  const index = new Map();
  const low = new Map();
  const stack = [];
  const open = new Set();
  const cycles = [];
  let counter = 0;
  const visit = (node) => {
    index.set(node, counter);
    low.set(node, counter++);
    stack.push(node);
    open.add(node);
    for (const next of edges.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node), low.get(next)));
      } else if (open.has(next)) {
        low.set(node, Math.min(low.get(node), index.get(next)));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    const group = [];
    let member;
    do {
      member = stack.pop();
      open.delete(member);
      group.push(member);
    } while (member !== node);
    if (group.length > 1) cycles.push(group.sort());
  };
  for (const node of [...nodes].sort()) if (!index.has(node)) visit(node);
  return cycles;
}

/** Edges between units, cycles, and boundary violations for repository `root`. */
export function analyzeLayers(root) {
  const resolved = path.resolve(root);
  const src = path.join(resolved, "src");
  const edges = new Map();
  const violations = [];
  const sources = [src, path.join(resolved, "worker")].filter((dir) =>
    fs.existsSync(dir),
  );
  for (const file of sources.flatMap((dir) => [...walk(dir)])) {
    if (!SOURCE.test(file) || file.includes(`${path.sep}tests${path.sep}`))
      continue;
    const relative = path.relative(resolved, file).split(path.sep).join("/");
    const from = placeOf(relative);
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(SPECIFIER)) {
      const base = path.resolve(path.dirname(file), match[1]);
      const target = EXTENSIONS.map((extension) => base + extension).find(
        (candidate) =>
          fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
      );
      if (!target) continue;
      const targetRelative = path
        .relative(resolved, target)
        .split(path.sep)
        .join("/");
      const to = placeOf(targetRelative);
      if (!to) continue;
      const reason = violation(from, to, targetRelative.slice("src/".length));
      if (reason)
        violations.push(`${relative} -> ${targetRelative}: ${reason}`);
      const a = unitOf(relative);
      const b = unitOf(targetRelative);
      if (a === b) continue;
      if (!edges.has(a)) edges.set(a, new Set());
      edges.get(a).add(b);
    }
  }
  return { edges, cycles: cyclesOf(edges), violations };
}

function main() {
  const root = process.argv[2] ?? process.cwd();
  const { edges, cycles, violations } = analyzeLayers(root);
  for (const [unit, targets] of [...edges].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    console.log(unit.padEnd(22), "->", [...targets].sort().join(" "));
  console.log("CYCLES:", cycles.length ? JSON.stringify(cycles) : "none");
  console.log(
    "RULE VIOLATIONS:",
    violations.length ? `\n  ${violations.join("\n  ")}` : "none",
  );
  if (cycles.length || violations.length) process.exitCode = 1;
}

if (isMain(import.meta.url)) main();
