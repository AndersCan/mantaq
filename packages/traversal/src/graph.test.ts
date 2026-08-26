import { buildGraph } from "./graph.ts";
import { Actor, event, state } from "@mantaq/core";
import { describe, expect, test } from "vite-plus/test";

function createFlatActor() {
  const idleState = state("idle")();
  const activeState = state("active")();
  const goEvent = event("GO")();

  return Actor({
    inputs: [goEvent],
    outputs: [],
    internal: [],
    states: [idleState, activeState],
    initial: idleState,
    setup: (machine) => {
      machine.on(idleState, {
        eventRef: goEvent,
        handler: () => ({ state: activeState }),
      });
    },
  });
}

function createAnyWildcardActor() {
  const idleState = state("idle")();
  const activeState = state("active")();
  const goEvent = event("GO")();

  return Actor({
    inputs: [goEvent],
    outputs: [],
    internal: [],
    states: [idleState, activeState],
    initial: idleState,
    setup: (machine) => {
      machine.onAny({ eventRef: goEvent, handler: () => ({ state: activeState }) });
    },
  });
}

function createInternalEventActor() {
  const idleState = state("idle")();
  const activeState = state("active")();
  const goEvent = event("GO")();
  const pingEvent = event("PING")();

  return Actor({
    inputs: [goEvent],
    outputs: [],
    internal: [pingEvent],
    states: [idleState, activeState],
    initial: idleState,
    setup: (machine) => {
      machine.on(idleState, { eventRef: goEvent, handler: () => ({ state: activeState }) });
      machine.on(idleState, { eventRef: pingEvent, handler: () => ({ state: idleState }) });
    },
  });
}

function createFinalStateActor() {
  const idleState = state("idle")();
  const doneState = state("done")().final();
  const finishEvent = event("FINISH")();

  return Actor({
    inputs: [finishEvent],
    outputs: [],
    internal: [],
    states: [idleState, doneState],
    initial: idleState,
    setup: (machine) => {
      machine.on(idleState, { eventRef: finishEvent, handler: () => ({ state: doneState }) });
    },
  });
}

function createRegionActor() {
  const childStateA = state("childA")();
  const childStateB = state("childB")();
  const toggleEvent = event("TOGGLE")();

  const child = Actor({
    inputs: [toggleEvent],
    outputs: [],
    internal: [],
    states: [childStateA, childStateB],
    initial: childStateA,
    setup: (machine) => {
      machine.on(childStateA, {
        eventRef: toggleEvent,
        handler: () => ({ state: childStateB }),
      });
    },
  });

  const parentState = state("parent")();
  const startEvent = event("START")();

  return Actor({
    inputs: [startEvent],
    outputs: [],
    internal: [],
    states: [parentState],
    initial: parentState,
    regions: { region1: child },
    setup: (machine) => {
      machine.on(parentState, { eventRef: startEvent, handler: () => ({ state: parentState }) });
    },
  });
}

function isTransitionExplosion(): never {
  throw new Error("fail");
}

const initialNode = {
  id: "__initial__",
  label: "",
  isActive: false,
  isFinal: false,
  isInitial: true,
};

describe("buildGraph", () => {
  test("returns nodes and edges for a flat actor with one transition", () => {
    const graph = buildGraph(createFlatActor());

    expect(graph).toEqual({
      nodes: [
        { id: "idle", label: "idle", isActive: true, isFinal: false },
        { id: "active", label: "active", isActive: false, isFinal: false },
        initialNode,
      ],
      edges: [
        {
          id: "idle-GO-active",
          source: "idle",
          target: "active",
          label: "GO",
          isActive: true,
          isUndetermined: false,
          contexts: ["default"],
        },
        {
          id: "__initial__->idle",
          source: "__initial__",
          target: "idle",
          label: "",
          isActive: true,
          contexts: [],
        },
      ],
    });
  });

  test("returns wildcard edges for an actor that only handles Any transitions", () => {
    const graph = buildGraph(createAnyWildcardActor());

    expect(graph.edges).toEqual([
      {
        id: "idle-GO-active",
        source: "idle",
        target: "active",
        label: "GO",
        isActive: true,
        isUndetermined: false,
        contexts: ["default"],
      },
      {
        id: "active-GO-active",
        source: "active",
        target: "active",
        label: "GO",
        isActive: false,
        isUndetermined: false,
        contexts: ["default"],
      },
      {
        id: "__initial__->idle",
        source: "__initial__",
        target: "idle",
        label: "",
        isActive: true,
        contexts: [],
      },
    ]);
  });

  test("returns internal-marked edges when their events are declared internal", () => {
    const actor = createInternalEventActor();
    const graph = buildGraph(actor, { internalIds: new Set(["PING"]) });

    expect(graph.edges).toEqual([
      {
        id: "idle-GO-active",
        source: "idle",
        target: "active",
        label: "GO",
        isActive: true,
        isInternal: false,
        isUndetermined: false,
        contexts: ["default"],
      },
      {
        id: "idle-PING-idle",
        source: "idle",
        target: "idle",
        label: "PING",
        isActive: true,
        isInternal: true,
        isUndetermined: false,
        contexts: ["default"],
      },
      {
        id: "__initial__->idle",
        source: "__initial__",
        target: "idle",
        label: "",
        isActive: true,
        contexts: [],
      },
    ]);
  });

  test("returns region child nodes and edges alongside parent nodes", () => {
    const graph = buildGraph(createRegionActor());

    expect(graph.nodes.map((node) => node.label)).toEqual(["parent", "childA", "childB", ""]);
    expect(graph.edges.filter((edge) => edge.label === "TOGGLE")).toEqual([
      {
        id: "region1.childA-TOGGLE-region1.childB",
        source: "region1.childA",
        target: "region1.childB",
        label: "TOGGLE",
        isActive: true,
        isUndetermined: false,
        contexts: ["default"],
      },
    ]);
    expect(graph.edges.filter((edge) => edge.label === "START")).toEqual([
      {
        id: "parent-START-parent",
        source: "parent",
        target: "parent",
        label: "START",
        isActive: true,
        isUndetermined: false,
        contexts: ["default"],
      },
    ]);
  });

  test("returns final markers on final states", () => {
    const graph = buildGraph(createFinalStateActor());

    expect(graph.nodes).toEqual([
      { id: "idle", label: "idle", isActive: true, isFinal: false },
      { id: "done", label: "done", isActive: false, isFinal: true },
      initialNode,
    ]);
  });

  test("returns undetermined edges when a transition handler fails", () => {
    const idleState = state("idle")();
    const goEvent = event("GO")();

    const actor = Actor({
      inputs: [goEvent],
      outputs: [],
      internal: [],
      states: [idleState],
      initial: idleState,
      setup: (machine) => {
        machine.on(idleState, { eventRef: goEvent, handler: isTransitionExplosion });
      },
    });

    const graph = buildGraph(actor);

    expect(graph.edges).toEqual([
      {
        id: "idle-GO-idle-undetermined-GO",
        source: "idle",
        target: "idle-undetermined-GO",
        label: "GO",
        isActive: true,
        isUndetermined: true,
        contexts: ["default"],
      },
      {
        id: "__initial__->idle",
        source: "__initial__",
        target: "idle",
        label: "",
        isActive: true,
        contexts: [],
      },
    ]);
  });

  test("adds the initial pseudo-node ahead of the resolved initial state", () => {
    const graph = buildGraph(createFlatActor());

    expect(graph.nodes.filter((node) => node.isInitial)).toEqual([initialNode]);
    expect(graph.edges.filter((edge) => edge.source === "__initial__")).toEqual([
      {
        id: "__initial__->idle",
        source: "__initial__",
        target: "idle",
        label: "",
        isActive: true,
        contexts: [],
      },
    ]);
  });

  test("resolves the initial pseudo-node target for object-form initials with payloads", () => {
    const idleState = state("idle")();
    const activeState = state("active")();
    const goEvent = event("GO")();

    const actor = Actor({
      inputs: [goEvent],
      outputs: [],
      internal: [],
      states: [idleState, activeState],
      initial: { state: idleState, payload: { count: 0 } },
      setup: (machine) => {
        machine.on(idleState, {
          eventRef: goEvent,
          handler: () => ({ state: activeState }),
        });
      },
    });

    const graph = buildGraph(actor);

    expect(graph.nodes.filter((node) => node.isInitial)).toEqual([initialNode]);
    expect(graph.edges.filter((edge) => edge.source === "__initial__")).toEqual([
      {
        id: "__initial__->idle",
        source: "__initial__",
        target: "idle",
        label: "",
        isActive: true,
        contexts: [],
      },
    ]);
  });

  test("updates the active marker after a transition is sent", () => {
    const actor = createFlatActor();
    const goEvent = event("GO")();
    actor.send(goEvent.create());

    const graph = buildGraph(actor);
    expect(graph.nodes.filter((node) => node.isActive)).toEqual([
      { id: "active", label: "active", isActive: true, isFinal: false },
    ]);
  });

  test("returns default-context edges when only sampleContext is given", () => {
    const graph = buildGraph(createFlatActor(), { sampleContext: { level: 1 } });

    expect(graph.edges.filter((edge) => edge.label === "GO")).toEqual([
      {
        id: "idle-GO-active",
        source: "idle",
        target: "active",
        label: "GO",
        isActive: true,
        isUndetermined: false,
        contexts: ["default"],
      },
    ]);
  });
});

describe("buildGraph with sampleContexts", () => {
  function createContextBranchActor() {
    const idleState = state("idle")();
    const activeState = state("active")();
    const blockedState = state("blocked")();
    const goEvent = event("GO")();

    return Actor({
      inputs: [goEvent],
      outputs: [],
      internal: [],
      states: [idleState, activeState, blockedState],
      initial: idleState,
      context: { ready: false },
      setup: (machine) => {
        machine.on(idleState, {
          eventRef: goEvent,
          handler: (_sentEvent, { context }) =>
            context.get().ready ? { state: activeState } : { state: blockedState },
        });
      },
    });
  }

  test("returns one edge per event when a single context is sampled", () => {
    const graph = buildGraph(createContextBranchActor(), {
      sampleContexts: { ready: { ready: true } },
    });

    expect(graph.edges.filter((edge) => edge.label === "GO")).toEqual([
      {
        id: "idle-GO-active",
        source: "idle",
        target: "active",
        label: "GO",
        isActive: true,
        isUndetermined: false,
        contexts: ["ready"],
      },
    ]);
  });

  test("returns two edges for the same event when two contexts are sampled", () => {
    const graph = buildGraph(createContextBranchActor(), {
      sampleContexts: {
        ready: { ready: true },
        notReady: { ready: false },
      },
    });

    expect(graph.edges.filter((edge) => edge.label === "GO")).toEqual([
      {
        id: "idle-GO-active",
        source: "idle",
        target: "active",
        label: "GO",
        isActive: true,
        isUndetermined: false,
        contexts: ["ready"],
      },
      {
        id: "idle-GO-blocked",
        source: "idle",
        target: "blocked",
        label: "GO",
        isActive: true,
        isUndetermined: false,
        contexts: ["notReady"],
      },
    ]);
  });

  test("returns merged edges when multiple sampled contexts share a target", () => {
    const idleState = state("idle")();
    const activeState = state("active")();
    const goEvent = event("GO")();

    const actor = Actor({
      inputs: [goEvent],
      outputs: [],
      internal: [],
      states: [idleState, activeState],
      initial: idleState,
      context: { note: "" },
      setup: (machine) => {
        machine.on(idleState, { eventRef: goEvent, handler: () => ({ state: activeState }) });
      },
    });

    const graph = buildGraph(actor, {
      sampleContexts: {
        alpha: { note: "alpha" },
        beta: { note: "beta" },
        gamma: { note: "gamma" },
      },
    });

    expect(graph.edges.filter((edge) => edge.label === "GO")).toEqual([
      {
        id: "idle-GO-active",
        source: "idle",
        target: "active",
        label: "GO",
        isActive: true,
        isUndetermined: false,
        contexts: ["alpha", "beta", "gamma"],
      },
    ]);
  });

  test("adds context names to undetermined edges too", () => {
    const idleState = state("idle")();
    const goEvent = event("GO")();

    const actor = Actor({
      inputs: [goEvent],
      outputs: [],
      internal: [],
      states: [idleState],
      initial: idleState,
      context: { threshold: 0 },
      setup: (machine) => {
        machine.on(idleState, {
          eventRef: goEvent,
          handler: (_sentEvent, { context }) => (context.get().threshold > 10 ? {} : {}),
        });
      },
    });

    const graph = buildGraph(actor, {
      sampleContexts: {
        large: { threshold: 100 },
        small: { threshold: 1 },
      },
    });

    expect(graph.edges.filter((edge) => edge.label === "GO")).toEqual([
      {
        id: "idle-GO-idle-undetermined-GO",
        source: "idle",
        target: "idle-undetermined-GO",
        label: "GO",
        isActive: true,
        isUndetermined: true,
        contexts: ["large", "small"],
      },
    ]);
  });
});
