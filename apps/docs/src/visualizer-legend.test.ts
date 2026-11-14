// apps/docs/src/visualizer-legend.test.ts
// The checkout diagram on guides/visualizer shows a dashed box (class `reachable`: the state a
// next step reaches) and an effect chip (`chargeCard` inside `submitting`). The page's tables
// say "Dashed box `*`" = onAny and "Faint self-loop" = effects (chips replaced loops in #350).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

const page = readFileSync(join(import.meta.dirname, "content/docs/guides/visualizer.mdx"), "utf8");

test("the visualizer page names the effect chip, not a faint self-loop", () => {
  expect(page).not.toMatch(/Faint self-loop/);
  expect(page).toMatch(/chargeCard/);
});

test("the visualizer page names the dashed box a next step reaches", () => {
  expect(page).toMatch(/\| *Dashed box[^|`]*\| *[^|]*(next|reach)/i);
});
