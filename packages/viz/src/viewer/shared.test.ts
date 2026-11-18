import { describe, expect, test } from "vite-plus/test";
import reference from "./reference/justus-whole-app.json" with { type: "json" };
import type { VizEdge, VizMachine, VizState } from "../schema.ts";
import { isSharedNode, shareArrows } from "./shared.ts";

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
    expect(shared.nodes).toEqual([
      { id: "*", scope: "", states: ["a", "b", "c"], label: "any state" },
    ]);
    expect(shared.arrows).toHaveLength(1);
    expect(shared.arrows[0]?.members.map((edge) => edge.id)).toEqual([
      "a-go-done",
      "b-go-done",
      "c-go-done",
    ]);
    expect(shared.edges.map((edge) => edge.from)).toEqual(["*"]);
  });

  test("three of four states name themselves; five or more add `+n more`", () => {
    const three = shareArrows(
      machineOf(
        names("a", "b", "c", "d"),
        ["a", "b", "c"].map((from) => edgeOf(from, "go", "d")),
      ),
    );
    expect(three.nodes.map((node) => [node.id, node.label])).toEqual([["*1", "a, b, c"]]);
    const four = shareArrows(
      machineOf(
        names("a", "b", "c", "d", "e"),
        ["a", "b", "c", "d"].map((from) => edgeOf(from, "go", "e")),
      ),
    );
    expect(four.nodes.map((node) => [node.id, node.label])).toEqual([["*1", "a, b, c +1 more"]]);
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
    expect(labels.sort()).toEqual([
      "albumDeletedByAdmin, checkingLink, checkingPastedLink +11 more",
      "albumDeletedByAdmin, linkReplacedByAdmin, linkStoppedForUnknownReason +1 more",
      "joinedAlbum, noInviteOpen, showingLinkProblem",
      "sendingPastedRequest, sendingRequest, sendingRequestAgain",
    ]);
  });
});
