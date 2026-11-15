import { toViz } from "@mantaq/inspect";
import { expect, test } from "vite-plus/test";
import { checkout } from "./checkout.ts";

const file = new URL(
  "../../../../../packages/viz/src/viewer/reference/docs-checkout.json",
  import.meta.url,
).pathname;

test("writes the docs home checkout machine the layout checks read", async () => {
  const viz = toViz([{ id: "checkout", actor: checkout }]);
  await expect(`${JSON.stringify(viz.machines[0], undefined, 2)}\n`).toMatchFileSnapshot(file);
});
