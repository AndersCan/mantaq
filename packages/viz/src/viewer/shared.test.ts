import { describe, expect, test } from "vite-plus/test";
import reference from "./reference/justus-whole-app.json" with { type: "json" };
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { isSharedNode, shareArrows } from "./shared.ts";
import { foldGroups } from "./groups/fold-groups.ts";
import { groupedCheckout } from "./groups/shop-machines.ts";

const stateOf = (id: string, final = false): VizState => ({
  id,
  label: id,
  region: null,
  initial: false,
  final,
  effects: [],
  coverage: null,
  tested: null,
  doc: null,
});

function edgeOf(from: string, event: string, to: string): VizEdge {
  return {
    id: `${from}-${event}-${to}`,
    from,
    event,
    to,
    kind: "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: null,
    doc: null,
    coverage: null,
    tested: null,
  };
}

function machineOf(states: VizState[], edges: VizEdge[]): VizMachine {
  return {
    id: "m",
    initial: states[0]?.id ?? null,
    regions: [],
    maps: [],
    actors: [],
    states,
    events: [],
    outputs: [],
    partOutputs: {},
    context: null,
    edges,
    fuzz: null,
    runs: [],
  };
}

const names = (...ids: string[]) => ids.map((id) => stateOf(id));

describe("shareArrows", () => {
  test("an event every non-final state leaves alike is one arrow from `any state`", () => {
    const m = machineOf(
      [...names("a", "b", "c"), stateOf("done", true)],
      ["a", "b", "c"].map((from) => edgeOf(from, "go", "done")),
    );
    const shared = shareArrows(m);
    expect({
      nodes: shared.nodes,
      arrows: shared.arrows.map((arrow) => arrow.members.map((edge) => edge.id)),
      from: shared.edges.map((edge) => edge.from),
    }).toEqual({
      nodes: [
        {
          id: "*",
          scope: "",
          states: ["a", "b", "c"],
          walked: ["a", "b", "c"],
          label: "any state",
        },
      ],
      arrows: [["a-go-done", "b-go-done", "c-go-done"]],
      from: ["*"],
    });
  });

  test("a shared node reads the count of its states", () => {
    const three = shareArrows(
      machineOf(
        names("a", "b", "c", "d"),
        ["a", "b", "c"].map((from) => edgeOf(from, "go", "d")),
      ),
    );
    expect(three.nodes.map((node) => [node.id, node.label])).toEqual([["*1", "3 states"]]);
    const four = shareArrows(
      machineOf(
        names("a", "b", "c", "d", "e"),
        ["a", "b", "c", "d"].map((from) => edgeOf(from, "go", "e")),
      ),
    );
    expect(four.nodes.map((node) => [node.id, node.label])).toEqual([["*1", "4 states"]]);
    expect(isSharedNode("*1")).toBe(true);
    expect(isSharedNode("r.*12")).toBe(true);
    expect(isSharedNode("*")).toBe(false);
    expect(isSharedNode("x*1")).toBe(false);
  });

  test("an undetermined target is not shared", () => {
    const m = machineOf(
      names("a", "b", "c", "d"),
      ["a", "b", "c"].map((from) => ({ ...edgeOf(from, "go", "d"), to: null })),
    );
    expect(shareArrows(m).arrows).toEqual([]);
  });

  test("an event with two targets is two arrows, each with every source", () => {
    const m = machineOf(
      names("a", "b", "c", "x", "y"),
      ["a", "b", "c"].flatMap((from) => [edgeOf(from, "go", "x"), edgeOf(from, "go", "y")]),
    );
    const shared = shareArrows(m);
    expect(shared.arrows.map((arrow) => [arrow.id, arrow.members.length, arrow.drawn.to])).toEqual([
      ["shared:*1>go#0", 3, "x"],
      ["shared:*1>go#1", 3, "y"],
    ]);
    expect(shared.edges.map((edge) => edge.id)).toEqual(["shared:*1>go#0", "shared:*1>go#1"]);
  });

  test("the justus whole-app reference draws 420 edges, 55 of them shared", () => {
    const join = reference as unknown as VizMachine;
    const shared = shareArrows(join);
    expect(join.edges).toHaveLength(801);
    expect(shared.edges).toHaveLength(420);
    expect(shared.arrows).toHaveLength(55);
    const labels = shared.nodes.filter((node) => node.scope === "join").map((node) => node.label);
    expect(labels.sort()).toEqual(["14 states", "3 states", "3 states", "4 states"]);
  });

  test("on a fold, a group node only some of whose states take the event reads its count, and stands for those states", () => {
    const shop = groupedCheckout();
    const edges = [...shop.edges];
    for (const from of ["inCart", "chargingCard", "packing"]) {
      edges.push(edgeOf(from, "abort", "inCart"));
    }
    const partly = foldGroups({ ...shop, edges });
    const every = [...edges, edgeOf("confirming", "abort", "inCart")];
    const whole = foldGroups({ ...shop, edges: every });
    function node(machine: VizMachine) {
      const [first] = shareArrows(machine).nodes;
      return { label: first?.label, walked: first?.walked };
    }
    expect({ partly: node(partly), whole: node(whole) }).toEqual({
      partly: { label: "3 states", walked: ["inCart", "chargingCard", "packing"] },
      whole: {
        label: "any state",
        walked: ["inCart", "chargingCard", "confirming", "packing"],
      },
    });
  });

  test("on a fold, two events the same states take are one shared node, in any edge order", () => {
    const shop = groupedCheckout();
    const charging = shop.states.find((state) => state.id === "chargingCard");
    const states =
      charging === undefined ? shop.states : [...shop.states, { ...charging, id: "retrying" }];
    const abort = ["inCart", "chargingCard", "retrying", "packing"];
    const cancel = ["inCart", "retrying", "chargingCard", "packing"];
    const edges = [
      ...shop.edges,
      ...abort.map((from) => edgeOf(from, "abort", "inCart")),
      ...cancel.map((from) => edgeOf(from, "cancel", "inCart")),
    ];
    const nodes = shareArrows(foldGroups({ ...shop, states, edges })).nodes;
    expect(nodes.map((node) => [node.label, node.walked.length])).toEqual([["3 states", 4]]);
  });
});
