import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openViz } from "./harness.ts";

const checkout = join(import.meta.dirname, "../../../apps/docs/src/content/docs/checkout.ts");

for (const height of [768, 720]) {
  test(`Send stays on screen for every event of the checkout at 1280x${height}`, async () => {
    const opened = await openViz({ file: checkout, viewport: { width: 1280, height } });
    const viz = Either.getRight(opened);
    if (viz === undefined) throw new Error(String(Either.getLeft(opened)));
    try {
      for (const event of ["submitBasicInfo", "submitShipping", "submitPayment"]) {
        const fits = await viz.sendFits(event);
        expect(Either.getRight(fits), `${event}: ${String(Either.getLeft(fits))}`).toEqual({
          inViewport: true,
        });
        expect(Either.getRight(await viz.send(event))?.outcome).toBe("transition");
      }
      expect(viz.problems()).toEqual([]);
    } finally {
      await viz.close();
    }
  }, 90_000);
}
