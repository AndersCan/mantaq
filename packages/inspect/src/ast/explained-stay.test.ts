import { VirtualClock } from "@mantaq/core";
import type { VizEdge, VizMachine } from "@mantaq/viz";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { createOrder6 } from "../../../../apps/docs/src/tutorial/order-06.ts";
import { EXAMPLE_ROOT } from "../examples.ts";
import { createCreditActor } from "../fixtures/credit.ts";
import { toVizMachine } from "../structure.ts";
import { annotateMachine } from "./annotate.ts";

const ORDER = {
  file: join(EXAMPLE_ROOT, "apps/docs/src/tutorial/order-06.ts"),
  root: EXAMPLE_ROOT,
};

function fuzzStay(
  machine: VizMachine,
  from: string,
  event: string,
  kind: VizEdge["kind"] = "stay",
): VizMachine {
  const declared = machine.edges.find((edge) => edge.from === from && edge.event === event);
  const added: VizEdge = {
    ...(declared as VizEdge),
    id: `fuzz:${from}-${event}-stay`,
    to: from,
    kind,
    origin: "fuzz",
  };
  return { ...machine, edges: [...machine.edges, added] };
}

const order = () => toVizMachine({ id: "order", actor: createOrder6(VirtualClock()) as never });

describe("a fuzz stay the handler explains", () => {
  test("is dropped, and the declared edge keeps its three branches", () => {
    const machine = annotateMachine(fuzzStay(order(), "cart", "pay"), ORDER);
    expect(machine.edges.filter((edge) => edge.origin === "fuzz")).toEqual([]);
    const pay = machine.edges.find((edge) => edge.id === "cart-pay-payment");
    expect(pay?.explanation?.status === "analyzed" && pay.explanation.branches).toHaveLength(3);
  });

  test("stays when the handler has no stay branch", () => {
    const machine = annotateMachine(fuzzStay(order(), "payment", "confirm"), ORDER);
    expect(machine.edges.filter((edge) => edge.origin === "fuzz")).toHaveLength(1);
  });

  test("stays when it is a fuzz transition, not a stay", () => {
    const machine = annotateMachine(fuzzStay(order(), "cart", "pay", "transition"), ORDER);
    expect(machine.edges.filter((edge) => edge.origin === "fuzz")).toHaveLength(1);
  });

  test("stays when the handler is not found in the source", () => {
    const credit = toVizMachine({ id: "credit", actor: createCreditActor() });
    const first = credit.edges.find((edge) => edge.kind === "transition") as VizEdge;
    const machine = annotateMachine(fuzzStay(credit, first.from, first.event), ORDER);
    expect(machine.edges.filter((edge) => edge.origin === "fuzz")).toHaveLength(1);
  });

  test("stays when the source cannot be analyzed", () => {
    const credit = toVizMachine({ id: "credit", actor: createCreditActor() });
    const first = credit.edges.find((edge) => edge.kind === "transition") as VizEdge;
    const machine = annotateMachine(fuzzStay(credit, first.from, first.event), {
      file: join(EXAMPLE_ROOT, "packages/inspect/src/fixtures/does-not-exist.ts"),
      root: EXAMPLE_ROOT,
    });
    expect(machine.edges.filter((edge) => edge.origin === "fuzz")).toHaveLength(1);
  });
});
