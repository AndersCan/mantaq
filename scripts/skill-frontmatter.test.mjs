import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkFrontmatter } from "./lib/skill-frontmatter.mjs";

test("the real SKILL.md frontmatter is valid", () => {
  const file = join(import.meta.dirname, "..", "skills", "mantaq", "SKILL.md");
  assert.deepEqual(checkFrontmatter(readFileSync(file, "utf8")), []);
});

test("an unquoted ': ' in description fails", () => {
  const source = "---\nname: x\ndescription: Does things: badly\n---\n\nbody\n";
  const problems = checkFrontmatter(source);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^YAML: /);
});

test("folded and quoted descriptions pass", () => {
  assert.deepEqual(checkFrontmatter("---\nname: x\ndescription: >-\n  a: b\n---\n"), []);
  assert.deepEqual(checkFrontmatter("---\nname: x\ndescription: 'a: b'\n---\n"), []);
});

test("missing or non-string name/description fail", () => {
  assert.equal(checkFrontmatter("---\nname: x\n---\n").length, 1);
  assert.equal(checkFrontmatter("---\nname: 5\ndescription: d\n---\n").length, 1);
});

test("missing frontmatter fails", () => {
  assert.deepEqual(checkFrontmatter("# hi\n"), ["no frontmatter block"]);
});
