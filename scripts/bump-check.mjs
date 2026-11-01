#!/usr/bin/env node
/**
 * Bump-file gate. Bumpy silently ignores a .bumpy/*.md entry that names a
 * package that does not exist (e.g. "@mantaq/testkit" for "@mantaq/test"), so
 * the fix ships with no version bump and CI stays green. Fail on it instead.
 *
 * Run with `vp run bump:check`. Wired into the root `ready` script.
 */
import { findUnknownNames } from "./lib/bump-files.mjs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function workspaceGroups() {
  const yaml = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  const section = /^packages:\s*\n((?:[ \t]+-.*\n?)+)/m.exec(yaml);
  if (section === null) throw new Error("pnpm-workspace.yaml: no packages list found");
  const groups = [];
  for (const line of section[1].split("\n")) {
    if (line.trim() === "") continue;
    const glob = line
      .replace(/^\s*-\s*/, "")
      .replace(/["']/g, "")
      .trim();
    const match = /^([\w.-]+)\/\*$/.exec(glob);
    if (match === null)
      throw new Error(`pnpm-workspace.yaml: unsupported glob "${glob}" (only "dir/*")`);
    groups.push(match[1]);
  }
  return groups;
}

function workspaceNames() {
  const names = new Set();
  for (const group of workspaceGroups()) {
    const dir = join(ROOT, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const file = join(dir, entry, "package.json");
      if (!existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, "utf8"));
      if (typeof pkg.name === "string") names.add(pkg.name);
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
