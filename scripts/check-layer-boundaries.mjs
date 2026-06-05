#!/usr/bin/env node
// Layer boundary enforcement.
//
// Fails (exit 1) when a source file imports across a forbidden layer boundary,
// keeping the data/domain/application/interface separation durable. Rules are
// declared per package below and cover only boundaries that are currently
// violation-free; known legacy exceptions are grandfathered via `allow`.
//
// A file's "layer" is the first path segment after `packages/<pkg>/src/`
// (e.g. `routes`, `application`, `lib`). Files directly in `src` and
// composition roots (`bootstrap/`, `index.ts`, `main.tsx`) are not `from`
// subjects, so they may wire any layer.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * @typedef {{ from: string, forbid: string[], allow?: string[], reason?: string }} Rule
 * Per-package layer rules. `from`/`forbid` are top-level layer dir names;
 * `allow` lists repo-relative POSIX paths grandfathered for that rule.
 * @type {Record<string, Rule[]>}
 */
const RULES = {
  server: [
    { from: "application", forbid: ["routes", "bootstrap", "ws"] },
    { from: "lib", forbid: ["routes", "application"] },
    { from: "state", forbid: ["routes", "application"] },
    { from: "pty", forbid: ["routes", "application"] },
    { from: "fs", forbid: ["routes", "application"] },
    { from: "net", forbid: ["routes", "application"] },
  ],
  web: [
    {
      from: "lib",
      forbid: ["features", "components"],
      allow: ["packages/web/src/lib/settings-context.tsx"],
      reason:
        "legacy settings-provider re-export; pending the deferred settings cleanup",
    },
  ],
};

const PACKAGE_ROOTS = [
  { pkg: "server", src: path.join(repoRoot, "packages/server/src") },
  { pkg: "web", src: path.join(repoRoot, "packages/web/src") },
];

/** Recursively collect `.ts`/`.tsx` files, skipping `.d.ts` and test files. */
function collectSources(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSources(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (entry.endsWith(".d.ts")) continue;
    if (/\.test\.|\.spec\./.test(entry)) continue;
    out.push(full);
  }
  return out;
}

const SPECIFIER_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/, // import/export ... from "x"
  /\bimport\s*["']([^"']+)["']/, // side-effect import "x"
  /\bimport\s*\(\s*["']([^"']+)["']/, // dynamic import("x")
];

/** Pull the (relative) module specifier out of a line, or null. */
function specifierOf(line) {
  for (const re of SPECIFIER_PATTERNS) {
    const m = line.match(re);
    if (m && (m[1].startsWith("./") || m[1].startsWith("../"))) return m[1];
  }
  return null;
}

/** Layer = first segment after `packages/<pkg>/src/`, or null if directly in src. */
function layerOf(absPath, srcRoot) {
  const rel = path.relative(srcRoot, absPath);
  if (rel.startsWith("..")) return null; // outside this package's src
  const segments = rel.split(path.sep);
  return segments.length > 1 ? segments[0] : null;
}

const violations = [];

for (const { pkg, src } of PACKAGE_ROOTS) {
  const rules = RULES[pkg];
  if (!rules) continue;
  for (const file of collectSources(src, [])) {
    const fromLayer = layerOf(file, src);
    if (!fromLayer) continue;
    const applicable = rules.filter((r) => r.from === fromLayer);
    if (applicable.length === 0) continue;

    const repoRel = path.relative(repoRoot, file).split(path.sep).join("/");
    const lines = readFileSync(file, "utf8").split("\n");

    lines.forEach((line, idx) => {
      const spec = specifierOf(line);
      if (!spec) return;
      const targetLayer = layerOf(path.resolve(path.dirname(file), spec), src);
      if (!targetLayer) return;
      for (const rule of applicable) {
        if (!rule.forbid.includes(targetLayer)) continue;
        if (rule.allow?.includes(repoRel)) continue;
        violations.push(
          `${repoRel}:${idx + 1}  ${fromLayer} -> ${targetLayer}  (forbidden: ${pkg} ${rule.from} ↛ ${rule.forbid.join("|")})`,
        );
      }
    });
  }
}

if (violations.length > 0) {
  console.error(
    `Layer boundary check failed -- ${violations.length} reverse dependency(ies):\n`,
  );
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    "\nLower layers must not import from interface/application layers. " +
      "Update the rule table in scripts/check-layer-boundaries.mjs if a " +
      "boundary changes intentionally.",
  );
  process.exit(1);
}

console.log("Layer boundary check passed -- no reverse dependencies.");
