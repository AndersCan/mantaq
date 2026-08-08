#!/usr/bin/env node
/**
 * Vision guard — makes vision.md's north star executable.
 *
 * "If it typechecks, it runs correct" and "Forcing the compiler quiet = wrong
 * path" are enforced as machine checks, not taste:
 *
 *  1. Zero type escapes in packages/core/src: `as any`, `as unknown as`,
 *     `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`. A PR that adds one
 *     fails here, so "type = behavior" is not optional.
 *  2. Export surface stays small and internal. Nothing named `Internal*` may
 *     be public (except the allowlist: `InternalEvent` is the public event
 *     contract). Total surface is capped by BUDGET_EXPORTS.
 *  3. Every public export is hand-curated: each name must appear in
 *     packages/core/API.md, the human-written frozen contract. An export that
 *     is not documented is an unvetted API and fails the guard.
 *  4. Impl size has a ceiling, per file and per package. "Complexity in impl
 *     is a bug" now has a gradient instead of being taste.
 *  5. Determinism is a north star: the runtime never reads the wall clock,
 *     randomness, or performance timers. Only real-clock.ts may. "Same
 *     inputs, same trace, always."
 *
 * Run with `vp run guard`. Wired into the root `ready` script.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CORE_SRC = join(import.meta.dirname, "..", "packages", "core", "src");
const CLOCK_FILE = join(CORE_SRC, "real-clock.ts");

const BUDGET_TOTAL_LINES = 1100;
const BUDGET_FILE_LINES = 400;
const BUDGET_EXPORTS = 25;

const FORBIDDEN = [
  { name: "as any", pattern: /\bas any\b/g },
  { name: "as unknown as", pattern: /\bas unknown as\b/g },
  { name: "@ts-expect-error", pattern: /@ts-expect-error/g },
  { name: "@ts-ignore", pattern: /@ts-ignore/g },
  { name: "@ts-nocheck", pattern: /@ts-nocheck/g },
];

const ALLOWED_INTERNAL_EXPORTS = new Set(["InternalEvent"]);

const NONDETERMINISTIC = [
  { name: "Date.now", pattern: /Date\.now/g },
  { name: "Math.random", pattern: /Math\.random/g },
  { name: "performance.now", pattern: /performance\.now/g },
];

let failures = 0;
const fail = (msg) => {
  console.error(`guard: ${msg}`);
  failures++;
};

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (path.endsWith(".ts")) yield path;
  }
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const files = [...walk(CORE_SRC)];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const { name, pattern } of FORBIDDEN) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      fail(`${file}:${lineOf(text, match.index)} forbidden type escape "${name}"`);
    }
  }
  if (file === CLOCK_FILE) continue;
  for (const { name, pattern } of NONDETERMINISTIC) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      fail(
        `${file}:${lineOf(text, match.index)} nondeterministic source "${name}" — determinism is a north star; only real-clock.ts may read the wall clock`,
      );
    }
  }
}

const indexText = readFileSync(join(CORE_SRC, "index.ts"), "utf8");
const exported = new Set(
  [...indexText.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}/g)]
    .flatMap((m) => m[1].split(","))
    .map((s) =>
      s
        .trim()
        .split(/\s+as\s+/)[0]
        .trim(),
    )
    .filter(Boolean),
);
for (const name of exported) {
  if (name.startsWith("Internal") && !ALLOWED_INTERNAL_EXPORTS.has(name)) {
    fail(`public export "${name}" leaks internals; nothing Internal* may be public`);
  }
}
if (exported.size > BUDGET_EXPORTS) {
  fail(`export surface ${exported.size} exceeds budget ${BUDGET_EXPORTS}`);
}

const apiDocPath = join(import.meta.dirname, "..", "packages", "core", "API.md");
const apiDoc = readFileSync(apiDocPath, "utf8");
for (const name of exported) {
  if (!new RegExp(`\\b${name}\\b`).test(apiDoc)) {
    fail(`public export "${name}" is not documented in packages/core/API.md`);
  }
}

let total = 0;
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n").length;
  total += lines;
  if (lines > BUDGET_FILE_LINES) {
    fail(`${file}: ${lines} lines exceeds file ceiling ${BUDGET_FILE_LINES}`);
  }
}
if (total > BUDGET_TOTAL_LINES) {
  fail(`core/src total ${total} lines exceeds ceiling ${BUDGET_TOTAL_LINES}`);
}

if (failures > 0) {
  console.error(`\nvision-guard: ${failures} violation(s). The north star is a machine check.`);
  process.exit(1);
}
console.log(
  `vision-guard: pass — core is clean (${files.length} files, ${total} lines, ${exported.size} exports)`,
);
