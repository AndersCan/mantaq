/**
 * PINNED FIXTURES — synthetic edge cases (plan §9.2).
 * FIXTURE_VERSION: 1
 *
 * Each asserts a real render, never a blank canvas:
 * - `single`: one state, no transitions.
 * - `self-loop`: one state, one genuine `{state: same}` self-loop — stays
 *   distinguishable from a guard-reject (`{}` → undetermined).
 * - `__error`: a throwing context getter — `buildGraph` rethrows handler
 *   errors, so the graph area renders the error card.
 * - `empty` (harness-level): no `createEmptyActor` — the `Actor` constructor
 *   rejects `initial ∉ states`, so zero-state actors cannot exist. The empty
 *   fixture passes `actor: undefined` to the harness → `missing-actor` →
 *   empty-state render with `data-node-count="0"`.
 */

import { Actor, VirtualClock, state, event } from "@mantaq/core";

export const idle = state("idle")();
export const wait = state("wait")();
export const loop = event("loop")();

export function createSingleActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();
  const actor = new Actor({
    inputs: [],
    states: [idle],
    initial: idle,
    clock: c,
    context: {},
    setup: () => {},
  });
  return { actor, clock: c };
}

export function createSelfLoopActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();
  const actor = new Actor({
    inputs: [loop],
    states: [wait],
    initial: wait,
    clock: c,
    context: {},
    setup: (m) => {
      m.on(wait, loop, () => ({ state: wait }));
    },
  });
  return { actor, clock: c };
}

export function createThrowingContextActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();
  const actor = new Actor({
    inputs: [],
    states: [idle],
    initial: idle,
    clock: c,
    context: {
      get boom(): never {
        throw new Error("boom: context getter threw");
      },
    },
    setup: () => {},
  });
  return { actor, clock: c };
}
