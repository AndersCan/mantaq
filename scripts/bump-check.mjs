#!/usr/bin/env node
/**
 * Bump-file gate. Bumpy silently ignores a .bumpy/*.md entry that names a
 * package that does not exist (e.g. "@mantaq/testkit" for "@mantaq/test"), so
 * the fix ships with no version bump and CI stays green. Fail on it instead.
 *
 * Run with `vp run bump:check`. Wired into the root `ready` script.
 */
import { findUnknownNames } from "./lib/bump-files.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const WORKSPACE_DIRS = ["apps", "packages", "tools"];

function workspaceNames() {
  const names = new Set();
  for (const group of WORKSPACE_DIRS) {
    let entries = [];
    try {
      entries = readdirSync(join(ROOT, group));
    } catch {
      continue;
    }
    for (const entry of entries) {
      try {
        const pkg = JSON.parse(readFileSync(join(ROOT, group, entry, "package.json"), "utf8"));
        if (typeof pkg.name === "string") names.add(pkg.name);
      } catch {
        continue;
      }
    }
  }
  return names;
}

const known = workspaceNames();
const bumpDir = join(ROOT, ".bumpy");
const failures = [];
for (const file of readdirSync(bumpDir)) {
  if (!file.endsWith(".md") || file === "README.md") continue;
  const source = readFileSync(join(bumpDir, file), "utf8");
  for (const name of findUnknownNames({ source, known })) {
    failures.push(`.bumpy/${file}: "${name}" is not a workspace package`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  const sorted = [...known];
  sorted.sort();
  console.error(`Known packages: ${sorted.join(", ")}`);
  process.exit(1);
}
console.log("bump:check ok");
