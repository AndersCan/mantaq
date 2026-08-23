import { expect, test, describe } from "vite-plus/test";
import { Actor, event, state } from "@mantaq/core";
import { buildGraph, History } from "@mantaq/traversal";
import {
  assertAllStatesVisited,
  assertAllTransitionsVisited,
  assertStateVisited,
  assertStateNeverVisited,
  assertTransitionVisited,
  assertTransitionNeverVisited,
  assertContextNever,
  assertEffectRan,
  assertEffectNeverRan,
} from "../src/assertions.ts";

function makeActor() {
  const go = event("GO")();
  const stop = event("STOP")();
  const a = state("a")();
  const b = state("b")();

  return new Actor({
    inputs: [go, stop],
    outputs: [],
    internal: [],
    context: {},
    states: [a, b],
    initial: a,
    setup: (m) => {
      m.on(a, go, () => ({ state: b }));
      m.on(b, stop, () => ({ state: a }));
    },
  });
}

function makeActorWithContext() {
  const go = event("GO")();
  const a = state("a")();
  const b = state("b")();

  return new Actor({
    inputs: [go],
    outputs: [],
    internal: [],
    context: { count: 0 },
    states: [a, b],
    initial: a,
    setup: (m) => {
      m.on(a, go, (_event, { context }) => {
        const s = context.get();
        context.set({ ...s, count: s.count + 1 });
        return { state: b };
      });
    },
  });
}

function historyWith(...entries: Array<{ type: string; data: Record<string, unknown> }>): History {
  const h = new History();
  for (const e of entries) {
    h.append(e as Parameters<typeof h.append>[0]);
  }
  return h;
}

describe("assertions", () => {
  describe("assertAllStatesVisited", () => {
    test("passes when all visited", () => {
      const actor = makeActor();
      const graph = buildGraph(actor);
      const history = historyWith(
        { type: "state_visit", data: { stateName: "a" } },
        { type: "state_visit", data: { stateName: "b" } },
      );
      expect(() => assertAllStatesVisited(graph, history)).not.toThrow();
    });

    test("throws when some missing", () => {
      const actor = makeActor();
      const graph = buildGraph(actor);
      const history = historyWith({ type: "state_visit", data: { stateName: "a" } });
      expect(() => assertAllStatesVisited(graph, history)).toThrow(/not visited/);
    });
  });

  describe("assertAllTransitionsVisited", () => {
    test("passes when all visited", () => {
      const actor = makeActor();
      const graph = buildGraph(actor);
      const history = historyWith(
        { type: "transition", data: { from: "a", event: "GO", to: "b" } },
        { type: "transition", data: { from: "b", event: "STOP", to: "a" } },
      );
      expect(() => assertAllTransitionsVisited(graph, history)).not.toThrow();
    });

    test("throws when some missing", () => {
      const actor = makeActor();
      const graph = buildGraph(actor);
      const history = historyWith({
        type: "transition",
        data: { from: "a", event: "GO", to: "b" },
      });
      expect(() => assertAllTransitionsVisited(graph, history)).toThrow(/not visited/);
    });
  });

  describe("assertStateVisited", () => {
    test("passes when visited", () => {
      const history = historyWith({ type: "state_visit", data: { stateName: "a" } });
      expect(() => assertStateVisited(history, "a")).not.toThrow();
    });

    test("throws when not visited", () => {
      const history = historyWith({ type: "state_visit", data: { stateName: "a" } });
      expect(() => assertStateVisited(history, "b")).toThrow(/not visited/);
    });
  });

  describe("assertStateNeverVisited", () => {
    test("passes when not visited", () => {
      const history = historyWith({ type: "state_visit", data: { stateName: "a" } });
      expect(() => assertStateNeverVisited(history, "b")).not.toThrow();
    });

    test("throws when visited", () => {
      const history = historyWith({ type: "state_visit", data: { stateName: "a" } });
      expect(() => assertStateNeverVisited(history, "a")).toThrow(/was visited/);
    });
  });

  describe("assertTransitionVisited", () => {
    test("passes when visited", () => {
      const history = historyWith({
        type: "transition",
        data: { from: "a", event: "GO", to: "b" },
      });
      expect(() => assertTransitionVisited(history, "a", "GO")).not.toThrow();
    });

    test("throws when not visited", () => {
      const history = historyWith({
        type: "transition",
        data: { from: "a", event: "GO", to: "b" },
      });
      expect(() => assertTransitionVisited(history, "a", "STOP")).toThrow(/not visited/);
    });
  });

  describe("assertTransitionNeverVisited", () => {
    test("passes when not visited", () => {
      const history = historyWith({
        type: "transition",
        data: { from: "a", event: "GO", to: "b" },
      });
      expect(() => assertTransitionNeverVisited(history, "a", "STOP")).not.toThrow();
    });

    test("throws when visited", () => {
      const history = historyWith({
        type: "transition",
        data: { from: "a", event: "GO", to: "b" },
      });
      expect(() => assertTransitionNeverVisited(history, "a", "GO")).toThrow(/was visited/);
    });
  });

  describe("assertContextNever", () => {
    test("passes when predicate does not match", () => {
      const actor = makeActorWithContext();
      expect(() =>
        assertContextNever(actor, (context) => (context as { count: number }).count > 10),
      ).not.toThrow();
    });

    test("throws when predicate matches", () => {
      const actor = makeActorWithContext();
      expect(() =>
        assertContextNever(actor, (context) => (context as { count: number }).count === 0),
      ).toThrow(/predicate matched/);
    });
  });

  describe("assertEffectRan", () => {
    test("passes when effect ran", () => {
      const history = historyWith({ type: "effect", data: { stateName: "a" } });
      expect(() => assertEffectRan(history, "a")).not.toThrow();
    });

    test("throws when effect did not run", () => {
      const history = historyWith({ type: "effect", data: { stateName: "a" } });
      expect(() => assertEffectRan(history, "b")).toThrow(/did not run/);
    });
  });

  describe("assertEffectNeverRan", () => {
    test("passes when effect did not run", () => {
      const history = historyWith({ type: "effect", data: { stateName: "a" } });
      expect(() => assertEffectNeverRan(history, "b")).not.toThrow();
    });

    test("throws when effect ran", () => {
      const history = historyWith({ type: "effect", data: { stateName: "a" } });
      expect(() => assertEffectNeverRan(history, "a")).toThrow(/ran/);
    });
  });
});
