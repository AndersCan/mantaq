// Chromium check lives in the inspect probe; this pins the CSS rule the plan names:
// "Pink when the walk's current state is one of its sources".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

test("a current shared node is drawn in the accent colour", () => {
  const css = readFileSync(join(import.meta.dirname, "viewer.css"), "utf8");
  expect(css).toMatch(/\.any-node\.current rect\s*\{[^}]*stroke:\s*var\(--accent\)/);
});

test("a shared node whose member is selected is drawn in the select colour", () => {
  const css = readFileSync(join(import.meta.dirname, "viewer.css"), "utf8");
  expect(css).toMatch(/\.any-node\.selected rect\s*[,{][^}]*stroke:\s*var\(--select\)/);
});
