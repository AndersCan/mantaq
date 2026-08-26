#!/usr/bin/env node
/**
 * Docs gates. Enforced by the docs-write skill.
 *
 * Gate A — Example continuity. Every state/event ID used in narrative docs
 *          pages exists in the canonical registry (checkout example).
 * Gate B — API truth. Every @mantaq/* import in docs is a real package export.
 * Gate C — Canonical example typechecks (packages/examples).
 *
 * Narrative pages: all of apps/docs/src/content/docs except reference/*.
 * Reference pages are exempt from Gate A but still checked by Gate B.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DOCS_DIR = join(ROOT, "apps/docs/src/content/docs");
const EXAMPLE_TEST = join(ROOT, "packages/examples/checkout.test.ts");
const EXAMPLE_MDX = join(ROOT, ".opencode/skills/docs-write/resources/example.mdx");
const CORE_INDEX = join(ROOT, "packages/core/src/index.ts");
const SUGAR_INDEX = join(ROOT, "packages/sugar/src/index.ts");
const PBT_INDEX = join(ROOT, "packages/pbt/src/index.ts");
const TEST_INDEX = join(ROOT, "packages/testkit/src/index.ts");
const TRAVERSAL_INDEX = join(ROOT, "packages/traversal/src/index.ts");

const BUILTIN_ALLOW = new Set(["__error"]);
const PACKAGE_INDEX = new Map([
  ["@mantaq/core", CORE_INDEX],
  ["@mantaq/sugar", SUGAR_INDEX],
  ["@mantaq/pbt", PBT_INDEX],
  ["@mantaq/test", TEST_INDEX],
  ["@mantaq/traversal", TRAVERSAL_INDEX],
]);

let failures = 0;

function fail(message) {
  failures++;
  console.error(`  ✗ ${message}`);
}

function pass(message) {
  console.log(`  ✓ ${message}`);
}

function walkFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else if (entry.endsWith(".mdx")) out.push(full);
  }
  return out;
}

function read(file) {
  return readFileSync(file, "utf8");
}

function extractIds(source) {
  const ids = new Set();
  for (const match of source.matchAll(/state\("([^"]+)"\)/g)) ids.add(match[1]);
  for (const match of source.matchAll(/event\("([^"]+)"\)/g)) ids.add(match[1]);
  for (const match of source.matchAll(/(?:states|events)\("([^"]+)"\)/g)) ids.add(match[1]);
  for (const match of source.matchAll(/(?:states|events)\("[^"]+"(,\s*"([^"]+)"\s*)+\)/g)) {
    for (const arg of match[0].matchAll(/"([^"]+)"/g)) ids.add(arg[1]);
  }
  for (const match of source.matchAll(/matches\(\s*[^,]+,\s*"([^"]+)"/g)) {
    for (const token of match[1].split(".")) ids.add(token);
  }
  return ids;
}

function extractExports(file) {
  const source = read(file);
  const exports = new Set();
  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (const raw of match[1].split(",")) {
      let name = raw.trim().replace(/^type\s+/, "");
      name = name.split(" as ")[0].trim();
      if (name) exports.add(name);
    }
  }
  for (const match of source.matchAll(
    /export\s+(?:type\s+)?(?:class|function|const|interface|type)\s+(\w+)/g,
  )) {
    exports.add(match[1]);
  }
  return exports;
}

function extractImports(source) {
  const imports = new Map();
  for (const match of source.matchAll(/import\s+type\s*\{([^}]+)\}\s*from\s*"(@mantaq\/[^"]+)"/g)) {
    for (const name of splitImportNames(match[1])) {
      if (!imports.has(match[2])) imports.set(match[2], new Set());
      imports.get(match[2]).add(name);
    }
  }
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"(@mantaq\/[^"]+)"/g)) {
    for (const name of splitImportNames(match[1])) {
      if (!imports.has(match[2])) imports.set(match[2], new Set());
      imports.get(match[2]).add(name);
    }
  }
  return imports;
}

function splitImportNames(list) {
  return list
    .split(",")
    .map((s) => s.trim().replace(/^type\s+/, ""))
    .map((s) => s.split(" as ")[0].trim())
    .filter(Boolean);
}

console.log("docs:check");
console.log("");

// ── Gate A: example continuity ────────────────────────────────────────────
console.log("Gate A — example continuity");

const registry = new Set(BUILTIN_ALLOW);
for (const entityId of extractIds(read(EXAMPLE_TEST))) registry.add(entityId);
for (const entityId of extractIds(read(EXAMPLE_MDX))) registry.add(entityId);

function extractRegionKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(/regions\s*:\s*\{([^}]*)\}/g)) {
    for (const arg of match[1].matchAll(/(\w+)\s*:/g)) keys.add(arg[1]);
  }
  for (const match of source.matchAll(/regions\["(\w+)"\]/g)) keys.add(match[1]);
  return keys;
}

const pages = walkFiles(DOCS_DIR);
const narrative = pages.filter((p) => !p.includes("/reference/"));

let checkedPages = 0;
for (const page of narrative) {
  const source = read(page);
  const used = extractIds(source);
  const pageRegions = extractRegionKeys(source);
  const bad = [...used].filter((id) => !registry.has(id) && !pageRegions.has(id));
  checkedPages++;
  if (bad.length > 0) {
    fail(`${relative(ROOT, page)} — non-canonical IDs: ${bad.join(", ")}`);
  } else if (used.size > 0) {
    pass(`${relative(ROOT, page)} — ${[...used].sort().join(", ")}`);
  } else {
    pass(`${relative(ROOT, page)} — no entities`);
  }
}
if (checkedPages === 0) fail("no narrative docs pages found");

// ── Gate B: API truth ─────────────────────────────────────────────────────
console.log("Gate B — API truth");

const realExports = new Map();
for (const [pkg, indexFile] of PACKAGE_INDEX) {
  realExports.set(pkg, extractExports(indexFile));
}

let importViolations = 0;
for (const page of pages) {
  const imports = extractImports(read(page));
  for (const [pkg, names] of imports) {
    const valid = realExports.get(pkg);
    if (!valid) {
      fail(`${relative(ROOT, page)} — imports unknown package ${pkg}`);
      importViolations++;
      continue;
    }
    for (const name of names) {
      if (!valid.has(name)) {
        fail(`${relative(ROOT, page)} — ${pkg} does not export ${name}`);
        importViolations++;
      }
    }
  }
}
if (importViolations === 0) pass("all @mantaq/* imports match real exports");

// ── Gate C: canonical example typechecks ──────────────────────────────────
console.log("Gate C — canonical example typechecks");

const tsc = spawnSync("npx", ["tsc", "--noEmit"], {
  cwd: join(ROOT, "packages/examples"),
  encoding: "utf8",
});
if (tsc.status === 0) {
  pass("packages/examples typechecks");
} else {
  fail("packages/examples failed typecheck:\n" + tsc.stdout + tsc.stderr);
}

console.log("");
if (failures > 0) {
  console.error(`docs:check FAILED (${failures} violation${failures > 1 ? "s" : ""})`);
  process.exit(1);
}
console.log("docs:check PASSED");
