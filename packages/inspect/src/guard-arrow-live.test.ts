// @vitest-environment happy-dom
import { VirtualClock } from "@mantaq/core";
import { renderGraph } from "../../viz/src/viewer/graph.ts";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { createOrder6 } from "../../../apps/docs/src/tutorial/order-06.ts";
import { inspectModule } from "./index.ts";

const file = join(import.meta.dirname, "../../../apps/docs/src/tutorial/order-06.ts");

describe("Getting started step 6", () => {
  test("one pay arrow says when it reaches payment, and no fuzz loop is drawn", async () => {
    const inspected = await inspectModule(file, {
      load: async () => ({ createOrder6: () => createOrder6(VirtualClock()) }),
    });
    const machine = inspected.machines[0];
    expect(machine).toBeDefined();
    if (machine === undefined) return;
    const graph = renderGraph(document, machine, {
      select: () => undefined,
      showDetails: () => undefined,
      mode: "off",
    });
    const pay = graph.querySelector('g.edge[data-edge-id="cart-pay-payment"]');
    expect(pay?.querySelector(".edge-condition")?.textContent).toBe('email !== "" && items !== 0');
    expect(graph.querySelectorAll("g.edge.fuzz")).toHaveLength(0);
  });
});
