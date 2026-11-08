/** An event with an empty payload type, handled only in a state fuzzing never reaches: declared, nothing to fill, never sent. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const idle = state("idle")();
const limbo = state("limbo")();
const ping = event("ping")<{}>();

export function createEmptyActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [ping],
    states: [idle, limbo],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(limbo, { event: ping, handler: () => ({}) });
    },
  });
}
