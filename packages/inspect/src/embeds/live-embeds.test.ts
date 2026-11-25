import { Actor, event, machine, state, VirtualClock } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";
import { createDriver } from "../drive.ts";
import { delivery } from "../fixtures/embedded/delivery.ts";
import { embed } from "@mantaq/sugar";
import type { FuzzTarget } from "../fuzz/run.ts";
import type { Snapshot } from "@mantaq/core";
import { toVizMachine } from "../structure.ts";

const deliveryTarget: FuzzTarget = {
  id: "delivery",
  create: () => {
    const clock = VirtualClock();
    return { actor: delivery.create({ clock }), clock };
  },
};

const scanning = { machine: "scan", forward: ["misread"] };

const drafting = state("drafting")();
const printing = state("printing")();
const print = event("print")();

/** How many times the label's printer ran. */
interface Printed {
  runs: number;
}

/** A label that prints once it is told to; its printer counts each run. */
function labelMachine(printed: Printed) {
  return machine("label", {
    create: ({ clock }) =>
      Actor({
        inputs: [print],
        states: [drafting, printing],
        initial: drafting,
        clock,
        setup: (builder) => {
          builder.on(drafting, {
            event: print,
            to: [printing],
            handler: () => ({ state: printing }),
          });
          builder.effect(printing, {
            name: "printer",
            fn: () => {
              printed.runs += 1;
            },
          });
        },
      }),
  });
}

const idle = state("idle")();
const shipping = state("shipping")();
const start = event("start")();
const labelDone = event("labelDone")();
const labelBroke = event("labelBroke")();
const labelChanged = event("labelChanged")<Snapshot>();

interface ShipmentContext {
  label: Snapshot | undefined;
}

const noLabel: ShipmentContext = { label: undefined };

interface ShipmentOptions {
  printed: Printed;
  keep: "label" | "none";
}

/** A shipment that runs the label while it ships, and forwards print to it. */
function shipmentTarget(options: ShipmentOptions): FuzzTarget {
  const label = labelMachine(options.printed);
  return {
    id: "shipment",
    create: () => {
      const clock = VirtualClock();
      const actor = Actor({
        inputs: [start, print],
        internal: [labelDone, labelBroke, labelChanged],
        states: [idle, shipping],
        initial: idle,
        context: noLabel,
        clock,
        setup: (builder) => {
          builder.on(idle, { event: start, to: [shipping], handler: () => ({ state: shipping }) });
          const endings = {
            machine: label,
            done: {},
            error: labelBroke,
            forward: [print],
          } as const;
          if (options.keep === "label") {
            embed(builder, { in: shipping, ...endings, snapshot: labelChanged, keep: "label" });
          } else embed(builder, { in: shipping, ...endings, snapshot: labelChanged });
          builder.on(shipping, {
            event: labelChanged,
            handler: (changed, { context }) => context.set({ label: changed.payload }),
          });
        },
      });
      return { actor, clock };
    },
  };
}

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

  test("in held mode a child's later effects are held, and in real mode they run", () => {
    function printerRuns(effectMode: "held" | "real") {
      const printed = { runs: 0 };
      const driver = createDriver(shipmentTarget({ printed, keep: "label" }), { effectMode });
      driver.reset();
      driver.step({ kind: "event", event: "start", payload: null });
      const live = driver.step({ kind: "event", event: "print", payload: null });
      driver.dryRun?.([{ kind: "event", event: "start", payload: null }]);
      return { runs: printed.runs, embeds: live.embeds, waiting: live.waiting };
    }
    const shown = { state: "shipping", machine: "label", forward: ["print"], current: "printing" };
    expect({ held: printerRuns("held"), real: printerRuns("real") }).toEqual({
      held: { runs: 0, embeds: [shown], waiting: ["printer"] },
      real: { runs: 1, embeds: [shown], waiting: [] },
    });
  });

  test("an embed without keep is reported without the child's state", () => {
    const driver = createDriver(shipmentTarget({ printed: { runs: 0 }, keep: "none" }));
    driver.reset();
    const live = driver.step({ kind: "event", event: "start", payload: null });
    expect(live.embeds).toEqual([{ state: "shipping", machine: "label", forward: ["print"] }]);
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
