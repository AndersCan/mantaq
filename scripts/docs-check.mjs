#!/usr/bin/env node
/**
 * Docs gates. Enforced by the docs-write skill.
 *
 * Gate A — Example continuity. Every state/event ID used in narrative docs
 *          pages exists in the canonical registry (checkout example).
 * Gate B — API truth. Every @mantaq/* import in docs is a real package export.
 * Gate C — Canonical example typechecks (packages/examples).
 * Gate D — README snippets typecheck. Every ```ts block in README.md and
 *          packages/<pkg>/README.md compiles against the workspace packages.
 *          Opt out (rare: intentionally partial snippets) with
 *          `<!-- docs-check: skip -->` on the line before the fence.
 *
 * Narrative pages: all of apps/docs/src/content/docs except reference/*.
 * Reference pages are exempt from Gate A but still checked by Gate B.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  extractExports,
  extractTsBlocks,
  extractIds,
  extractImports,
  read,
  walkFiles,
} from "./lib/docs-extract.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const DOCS_DIR = join(ROOT, "apps/docs/src/content/docs");
const EXAMPLE_TEST = join(ROOT, "packages/examples/checkout.test.ts");
const EXAMPLE_MDX = join(ROOT, "docs/canonical-example.mdx");
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
  ["@mantaq/inspect", join(ROOT, "packages/inspect/src/index.ts")],
  ["@mantaq/inspect/vite", join(ROOT, "packages/inspect/src/vite.ts")],
  ["@mantaq/inspect/astro", join(ROOT, "packages/inspect/src/astro.ts")],
  ["@mantaq/viz", join(ROOT, "packages/viz/src/index.ts")],
]);

let failures = 0;

function fail(message) {
  failures++;
  console.error(`  ✗ ${message}`);
}

function pass(message) {
  console.log(`  ✓ ${message}`);
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

// ── Gate D: README snippets typecheck ─────────────────────────────────────
console.log("Gate D — README snippets typecheck");

const SNIPPET_DIR = join(ROOT, "node_modules/.cache/mantaq-readme-snippets");
rmSync(SNIPPET_DIR, { recursive: true, force: true });
mkdirSync(join(SNIPPET_DIR, "node_modules/@mantaq"), { recursive: true });
mkdirSync(join(SNIPPET_DIR, "node_modules/@types"), { recursive: true });

const readmes = [join(ROOT, "README.md")];
for (const dir of readdirSync(join(ROOT, "packages"))) {
  const pkgDir = join(ROOT, "packages", dir);
  const pkgJson = join(pkgDir, "package.json");
  if (!existsSync(pkgJson)) continue;
  const name = JSON.parse(read(pkgJson)).name;
  if (name?.startsWith("@mantaq/")) {
    symlinkSync(pkgDir, join(SNIPPET_DIR, "node_modules", name), "dir");
  }
  if (existsSync(join(pkgDir, "README.md"))) readmes.push(join(pkgDir, "README.md"));
}
// Third-party modules README snippets import, borrowed from the package that depends on them.
for (const [module, owner] of [
  ["vitest", "core"],
  ["vite", "core"],
  ["@types/node", "core"],
  ["lit-html", "lit"],
]) {
  const target = join(ROOT, "packages", owner, "node_modules", module);
  symlinkSync(target, join(SNIPPET_DIR, "node_modules", module), "dir");
}

const snippetOrigin = new Map();
let skipped = 0;
for (const readme of readmes) {
  const slug = relative(ROOT, readme).replace(/[^\w]+/g, "_");
  for (const block of extractTsBlocks(read(readme))) {
    if (block.skip) {
      skipped++;
      continue;
    }
    const file = `${slug}__L${block.line}.ts`;
    snippetOrigin.set(file, `${relative(ROOT, readme)}:${block.line}`);
    writeFileSync(join(SNIPPET_DIR, file), block.code + "\n");
  }
}
writeFileSync(join(SNIPPET_DIR, "package.json"), JSON.stringify({ type: "module" }));
writeFileSync(
  join(SNIPPET_DIR, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      target: "esnext",
      lib: ["es2023", "dom", "dom.iterable"],
      moduleDetection: "force",
      module: "nodenext",
      moduleResolution: "nodenext",
      types: ["node", "vite/client"],
      strict: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      isolatedModules: true,
      verbatimModuleSyntax: true,
      skipLibCheck: true,
    },
    include: ["*.ts"],
  }),
);

const snippetTsc = spawnSync(
  join(ROOT, "packages/examples/node_modules/.bin/tsc"),
  ["-p", SNIPPET_DIR, "--pretty", "false"],
  { encoding: "utf8" },
);
if (snippetTsc.status === 0) {
  pass(`${snippetOrigin.size} README snippets typecheck (${skipped} opted out)`);
} else {
  const output = (snippetTsc.stdout + snippetTsc.stderr).replace(
    /(?:[^\s(]*\/)?(?<file>\w+__L(?<blockLine>\d+)\.ts)\((?<line>\d+),(?<col>\d+)\)/g,
    (...match) => {
      const { file, blockLine, line, col } = match.at(-1);
      const origin = snippetOrigin.get(file) ?? file;
      const readmeLine = Number(blockLine) + Number(line);
      return `${origin.split(":")[0]}:${readmeLine}:${col} (block at line ${blockLine})`;
    },
  );
  fail("README snippets failed typecheck:\n" + output);
}

console.log("");
if (failures > 0) {
  console.error(`docs:check FAILED (${failures} violation${failures > 1 ? "s" : ""})`);
  process.exit(1);
}
console.log("docs:check PASSED");
