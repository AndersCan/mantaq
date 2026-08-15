/**
 * PINNED FIXTURE — traffic-light (cyclic).
 *
 * Source: synthetic (plan §9.2) — cyclic graph for layout/timeline stress.
 * FIXTURE_VERSION: 1
 *
 * red → green → yellow → red. Fully cyclic: dagre must handle the cycle
 * internally (greedy acyclicer) without looping.
 */

import { Actor, VirtualClock, state, event } from "@mantaq/core";

const red = state("red")();
const green = state("green")();
const yellow = state("yellow")();

export const tick = event("tick")();

export function createTrafficLightActor(clock?: VirtualClock) {
  const c = clock ?? new VirtualClock();
  const actor = new Actor({
    inputs: [tick],
    states: [red, green, yellow],
    initial: red,
    clock: c,
    context: {},
    setup: (m) => {
      m.on(red, tick, () => ({ state: green }));
      m.on(green, tick, () => ({ state: yellow }));
      m.on(yellow, tick, () => ({ state: red }));
    },
  });
  return { actor, clock: c };
}
