import assert from "node:assert/strict";
import { test } from "node:test";
import { extractBumpNames, findUnknownNames } from "./lib/bump-files.mjs";

const known = new Set(["@mantaq/test", "@mantaq/core"]);

test("extracts quoted and unquoted names, skips reserved keys and body", () => {
  const source =
    "---\n\"@mantaq/core\": minor\n'@mantaq/test': patch\nfoo: none\n$changelog: false\n---\n\nbar: baz\n";
  assert.deepEqual(extractBumpNames(source), ["@mantaq/core", "@mantaq/test", "foo"]);
});

test("returns names that are not workspace packages", () => {
  const source = '---\n"@mantaq/testkit": patch\n"@mantaq/core": patch\n---\n\nfix\n';
  assert.deepEqual(findUnknownNames({ source, known }), ["@mantaq/testkit"]);
});

test("returns nothing for empty or missing frontmatter", () => {
  assert.deepEqual(findUnknownNames({ source: "---\n---\n", known }), []);
  assert.deepEqual(findUnknownNames({ source: "no frontmatter", known }), []);
});

test("ignores a horizontal rule in the body after empty frontmatter", () => {
  assert.deepEqual(extractBumpNames("---\n---\n\nNote: x\n\n---\n"), []);
});
