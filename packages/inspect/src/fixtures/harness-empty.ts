/** An event with an empty payload type: nothing to fill. */
import { Actor, event, machine, state } from "@mantaq/core";

const idle = state("idle")();
const ping = event("ping")<{}>();

export const empty = machine("empty", {
  create: ({ clock }) => {
    return Actor({
      inputs: [ping],
      states: [idle],
      initial: idle,
      clock,
      setup: (m) => {
        m.on(idle, { event: ping, handler: () => ({}) });
      },
    });
  },
});
