import { expect, test } from "vite-plus/test";
import { Either } from "@mantaq/utils";
import { join } from "node:path";
import { openViz } from "../harness.ts";

test("regions() and sendTo read the state inside a folded group of a region", async () => {
  const opened = await openViz({
    file: join(import.meta.dirname, "../fixtures/grouped-region.ts"),
  });
  const viz = Either.getRight(opened);
  if (viz === undefined) throw new Error(String(Either.getLeft(opened)));
  try {
    const order = { region: "order" };
    const start = await viz.regions();
    const checkout = Either.getLeft(await viz.sendTo(order, "checkout"));
    const charging = await viz.regions();
    const charged = Either.getLeft(await viz.sendTo(order, "charged"));
    const confirming = await viz.regions();
    const confirmed = Either.getLeft(await viz.sendTo(order, "confirmed"));
    const paid = await viz.regions();
    expect({ start, checkout, charging, charged, confirming, confirmed, paid }).toEqual({
      start: { order: "inCart" },
      checkout: undefined,
      charging: { order: "chargingCard" },
      charged: undefined,
      confirming: { order: "confirming" },
      confirmed: undefined,
      paid: { order: "paid" },
    });
  } finally {
    await viz.close();
  }
}, 60_000);
