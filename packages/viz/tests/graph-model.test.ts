/**
 * graph-model features: normalization of traversal output into the
 * render-ready VizGraph — kinds, undetermined self-loop normalization,
 * effect badges, region groups, payload attribution.
 */

import { describe, expect, it } from "vite-plus/test";
import { Actor, state, event } from "@mantaq/core";
import {
  basicInfo,
  createCheckoutActor,
  submitBasicInfo,
  submitPayment,
  submitShipping,
  submitting,
} from "../browser/fixtures/checkout.ts";
import { createTrafficLightActor, tick } from "../browser/fixtures/traffic-light.ts";
import { createSelfLoopActor, createSingleActor, loop } from "../browser/fixtures/edge-cases.ts";
import { buildVizGraph } from "../src/index.ts";
import { INITIAL_NODE_ID } from "@mantaq/traversal";

function expectOk<T extends { status: string }>(result: T): Extract<T, { status: "ok" }> {
  expect(result.status).toBe("ok");
  return result as Extract<T, { status: "ok" }>;
}

describe("buildVizGraph — checkout", () => {
  it("produces all seven nodes with correct kinds", () => {
    const { actor } = createCheckoutActor();
    const result = expectOk(buildVizGraph(actor));
    const ids = result.graph.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(
      [
        "__initial__",
        "basicInfo",
        "error",
        "payment",
        "shippingAddress",
        "submitting",
        "success",
      ].sort(),
    );
    // matches browser/fixtures/fingerprints.json (drift guard)
    expect(result.graph.nodes).toHaveLength(7);
    expect(result.graph.edges).toHaveLength(14);

    const initial = result.graph.nodes.find((n) => n.id === INITIAL_NODE_ID)!;
    expect(initial.kind).toBe("initial");
    expect(initial.isInitial).toBe(true);
    expect(initial.isActive).toBe(false);

    const states = result.graph.nodes.filter((n) => n.kind === "state");
    expect(states.length).toBe(6);
    expect(states.every((n) => n.isFinal === (n.id === "success"))).toBe(true);
  });

  it("marks only the live path as active", () => {
    const { actor } = createCheckoutActor();
    actor.send(submitBasicInfo.create({ email: "a@b.c", name: "Ada" }));
    const result = expectOk(buildVizGraph(actor));
    const active = result.graph.nodes.filter((n) => n.isActive).map((n) => n.id);
    expect(active).toEqual(["shippingAddress"]);
  });

  it("normalizes undetermined edges to self-loops but preserves the kind", () => {
    const { actor } = createCheckoutActor();
    const result = expectOk(buildVizGraph(actor));
    // `back` from basicInfo: onAny handler returns {} → guard-reject.
    const undetermined = result.graph.edges.filter((e) => e.kind === "undetermined");
    expect(undetermined.length).toBeGreaterThan(0);
    for (const edge of undetermined) {
      expect(edge.source).toBe(edge.target);
      expect(edge.isInternal).toBe(false);
    }
    const backFromBasic = undetermined.find((e) => e.source === "basicInfo");
    expect(backFromBasic?.label).toBe("back");
  });

  it("keeps a genuine self-loop distinct from an undetermined edge", () => {
    const { actor } = createSelfLoopActor();
    const result = expectOk(buildVizGraph(actor));
    const transition = result.graph.edges.find((e) => e.label === loop.type)!;
    expect(transition.kind).toBe("transition");
    expect(transition.source).toBe("wait");
    expect(transition.target).toBe("wait");
  });

  it("turns effects into node badges, not rendered edges", () => {
    const { actor } = createCheckoutActor();
    // walk into `submitting` so its effect edge is active
    actor.send(submitBasicInfo.create({ email: "a@b.c", name: "Ada" }));
    actor.send(submitShipping.create({ street: "1", city: "C", zip: "12345" }));
    actor.send(submitPayment.create({ cardNumber: "4242" }));
    const result = expectOk(buildVizGraph(actor));
    const submittingNode = result.graph.nodes.find((n) => n.id === submitting.name)!;
    // one effect function on `submitting` (both charge + timeout inside it)
    expect(submittingNode.effects).toEqual([{ label: "effect:submitting", count: 1 }]);

    const effectEdges = result.graph.edges.filter((e) => e.kind === "effect");
    expect(effectEdges).toHaveLength(1);
    const edge = effectEdges[0];
    expect(edge.id).toBe("submitting-effect:submitting-submitting");
    expect(edge.source).toBe("submitting");
    expect(edge.target).toBe("submitting");
    expect(edge.label).toBe("effect:submitting");
    expect(edge.isInternal).toBe(true);
    expect(edge.isActive).toBe(true);
  });

  it("marks the initial edge as initial kind", () => {
    const { actor } = createCheckoutActor();
    const result = expectOk(buildVizGraph(actor));
    const initialEdge = result.graph.edges.find((e) => e.source === INITIAL_NODE_ID)!;
    expect(initialEdge.kind).toBe("initial");
    expect(initialEdge.target).toBe("basicInfo");
  });

  it("carries regions as groups with dot-path ids", () => {
    const { actor } = createTrafficLightActor();
    const result = expectOk(buildVizGraph(actor));
    expect(result.graph.groups).toEqual([{ id: "", label: "", parentPath: "" }]);
  });

  it("attaches the live snapshot payload to the active node", () => {
    // payload only exists when a transition carries one (snapshot.payload)
    const go = state("go")();
    const stop = state("stop")();
    const poke = event("poke")();
    const actor = new Actor({
      inputs: [poke],
      states: [go, stop],
      initial: go,
      context: {},
      setup: (m) => m.on(go, poke, () => ({ state: stop, payload: { why: "red" } })),
    });
    actor.send(poke.create());
    const result = expectOk(buildVizGraph(actor));
    const stopNode = result.graph.nodes.find((n) => n.id === "stop")!;
    expect(stopNode.isActive).toBe(true);
    expect(stopNode.payload).toEqual({ why: "red" });
    expect(result.graph.nodes.find((n) => n.id === "go")?.payload).toBeUndefined();
  });

  it("annotates emit actions on edges", () => {
    const { actor } = createCheckoutActor();
    const result = expectOk(buildVizGraph(actor));
    const edge = result.graph.edges.find(
      (e) => e.source === basicInfo.name && e.label === "submitBasicInfo",
    );
    // submitBasicInfo handler only returns { state }, no emit.
    expect(edge?.action).toBeUndefined();
  });
});

describe("buildVizGraph — cyclic traffic light", () => {
  it("builds the cycle (dagre handles cycles internally, no infinite loop)", () => {
    const { actor } = createTrafficLightActor();
    const result = expectOk(buildVizGraph(actor));
    expect(result.graph.nodes.map((n) => n.id).sort()).toEqual(
      ["__initial__", "green", "red", "yellow"].sort(),
    );
    // red→green, green→yellow, yellow→red + initial edge
    expect(result.graph.edges.length).toBe(4);
    const cycle = result.graph.edges
      .filter((e) => e.kind === "transition")
      .map((e) => `${e.source}->${e.target}`)
      .sort();
    expect(cycle).toEqual(["green->yellow", "red->green", "yellow->red"]);
  });

  it("advancing the cycle moves the active flag", () => {
    const { actor } = createTrafficLightActor();
    actor.send(tick);
    actor.send(tick);
    const result = expectOk(buildVizGraph(actor));
    expect(result.graph.nodes.find((n) => n.id === "yellow")?.isActive).toBe(true);
  });
});

describe("buildVizGraph — degenerate actors", () => {
  it("single state, no transitions", () => {
    const { actor } = createSingleActor();
    const result = expectOk(buildVizGraph(actor));
    expect(result.graph.nodes.map((n) => n.id).sort()).toEqual(["__initial__", "idle"]);
    expect(result.graph.edges.length).toBe(1);
  });

  it("self-loop edge round-trips", () => {
    const { actor } = createSelfLoopActor();
    const result = expectOk(buildVizGraph(actor));
    expect(result.graph.edges.length).toBe(2); // initial + genuine self-loop
  });
});
