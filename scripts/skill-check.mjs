#!/usr/bin/env node
/**
 * Skill version gate. `skills/mantaq/SKILL.md` stamps the package versions it
 * was written against ("Written against: `@mantaq/core` 0.6, ..."). Installed
 * skills compare that stamp with node_modules, so a stale stamp tells agents
 * the skill is out of date when it is not, or the reverse. Fail when any
 * stamp in skills/mantaq/*.md differs in major.minor from the workspace
 * package, names an unknown package, or SKILL.md has no stamp.
 *
 * A `bumpy version` PR that bumps a minor fails here until the stamp is
 * updated, so review the skill in the same PR.
 *
 * Also parses the frontmatter of every skill's SKILL.md as strict YAML, so
 * `npx skills add` never meets a parse error.
 *
 * Run with `vp run docs:check`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkFrontmatter } from "./lib/skill-frontmatter.mjs";

const ROOT = join(import.meta.dirname, "..");
const SKILL_DIR = join(ROOT, "skills", "mantaq");

const versions = new Map();
for (const entry of readdirSync(join(ROOT, "packages"))) {
  const file = join(ROOT, "packages", entry, "package.json");
  if (!existsSync(file)) continue;
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  if (pkg.private !== true) versions.set(pkg.name, pkg.version);
}

const failures = [];
for (const dir of readdirSync(join(ROOT, "skills"))) {
  const file = join(ROOT, "skills", dir, "SKILL.md");
  if (!existsSync(file)) continue;
  for (const problem of checkFrontmatter(readFileSync(file, "utf8"))) {
    failures.push(`skills/${dir}/SKILL.md: ${problem}`);
  }
}
let skillStamped = false;
for (const name of readdirSync(SKILL_DIR)) {
  if (!name.endsWith(".md")) continue;
  const lines = readFileSync(join(SKILL_DIR, name), "utf8").split("\n");
  lines.forEach((line, index) => {
    if (!/written against/i.test(line)) return;
    const where = `skills/mantaq/${name}:${index + 1}`;
    const stamps = [...line.matchAll(/`(@mantaq\/[\w-]+)`\s+(\d+)\.(\d+)/g)];
    if (stamps.length === 0) return;
    if (name === "SKILL.md") skillStamped = true;
    for (const [, pkg, major, minor] of stamps) {
      const actual = versions.get(pkg);
      if (actual === undefined) {
        failures.push(`${where}: ${pkg} is not a published workspace package`);
        continue;
      }
      const [wantMajor, wantMinor] = actual.split(".");
      if (major !== wantMajor || minor !== wantMinor) {
        failures.push(`${where}: ${pkg} stamped ${major}.${minor}, workspace has ${actual}`);
      }
    }
  });
}
if (!skillStamped) failures.push("skills/mantaq/SKILL.md: no 'Written against' version stamp");

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("skill:check ok");
