import { describe, expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import type { VizEdge, VizLiveState, VizLiveStep, VizMachine } from "../schema.ts";
import { blockedEdges, blockedReason, sentByParts, whyNotHere } from "./blocked.ts";

function pay(over: Partial<VizEdge> = {}): VizEdge {
  return {
    id: "cart-pay-payment",
    from: "cart",
    event: "pay",
    to: "payment",
    kind: "transition",
    origin: "declared",
    emits: [],
    contexts: [],
    explanation: {
      status: "analyzed",
      location: { file: "order.ts", line: 1, column: 1 },
      registration: "on",
      branches: [],
      payloadReads: ["email"],
      contextReads: ["items"],
      contextWrites: [],
      readsActorState: false,
      comparisons: [
        { source: "payload", path: "email", operator: "!==", literal: "" },
        { source: "context", path: "items", operator: "!==", literal: 0 },
      ],
      literals: [],
    },
    doc: null,
    coverage: null,
    tested: null,
    ...over,
  };
}

function outcome(kind: VizLiveStep["outcome"], error: string | null = null): VizLiveStep {
  return {
    from: "cart",
    event: "pay",
    to: "cart",
    outcome: kind,
    effects: [],
    sent: [],
    context: null,
    error,
  };
}

const payloadOnly = (): VizEdge => {
  const base = pay();
  if (base.explanation?.status !== "analyzed") throw new Error("fixture");
  return {
    ...base,
    explanation: {
      ...base.explanation,
      contextReads: [],
      comparisons: [base.explanation.comparisons[0]!],
    },
  };
};

describe("blockedReason", () => {
  test("a stay with items 0 names the context value", () => {
    expect(blockedReason({ edge: pay(), outcome: outcome("stay"), live: { items: 0 } })).toBe(
      "pay is blocked: items is 0",
    );
  });

  test("a path compared twice is named once", () => {
    const base = pay();
    if (base.explanation?.status !== "analyzed") throw new Error("fixture");
    const edge: VizEdge = {
      ...base,
      explanation: {
        ...base.explanation,
        comparisons: [
          { source: "context", path: "items", operator: ">", literal: 0 },
          { source: "context", path: "items", operator: "<", literal: 10 },
        ],
      },
    };
    expect(blockedReason({ edge, outcome: outcome("stay"), live: { items: 0 } })).toBe(
      "pay is blocked: items is 0",
    );
  });

  test("a value that is not in the context reads not set", () => {
    expect(blockedReason({ edge: pay(), outcome: outcome("stay"), live: {} })).toBe(
      "pay is blocked: items is not set",
    );
    expect(blockedReason({ edge: pay(), outcome: outcome("stay"), live: null })).toBe(
      "pay is blocked: items is not set",
    );
  });

  test("a dotted path walks into nested context", () => {
    const edge = pay();
    if (edge.explanation?.status !== "analyzed") throw new Error("fixture");
    const nested = {
      ...edge,
      explanation: {
        ...edge.explanation,
        comparisons: [
          { source: "context" as const, path: "cart.items", operator: "===" as const, literal: 1 },
        ],
      },
    };
    expect(
      blockedReason({ edge: nested, outcome: outcome("stay"), live: { cart: { items: 2 } } }),
    ).toBe("pay is blocked: cart.items is 2");
    expect(blockedReason({ edge: nested, outcome: outcome("stay"), live: { cart: [] } })).toBe(
      "pay is blocked: cart.items is not set",
    );
  });

  test("a transition, an ignored event and a missing actor are not blocked", () => {
    for (const kind of ["transition", "ignored", "missing"] as const) {
      expect(
        blockedReason({
          edge: pay(),
          outcome: { ...outcome(kind), to: "payment" },
          live: { items: 0 },
        }),
      ).toBeNull();
    }
  });

  test("a handler that threw is blocked", () => {
    expect(
      blockedReason({ edge: pay(), outcome: outcome("missing", "boom"), live: { items: 0 } }),
    ).toBe("pay is blocked: items is 0");
  });

  test("no outcome, a stay edge, or an unanalyzed edge is not blocked", () => {
    const live = { items: 0 };
    expect(blockedReason({ edge: pay(), outcome: null, live })).toBeNull();
    expect(
      blockedReason({ edge: pay({ kind: "stay" }), outcome: outcome("stay"), live }),
    ).toBeNull();
    expect(
      blockedReason({ edge: pay({ explanation: null }), outcome: outcome("stay"), live }),
    ).toBeNull();
  });

  test("a payload-only guard is not blocked", () => {
    expect(
      blockedReason({ edge: payloadOnly(), outcome: outcome("stay"), live: { items: 0 } }),
    ).toBeNull();
  });

  test("without comparisons the context reads name the cause", () => {
    const edge = pay();
    if (edge.explanation?.status !== "analyzed") throw new Error("fixture");
    const reads = { ...edge, explanation: { ...edge.explanation, comparisons: [] } };
    expect(blockedReason({ edge: reads, outcome: outcome("stay"), live: { items: 0 } })).toBe(
      "pay is blocked: items is 0",
    );
  });
});

const team = JSON.parse(
  readFileSync(new URL("./reference/team-inbox.json", import.meta.url), "utf8"),
) as VizMachine;
const edgeOf = (id: string): VizEdge => {
  const edge = team.edges.find((each) => each.id === id);
  if (edge === undefined) throw new Error(id);
  return edge;
};
const liveAt = (state: string, over: Partial<VizLiveState> = {}): VizLiveState =>
  ({ state, regions: {}, children: [], ...over }) as unknown as VizLiveState;
const child = (key: string, state: string) => ({ map: "workers", key, state, since: 0 });

describe("sentByParts", () => {
  test.each([
    ["workers.free-team.ITEMS_ASSIGNED-working", ["teamInbox"]],
    ["workersBusy-team.ITEMS_FINISHED-allWorkersFree", ["workers"]],
    ["allWorkersFree-team.ITEM_ARRIVED-workersBusy", []],
    ["workers.working-team.RUN_SUCCEEDED-free", []],
  ])("%s", (id, parts) => {
    expect(sentByParts(team, edgeOf(id))).toEqual(parts);
  });
});

describe("whyNotHere", () => {
  const submit = edgeOf("workersBusy-team.ITEMS_FINISHED-allWorkersFree");

  test("the root is in another state", () => {
    expect(whyNotHere(team, submit, { live: liveAt("allWorkersFree"), picked: null })).toBe(
      "team.ITEMS_FINISHED can't be sent: the walk is in allWorkersFree, this arrow leaves workersBusy.",
    );
  });

  test("a picked child in another state", () => {
    const live = liveAt("workersBusy", {
      children: [child("w1", "workers.working"), child("w2", "workers.free")],
    });
    expect(
      whyNotHere(team, edgeOf("workers.working-team.RUN_SUCCEEDED-free"), {
        live,
        picked: { map: "workers", key: "w2" },
      }),
    ).toBe("team.RUN_SUCCEEDED can't be sent: w2 is in free, this arrow leaves working.");
  });

  test("a map with no child", () => {
    expect(
      whyNotHere(team, edgeOf("workers.working-team.RUN_SUCCEEDED-free"), {
        live: liveAt("workersBusy"),
        picked: null,
      }),
    ).toBe("team.RUN_SUCCEEDED can't be sent: workers has no child.");
  });

  test("a sendable arrow gives null", () => {
    expect(whyNotHere(team, submit, { live: liveAt("workersBusy"), picked: null })).toBeNull();
    const live = liveAt("workersBusy", { children: [child("w1", "workers.working")] });
    expect(
      whyNotHere(team, edgeOf("workers.working-team.RUN_SUCCEEDED-free"), { live, picked: null }),
    ).toBeNull();
  });
});

describe("blockedReason goes elsewhere", () => {
  test("a transition to another target names it", () => {
    const edge = pay({ explanation: null, to: "declined" });
    expect(
      blockedReason({ edge, outcome: { ...outcome("transition"), to: "accepted" }, live: {} }),
    ).toBe("pay goes to accepted, not declined");
  });

  test("a transition to the drawn target is not blocked", () => {
    const edge = pay({ explanation: null, to: "declined" });
    expect(
      blockedReason({ edge, outcome: { ...outcome("transition"), to: "declined" }, live: {} }),
    ).toBeNull();
  });
});

describe("edge cases", () => {
  test("the part an arrow belongs to does not count as its sender", () => {
    const own = { ...team, partOutputs: { workers: ["team.RUN_SUCCEEDED"] } };
    expect(sentByParts(own, edgeOf("workers.working-team.RUN_SUCCEEDED-free"))).toEqual([]);
  });

  test("a region with no known state is not blamed", () => {
    const region = { ...team, maps: [] };
    expect(
      whyNotHere(region, edgeOf("workers.working-team.RUN_SUCCEEDED-free"), {
        live: liveAt("workersBusy"),
        picked: null,
      }),
    ).toBeNull();
  });

  test("with two maps the child is named with its map", () => {
    const two = { ...team, maps: ["workers", "other"] };
    const live = liveAt("workersBusy", { children: [child("w1", "workers.free")] });
    expect(
      whyNotHere(two, edgeOf("workers.working-team.RUN_SUCCEEDED-free"), { live, picked: null }),
    ).toBe("team.RUN_SUCCEEDED can't be sent: workers w1 is in free, this arrow leaves working.");
  });

  test("a transition with no drawn target is not blocked by where it lands", () => {
    const edge = pay({ explanation: null, to: null });
    expect(
      blockedReason({ edge, outcome: { ...outcome("transition"), to: "accepted" }, live: {} }),
    ).toBeNull();
  });

  test("arrows another part sends are not tried", () => {
    const asked: string[] = [];
    blockedEdges(team, {
      live: liveAt("workersBusy", { context: {} } as Partial<VizLiveState>),
      payloadOf: () => null,
      currents: ["workersBusy"],
      dryRun: (steps) => {
        asked.push(...steps.map((step) => (step.kind === "event" ? step.event : "")));
        return steps.map(() => null);
      },
      actorOf: () => undefined,
    });
    expect(asked).toContain("team.ITEM_ARRIVED");
    expect(asked).not.toContain("team.ITEMS_FINISHED");
  });
});

describe("whyNotHere names the part and the source", () => {
  test("a region in another state is named by its path", () => {
    const region = { ...team, maps: [] };
    expect(
      whyNotHere(region, edgeOf("workers.working-team.RUN_SUCCEEDED-free"), {
        live: liveAt("workersBusy", { regions: { workers: "workers.free" } }),
        picked: null,
      }),
    ).toBe("team.RUN_SUCCEEDED can't be sent: workers is in free, this arrow leaves working.");
  });

  test("an arrow from any state names it so", () => {
    const anyEdge = {
      ...edgeOf("workers.working-team.RUN_SUCCEEDED-free"),
      id: "any",
      from: "workers.*",
    };
    const free = team.states.find((each) => each.id === "workers.free");
    if (free === undefined) throw new Error("fixture");
    const done = { ...free, id: "workers.done", final: true };
    const region = {
      ...team,
      maps: [],
      states: [...team.states, done],
      edges: [...team.edges, anyEdge],
    };
    expect(
      whyNotHere(region, anyEdge, {
        live: liveAt("workersBusy", { regions: { workers: "workers.done" } }),
        picked: null,
      }),
    ).toBe("team.RUN_SUCCEEDED can't be sent: workers is in done, this arrow leaves any state.");
  });

  test("another arrow with the same event out of the current state does not make this one sendable", () => {
    const busy = edgeOf("workersBusy-team.ITEMS_FINISHED-allWorkersFree");
    const other = { ...busy, id: "elsewhere", from: "workWaiting" };
    const machine = { ...team, edges: [...team.edges, other] };
    expect(whyNotHere(machine, other, { live: liveAt("workersBusy"), picked: null })).toBe(
      "team.ITEMS_FINISHED can't be sent: the walk is in workersBusy, this arrow leaves workWaiting.",
    );
  });
});
