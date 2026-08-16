import { expect, test, describe } from "vite-plus/test";
import { buildGraph } from "../src/graph.ts";
import { Actor, state, event } from "@mantaq/core";

function createFlatActor() {
  const idle = state("idle")();
  const active = state("active")();
  const go = event("GO")();

  return new Actor({
    inputs: [go],
    outputs: [],
    internal: [],
    states: [idle, active],
    initial: idle,
    context: {} as {},
    setup: (m) => {
      m.on(idle, go, () => ({ state: active }));
    },
  });
}

function createAnyWildcardActor() {
  const idle = state("idle")();
  const active = state("active")();
  const go = event("GO")();

  return new Actor({
    inputs: [go],
    outputs: [],
    internal: [],
    states: [idle, active],
    initial: idle,
    context: {} as {},
    setup: (m) => {
      m.onAny(go, () => ({ state: active }));
    },
  });
}

function createInternalEventActor() {
  const idle = state("idle")();
  const active = state("active")();
  const go = event("GO")();
  const ping = event("PING")();

  return new Actor({
    inputs: [go],
    outputs: [],
    internal: [ping],
    states: [idle, active],
    initial: idle,
    context: {} as {},
    setup: (m) => {
      m.on(idle, go, () => ({ state: active }));
      m.on(idle, ping, () => ({ state: idle }));
    },
  });
}

function createFinalStateActor() {
  const idle = state("idle")();
  const done = state("done")().final();
  const finish = event("FINISH")();

  return new Actor({
    inputs: [finish],
    outputs: [],
    internal: [],
    states: [idle, done],
    initial: idle,
    context: {} as {},
    setup: (m) => {
      m.on(idle, finish, () => ({ state: done }));
    },
  });
}

function createRegionActor() {
  const childA = state("childA")();
  const childB = state("childB")();
  const toggle = event("TOGGLE")();

  const child = new Actor({
    inputs: [toggle],
    outputs: [],
    internal: [],
    states: [childA, childB],
    initial: childA,
    context: {} as {},
    setup: (m) => {
      m.on(childA, toggle, () => ({ state: childB }));
    },
  });

  const parent = state("parent")();
  const start = event("START")();

  return new Actor({
    inputs: [start],
    outputs: [],
    internal: [],
    states: [parent],
    initial: parent,
    context: {} as {},
    regions: { region1: child },
    setup: (m) => {
      m.on(parent, start, () => ({ state: parent }));
    },
  });
}

describe("buildGraph", () => {
  test("flat actor with 2 states and 1 transition", () => {
    const actor = createFlatActor();
    const graph = buildGraph(actor);

    expect(graph.nodes.length).toBe(3);
    const labels = graph.nodes.map((n) => n.label);
    expect(labels).toContain("idle");
    expect(labels).toContain("active");

    const activeNode = graph.nodes.find((n) => n.isActive);
    expect(activeNode!.label).toBe("idle");

    expect(graph.edges.length).toBeGreaterThanOrEqual(2);
    const goEdge = graph.edges.find((e) => e.label === "GO");
    expect(goEdge).toBeDefined();
    expect(goEdge!.source).toContain("idle");
    expect(goEdge!.target).toContain("active");
  });

  test("actor with Any wildcard transitions", () => {
    const actor = createAnyWildcardActor();
    const graph = buildGraph(actor);

    const goEdge = graph.edges.find((e) => e.label === "GO");
    expect(goEdge).toBeDefined();
    expect(goEdge!.source).toContain("idle");
    expect(goEdge!.target).toContain("active");
  });

  test("actor with internal events", () => {
    const actor = createInternalEventActor();
    buildGraph(actor);

    const internalIds = new Set(["PING"]);
    const graphWithInternal = buildGraph(actor, { internalIds });

    const pingEdges = graphWithInternal.edges.filter((e) => e.label === "PING");
    expect(pingEdges.length).toBeGreaterThanOrEqual(1);
    expect(pingEdges[0].isInternal).toBe(true);
  });

  test("actor with regions (child actors)", () => {
    const actor = createRegionActor();
    const graph = buildGraph(actor);

    const labels = graph.nodes.map((n) => n.label);
    expect(labels).toContain("parent");
    expect(labels).toContain("childA");
    expect(labels).toContain("childB");

    const regionEdge = graph.edges.find((e) => e.label === "TOGGLE");
    expect(regionEdge).toBeDefined();
  });

  test("handler forwarding to a region via the injected actor is a dry run", () => {
    const childIdle = state("childIdle")();
    const childActive = state("childActive")();
    const toggle = event("TOGGLE")();

    const child = new Actor({
      inputs: [toggle],
      outputs: [],
      internal: [],
      states: [childIdle, childActive],
      initial: childIdle,
      context: {} as {},
      setup: (m) => {
        m.on(childIdle, toggle, () => ({ state: childActive }));
      },
    });

    const parentIdle = state("parentIdle")();
    const go = event("GO")();

    const actor = new Actor({
      inputs: [go],
      outputs: [],
      internal: [],
      states: [parentIdle],
      initial: parentIdle,
      context: {} as {},
      regions: { child },
      setup: (m) => {
        m.on(parentIdle, go, (_event, opts) => {
          // The example pattern: forward to a region through the injected
          // actor. Graph discovery must not let this mutate the live child.
          opts!.actor.regions.child.send(toggle.create());
          return { state: parentIdle };
        });
      },
    });

    buildGraph(actor);
    expect(child.snapshot().path).toEqual(["childIdle"]);
  });

  test("final states are marked", () => {
    const actor = createFinalStateActor();
    const graph = buildGraph(actor);

    const done = graph.nodes.find((n) => n.label === "done");
    expect(done).toBeDefined();
    expect(done!.isFinal).toBe(true);

    const idle = graph.nodes.find((n) => n.label === "idle");
    expect(idle!.isFinal).toBe(false);
  });

  test("undetermined transitions when handler throws", () => {
    const idle = state("idle")();
    const go = event("GO")();

    const actor = new Actor({
      inputs: [go],
      outputs: [],
      internal: [],
      states: [idle],
      initial: idle,
      context: {} as {},
      setup: (m) => {
        m.on(idle, go, () => {
          throw new Error("fail");
        });
      },
    });

    const graph = buildGraph(actor);
    const undetermined = graph.edges.filter((e) => e.isUndetermined);
    expect(undetermined.length).toBe(1);
    expect(undetermined[0].label).toBe("GO");
  });

  test("initial pseudo-node is added", () => {
    const actor = createFlatActor();
    const graph = buildGraph(actor);

    const initialNode = graph.nodes.find((n) => n.isInitial);
    expect(initialNode).toBeDefined();
    expect(initialNode!.id).toBe("__initial__");

    const initialEdge = graph.edges.find((e) => e.source === "__initial__");
    expect(initialEdge).toBeDefined();
  });

  test("graph updates after transition", () => {
    const actor = createFlatActor();
    let graph = buildGraph(actor);
    expect(graph.nodes.find((n) => n.isActive)?.label).toBe("idle");

    const go = event("GO")();
    actor.send(go.create());

    graph = buildGraph(actor);
    expect(graph.nodes.find((n) => n.isActive)?.label).toBe("active");
  });

  test("sampleContext (backward compat) produces single-context edges", () => {
    const actor = createFlatActor();
    const graph = buildGraph(actor, { sampleContext: { x: 1 } });
    const goEdge = graph.edges.find((e) => e.label === "GO");
    expect(goEdge!.contexts).toEqual(["default"]);
  });
});

describe("buildGraph with sampleContexts", () => {
  function createContextBranchActor() {
    const idle = state("idle")();
    const active = state("active")();
    const blocked = state("blocked")();
    const go = event("GO")();

    return new Actor({
      inputs: [go],
      outputs: [],
      internal: [],
      states: [idle, active, blocked],
      initial: idle,
      context: {} as { ready: boolean },
      setup: (m) => {
        m.on(idle, go, (_event, { context }) =>
          context.get().ready ? { state: active } : { state: blocked },
        );
      },
    });
  }

  test("single context produces one edge", () => {
    const actor = createContextBranchActor();
    const graph = buildGraph(actor, {
      sampleContexts: { ready: { ready: true } },
    });

    const goEdges = graph.edges.filter((e) => e.label === "GO");
    expect(goEdges.length).toBe(1);
    expect(goEdges[0].target).toContain("active");
    expect(goEdges[0].contexts).toEqual(["ready"]);
  });

  test("two contexts produce two edges for same event", () => {
    const actor = createContextBranchActor();
    const graph = buildGraph(actor, {
      sampleContexts: {
        ready: { ready: true },
        notReady: { ready: false },
      },
    });

    const goEdges = graph.edges.filter((e) => e.label === "GO");
    expect(goEdges.length).toBe(2);

    const activeEdge = goEdges.find((e) => e.target.includes("active"));
    const blockedEdge = goEdges.find((e) => e.target.includes("blocked"));
    expect(activeEdge).toBeDefined();
    expect(blockedEdge).toBeDefined();
    expect(activeEdge!.contexts).toEqual(["ready"]);
    expect(blockedEdge!.contexts).toEqual(["notReady"]);
  });

  test("same target from multiple contexts merges into one edge", () => {
    const idle = state("idle")();
    const active = state("active")();
    const go = event("GO")();

    const actor = new Actor({
      inputs: [go],
      outputs: [],
      internal: [],
      states: [idle, active],
      initial: idle,
      context: {} as { unused: string },
      setup: (m) => {
        m.on(idle, go, () => ({ state: active }));
      },
    });

    const graph = buildGraph(actor, {
      sampleContexts: {
        a: { unused: "a" },
        b: { unused: "b" },
        c: { unused: "c" },
      },
    });

    const goEdges = graph.edges.filter((e) => e.label === "GO");
    expect(goEdges.length).toBe(1);
    expect(goEdges[0].contexts).toEqual(["a", "b", "c"]);
  });

  test("undetermined edges track contexts too", () => {
    const idle = state("idle")();
    const go = event("GO")();

    const actor = new Actor({
      inputs: [go],
      outputs: [],
      internal: [],
      states: [idle],
      initial: idle,
      context: {} as { x: number },
      setup: (m) => {
        m.on(idle, go, (_event, { context }) => (context.get().x > 10 ? {} : {}));
      },
    });

    const graph = buildGraph(actor, {
      sampleContexts: {
        big: { x: 100 },
        small: { x: 1 },
      },
    });

    const goEdges = graph.edges.filter((e) => e.label === "GO");
    expect(goEdges.length).toBe(1);
    expect(goEdges[0].isUndetermined).toBe(true);
    expect(goEdges[0].contexts).toEqual(["big", "small"]);
  });
});
