import { expect, test } from "vite-plus/test";
import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { openViz } from "../harness.ts";

test("the harness sends from a folded group node: into a group, inside it and out", async () => {
  const opened = await openViz({ file: join(import.meta.dirname, "../fixtures/grouped.ts") });
  const viz = Either.getRight(opened);
  if (viz === undefined) throw new Error(String(Either.getLeft(opened)));
  try {
    const checkout = await viz.send("checkout");
    const charged = await viz.send("charged");
    const confirmed = await viz.send("confirmed");
    const steps = [checkout, charged, confirmed];
    expect(steps.map((step) => Either.getRight(step))).toEqual([
      { state: "chargingCard", outcome: "transition" },
      { state: "confirming", outcome: "transition" },
      { state: "packing", outcome: "transition" },
    ]);
  } finally {
    await viz.close();
  }
}, 60_000);
