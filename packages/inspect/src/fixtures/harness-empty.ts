/** An event with an empty payload type: nothing to fill. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const idle = state("idle")();
const ping = event("ping")<{}>();

export function createEmptyActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [ping],
    states: [idle],
    initial: idle,
    clock,
    setup: (m) => {
      m.on(idle, { event: ping, handler: () => ({}) });
    },
  });
}
