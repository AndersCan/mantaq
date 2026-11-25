import { describe, expect, test } from "vite-plus/test";
import { createDriver } from "../drive.ts";
import { delivery } from "../fixtures/embedded/delivery.ts";
import type { FuzzTarget } from "../fuzz/run.ts";
import { toVizMachine } from "../structure.ts";
import { VirtualClock } from "@mantaq/core";

const deliveryTarget: FuzzTarget = {
  id: "delivery",
  create: () => {
    const clock = VirtualClock();
    return { actor: delivery.create({ clock }), clock };
  },
};

const scanning = { machine: "scan", forward: ["misread"] };

describe("running embeds in the driver", () => {
  test("the first state's scan runs from the start and a forwarded input moves it", () => {
    const driver = createDriver(deliveryTarget);
    const started = driver.reset();
    const misread = driver.step({ kind: "event", event: "misread", payload: null });
    expect({
      started: [started.effectMode, started.embeds],
      misread: [misread.state, misread.last?.event, misread.embeds],
      after: misread.after.map((entry) => [entry.event, entry.to]),
    }).toEqual({
      started: ["held", [{ state: "pickingUp", ...scanning, current: "reading" }]],
      misread: ["returned", "misread", []],
      after: [
        ["scanChanged", "pickingUp"],
        ["scanFailed", "returned"],
      ],
    });
  });

  test("a state entered later builds its scan with effects held, and the scan's timer runs on the clock", () => {
    const driver = createDriver(deliveryTarget);
    driver.reset();
    const onTheWay = driver.step({ kind: "advance", ms: 100 });
    const handingOver = driver.step({ kind: "event", event: "arrive", payload: null });
    const delivered = driver.step({ kind: "advance", ms: 100 });
    expect({
      onTheWay: [onTheWay.state, onTheWay.embeds],
      handingOver: [handingOver.state, handingOver.embeds, handingOver.timers.length],
      delivered: delivered.state,
    }).toEqual({
      onTheWay: ["onTheWay", []],
      handingOver: ["handingOver", [{ state: "handingOver", ...scanning, current: "reading" }], 1],
      delivered: "delivered",
    });
  });

  test("a forwarded input is drawn as a stay arrow on each embedding state", () => {
    const { edges } = toVizMachine({
      id: "delivery",
      actor: delivery.create({ clock: VirtualClock() }),
    });
    const forwarded = edges.filter((edge) => edge.event === "misread");
    expect(forwarded.map((edge) => [edge.from, edge.to, edge.kind, edge.origin])).toEqual([
      ["handingOver", "handingOver", "stay", "declared"],
      ["pickingUp", "pickingUp", "stay", "declared"],
    ]);
  });
});
