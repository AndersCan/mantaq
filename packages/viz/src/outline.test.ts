import type { VizEdge, VizMachine, VizState } from "./schema.ts";
import { isUnchanged, outlineChanges, outlineOf } from "./outline.ts";
import type { MachineOutline } from "./outline.ts";
import { describe, expect, test } from "vite-plus/test";

function state(id: string): VizState {
  return {
    id,
    label: id,
    region: null,
    initial: false,
    final: false,
    effects: [],
    coverage: null,
    tested: null,
    doc: null,
  };
}

function edge(
  from: string,
  event: string,
  to: string | null,
  extra: Partial<VizEdge> = {},
): VizEdge {
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
    ...extra,
  };
}

function machine(states: string[], edges: VizEdge[]): VizMachine {
  return {
    id: "m",
    initial: states[0] ?? "",
    regions: [],
    maps: [],
    states: states.map(state),
    events: [],
    outputs: [],
    context: null,
    edges,
    fuzz: null,
    runs: [],
  };
}

const outline = (states: string[], arrows: MachineOutline["arrows"] = []): MachineOutline => ({
  states,
  arrows,
});
const go = (from: string, to: string | null) => ({
  from,
  event: "GO",
  to,
  kind: "transition" as const,
});

describe("outlineOf", () => {
  test("keeps declared transitions and stays once, in document order", () => {
    const result = outlineOf(
      machine(
        ["a", "b"],
        [
          edge("__initial__", "", "a", { kind: "initial" }),
          edge("a", "GO", "b"),
          edge("a", "GO", "b"),
          edge("b", "PING", "b", { kind: "stay" }),
          edge("a", "effect:x", "a", { kind: "effect" }),
          edge("a", "FUZZ", "b", { origin: "fuzz" }),
        ],
      ),
    );
    expect(result).toEqual({
      states: ["a", "b"],
      arrows: [go("a", "b"), { from: "b", event: "PING", to: "b", kind: "stay" }],
    });
  });

  test("keeps probe-origin arrows", () => {
    expect(outlineOf(machine(["a"], [edge("a", "GO", "a", { origin: "probe" })])).arrows).toEqual([
      go("a", "a"),
    ]);
  });
});

describe("outlineChanges", () => {
  test("an added state", () => {
    expect(outlineChanges(outline(["a", "b"]), outline(["a", "b", "c"]))).toEqual({
      addedStates: ["c"],
      removedStates: [],
      addedArrows: [],
      removedArrows: [],
    });
  });

  test("a kind-only difference between two arrows is a change", () => {
    const transition = go("a", "a");
    const stay = { ...transition, kind: "stay" as const };
    const changes = outlineChanges(outline(["a"], [transition]), outline(["a"], [stay]));
    expect(changes.removedArrows).toEqual([transition]);
    expect(changes.addedArrows).toEqual([stay]);
  });

  test("a retargeted arrow is one removed and one added", () => {
    const changes = outlineChanges(outline(["a"], [go("a", "b")]), outline(["a"], [go("a", "c")]));
    expect(changes.removedArrows).toEqual([go("a", "b")]);
    expect(changes.addedArrows).toEqual([go("a", "c")]);
  });

  test("a fuzz-only edge is not a change", () => {
    const base = machine(["a", "b"], [edge("a", "GO", "b")]);
    const fuzzed = machine(
      ["a", "b"],
      [edge("a", "GO", "b"), edge("b", "X", "a", { origin: "fuzz" })],
    );
    expect(isUnchanged(outlineChanges(outlineOf(base), outlineOf(fuzzed)))).toBe(true);
  });

  test("an undetermined arrow before and after is unchanged", () => {
    const same = outline(["a"], [go("a", null)]);
    expect(isUnchanged(outlineChanges(same, same))).toBe(true);
  });

  test("lists removed states in the old order", () => {
    expect(outlineChanges(outline(["z", "a", "q"]), outline(["a"])).removedStates).toEqual([
      "z",
      "q",
    ]);
  });
});

describe("isUnchanged", () => {
  const none = { addedStates: [], removedStates: [], addedArrows: [], removedArrows: [] };
  test("true when every list is empty", () => {
    expect(isUnchanged(none)).toBe(true);
  });
  test("false when any list has an item", () => {
    expect(isUnchanged({ ...none, addedStates: ["a"] })).toBe(false);
    expect(isUnchanged({ ...none, removedStates: ["a"] })).toBe(false);
    expect(isUnchanged({ ...none, addedArrows: [go("a", "b")] })).toBe(false);
    expect(isUnchanged({ ...none, removedArrows: [go("a", "b")] })).toBe(false);
  });
});
