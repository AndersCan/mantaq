import { Actor, VirtualClock, event, state } from "@mantaq/core";

const first = state("first")();
const second = state("second")();
const third = state("third")();
const back = event("back")();

/** Anti-pattern on purpose: `onAny` picks its target from the current state. */
export function createStateRoutingActor(clock: VirtualClock = VirtualClock()) {
  const actor = Actor({
    clock,
    inputs: [back],
    states: [first, second, third],
    initial: first,
    setup: (m) => {
      m.onAny({
        event: back,
        to: [first, second],
        handler: () => {
          if (actor.state.name === "third") return { state: second };
          if (actor.state.name === "second") return { state: first };
          return {};
        },
      });
    },
  });
  return actor;
}
