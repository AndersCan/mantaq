import { edgeOf, machineOf, stateOf } from "../groups/shop-machines.ts";
import { expect, test } from "vite-plus/test";
import { Either } from "@mantaq/utils";
import { layoutMachine } from "../layout.ts";

/** A wizard whose `cancel` arrow runs past two states to the end. */
const wizard = machineOf({
  states: [
    stateOf("filling", { initial: true }),
    stateOf("checking"),
    stateOf("paying"),
    stateOf("cancelled", { final: true }),
  ],
  edges: [
    edgeOf("__initial__", { event: "", to: "filling", kind: "initial" }),
    edgeOf("filling", { event: "submit", to: "checking" }),
    edgeOf("checking", { event: "accept", to: "paying" }),
    edgeOf("paying", { event: "pay", to: "cancelled" }),
    edgeOf("filling", { event: "cancel", to: "cancelled" }),
  ],
});

test("the label of a long arrow sits beside the state it leaves, clear of everything", () => {
  const laid = Either.getRight(layoutMachine(wizard));
  const nodes = new Map<string, { x: number; width: number }>();
  for (const node of laid?.layout.nodes ?? []) nodes.set(node.id, node);
  const cancel = laid?.layout.edges.find((placed) => placed.edge.event === "cancel");
  const filling = nodes.get("filling");
  const checking = nodes.get("checking");
  const labelLeft = (cancel?.label.x ?? 0) - (cancel?.label.width ?? 0) / 2;
  const fillingRight = (filling?.x ?? 0) + (filling?.width ?? 0) / 2;
  const checkingLeft = (checking?.x ?? 0) - (checking?.width ?? 0) / 2;
  expect({
    overlaps: laid?.overlaps,
    beside: labelLeft > fillingRight && labelLeft < checkingLeft,
  }).toEqual({ overlaps: [], beside: true });
});
