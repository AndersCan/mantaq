// apps/docs/src/visualizer-legend.test.ts
// The checkout diagram on guides/visualizer shows an effect chip (`chargeCard` inside `submitting`).
// The page's tables say "Faint self-loop" = effects (chips replaced loops in #350).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

const page = readFileSync(join(import.meta.dirname, "content/docs/guides/visualizer.mdx"), "utf8");

test("the visualizer page names the effect chip, not a faint self-loop", () => {
  expect(page).not.toMatch(/Faint self-loop/);
  expect(page).toMatch(/chargeCard/);
});

test("the page says a click on an arrow sends and a ? opens Details", () => {
  expect(page).toMatch(/`\?` beside a label/);
  expect(page).not.toMatch(/it never takes a step/);
});
