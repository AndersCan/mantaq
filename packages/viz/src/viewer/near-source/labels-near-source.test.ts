import { edgeOf, machineOf, stateOf } from "../groups/shop-machines.ts";
import { expect, test } from "vite-plus/test";
import { Either } from "@mantaq/utils";
import { layoutMachine } from "../layout.ts";

/** A wizard whose `cancel` arrow runs past two states to the end, and whose `restart` arrow runs back past them to the start. */
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
    edgeOf("paying", { event: "restart", to: "filling" }),
  ],
});

interface Across {
  left: number;
  right: number;
}

/** Where `box` spans along x. */
function acrossOf(box: { x: number; width: number } | undefined): Across {
  const centre = box?.x ?? 0;
  const half = (box?.width ?? 0) / 2;
  return { left: centre - half, right: centre + half };
}

test("the label of a long arrow sits beside the state it leaves, either way it runs, clear of everything", () => {
  const laid = Either.getRight(layoutMachine(wizard));
  const nodes = new Map<string, Across>();
  for (const node of laid?.layout.nodes ?? []) nodes.set(node.id, acrossOf(node));
  const labels = new Map<string, Across>();
  for (const placed of laid?.layout.edges ?? [])
    labels.set(placed.edge.event, acrossOf(placed.label));
  const cancel = labels.get("cancel");
  const restart = labels.get("restart");
  const fillingRight = nodes.get("filling")?.right ?? 0;
  const payingLeft = nodes.get("paying")?.left ?? 0;
  expect({
    overlaps: laid?.overlaps,
    cancel:
      (cancel?.left ?? 0) > fillingRight &&
      (cancel?.left ?? 0) < (nodes.get("checking")?.left ?? 0),
    restart:
      (restart?.right ?? 0) < payingLeft &&
      (restart?.right ?? 0) > (nodes.get("checking")?.right ?? 0),
  }).toEqual({ overlaps: [], cancel: true, restart: true });
});
