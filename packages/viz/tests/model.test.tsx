/**
 * model tests — store + useActorModel rebuild-vs-applyLive semantics
 * (plan §6.4) and structural fingerprint.
 *
 * - Context-only change (same active path): graph objects keep identity,
 *   only the snapshot advances.
 * - Path change: rebuild, new graph identity, layout memoized on fingerprint.
 */

// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vite-plus/test";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Actor, VirtualClock, event, state } from "@mantaq/core";
import type { AnyActor } from "@mantaq/core";
import { buildVizGraph } from "../src/core/index.ts";
import { createThrowingContextActor } from "../browser/fixtures/edge-cases.ts";
import { createVizStore, useVizStore, VizProvider } from "../src/model/viz-provider.tsx";
import type { VizStore } from "../src/model/viz-provider.tsx";
import { graphFingerprint, useActorModel } from "../src/model/use-actor-model.ts";

const toggle = event("toggle")<{ delta: number }>();
const done = event("done")();

function createContextActor(clock = new VirtualClock()) {
  const on = state("on")();
  const off = state("off")();
  const actor = new Actor({
    inputs: [toggle, done],
    states: [on, off],
    initial: on,
    clock,
    context: { count: 0 },
    setup: (m) => {
      m.on(on, toggle, (e, opts) => {
        const cur = opts.context.get();
        cur.count += e.payload.delta;
        opts.context.set(cur);
        return {}; // stay on `on` — context-only change
      });
      m.on(on, done, () => ({ state: off }));
    },
  });
  return { actor, on, off, clock };
}

// Captures the store created by VizProvider so tests can drive events.
let storeRef: VizStore | undefined;
function CaptureStore(): ReactNode {
  storeRef = useVizStore();
  return null;
}

function wrapperFor(actor: AnyActor): (props: { children: ReactNode }) => ReactNode {
  return ({ children }) => (
    <VizProvider actor={actor}>
      <CaptureStore />
      {children}
    </VizProvider>
  );
}

describe("createVizStore", () => {
  it("subscribes, snapshots and forwards send/advance/pendingTimers", () => {
    const { actor, clock } = createContextActor();
    const store = createVizStore(actor);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.getSnapshot().path).toEqual(["on"]);
    act(() => {
      store.send(toggle.create({ delta: 2 }));
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().context).toEqual({ count: 2 });
    expect(store.actor()).toBe(actor);

    act(() => {
      store.advance(100);
    });
    expect(Array.isArray(clock.pendingTimers())).toBe(true);
    store.dispose();
  });

  it("skips the seeded (seed, seed) change replay", () => {
    const { actor } = createContextActor();
    const store = createVizStore(actor);
    const listener = vi.fn();
    store.subscribe(listener);
    // Subscribing triggers Subscribers' seeded replay on the store's internal
    // listener — the store must not surface it as a change.
    expect(listener).not.toHaveBeenCalled();
    store.dispose();
  });

  it("stops notifying after dispose", () => {
    const { actor } = createContextActor();
    const store = createVizStore(actor);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispose();
    act(() => {
      store.send(toggle.create({ delta: 1 }));
    });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("useActorModel — rebuild vs applyLive", () => {
  it("keeps graph identity on context-only change, rebuilds on path change", () => {
    const { actor } = createContextActor();
    const { result } = renderHook(() => useActorModel(), { wrapper: wrapperFor(actor) });

    const first = result.current;
    expect(first.error).toBeUndefined();
    // on + off + initial node
    expect(first.graph.nodes).toHaveLength(3);
    expect(first.layout.positions.has("on")).toBe(true);
    const firstGraph = first.graph;
    const firstSnapshot = first.snapshot;
    const firstFingerprint = first.fingerprint;

    // Context-only change: same path → applyLive keeps graph identity.
    act(() => {
      storeRef!.send(toggle.create({ delta: 3 }));
    });
    expect(result.current.snapshot).not.toBe(firstSnapshot);
    expect(result.current.snapshot.context).toEqual({ count: 3 });
    expect(result.current.graph).toBe(firstGraph);
    expect(result.current.fingerprint).toBe(firstFingerprint);

    // Path change: rebuild — new graph identity, snapshot advanced.
    act(() => {
      storeRef!.send(done.create());
    });
    expect(result.current.graph).not.toBe(firstGraph);
    expect(result.current.snapshot.path).toEqual(["off"]);
    expect(result.current.error).toBeUndefined();
  });

  it("exposes a graph error when a context getter throws during build", () => {
    const { actor } = createThrowingContextActor();
    const { result } = renderHook(() => useActorModel(), { wrapper: wrapperFor(actor) });
    expect(result.current.error?.kind).toBe("graph");
    expect(result.current.error?.reason).toBe("handler-threw");
  });
});

describe("graphFingerprint", () => {
  it("is stable for identical graphs and distinct for different ones", () => {
    const { actor } = createContextActor();
    const a = buildVizGraph(actor);
    const b = buildVizGraph(actor);
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status === "ok" && b.status === "ok") {
      expect(graphFingerprint(a.graph)).toBe(graphFingerprint(b.graph));
      const flipped = {
        ...a.graph,
        edges: a.graph.edges.map((e) => ({ ...e, source: e.target, target: e.source })),
      };
      expect(graphFingerprint(flipped)).not.toBe(graphFingerprint(a.graph));
    }
  });
});
