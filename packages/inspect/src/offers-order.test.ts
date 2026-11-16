import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openViz } from "./harness.ts";

test("a Left lists the offered events by name, across input and internal", async () => {
  const opened = await openViz({ file: join(import.meta.dirname, "fixtures/offers-order.ts") });
  const viz = Either.getRight(opened);
  if (viz === undefined) throw new Error(String(Either.getLeft(opened)));
  try {
    expect(Either.getLeft(await viz.send("nothing"))).toBe(
      "no button for nothing: offersOrder is in idle, which offers: apply, zap.",
    );
  } finally {
    await viz.close();
  }
}, 60_000);
