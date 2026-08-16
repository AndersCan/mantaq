/**
 * PINNED FIXTURES — small synthetic cases.
 * FIXTURE_VERSION: 1
 *
 * - `done`: `working → done` — the actor completes on the first send. Graph
 *   must render normally (not as an error) with the final-state ring on
 *   `done`. (The `Actor` constructor rejects a final `initial`, so "completes
 *   at mount" is a one-send pre-script.)
 * - `final-heavy`: one non-final initial + every other state final, no
 *   transitions — only the initial edge is drawn.
 * - `long-labels`: 120+ char ids and unicode — label ellipsis/wrap stress.
 * - `rich-context`: every JS value type (fn, symbol, bigint, Date, Map,
 *   Set, array, nested, circular, undefined) — drives ContextInspector
 *   (Phase 3); the graph shot pins the baseline.
 */

import { Actor, VirtualClock, state, event } from "@mantaq/core";

export const finish = event("finish")();

export function createDoneActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();
  const working = state("working")();
  const done = state("done")().final();
  const actor = new Actor({
    inputs: [finish],
    states: [working, done],
    initial: working,
    clock: c,
    context: { result: "complete" },
    setup: (m) => {
      m.on(working, finish, () => ({ state: done }));
    },
  });
  return { actor, clock: c };
}

export function createAllFinalActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();
  const red = state("red")();
  const green = state("green")().final();
  const blue = state("blue")().final();
  const actor = new Actor({
    inputs: [],
    states: [red, green, blue],
    initial: red,
    clock: c,
    context: {},
    setup: () => {},
  });
  return { actor, clock: c };
}

export function createLongLabelsActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();
  const go = event("go")();
  const a = state(
    "state-with-an-exceptionally-long-name-that-would-overflow-any-reasonable-node-width",
  )();
  const b = state("λ-names-and-unicode-信号-and-long-tail")();
  const cState = state("short")();
  const actor = new Actor({
    inputs: [go],
    states: [a, b, cState],
    initial: a,
    clock: c,
    context: {},
    setup: (m) => {
      m.on(a, go, () => ({ state: b }));
      m.on(b, go, () => ({ state: cState }));
      m.on(cState, go, () => ({ state: a }));
    },
  });
  return { actor, clock: c };
}

export function createRichContextActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();
  const go = event("go")();
  const ready = state("ready")();
  const work = state("work")();
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const actor = new Actor({
    inputs: [go],
    states: [ready, work],
    initial: ready,
    clock: c,
    context: {
      title: "checkout",
      count: 42n,
      ratio: 1.5,
      when: new Date("2026-01-01T00:00:00.000Z"),
      tags: new Set(["a", "b"]),
      index: new Map([["k", 1]]),
      fn: () => "hi",
      sym: Symbol("s"),
      nested: { deep: { deeper: { value: [1, 2, { three: 3 }] } } },
      circ: circular,
      missing: undefined,
    },
    setup: (m) => {
      m.on(ready, go, () => ({ state: work }));
      m.on(work, go, () => ({ state: ready }));
    },
  });
  return { actor, clock: c };
}
