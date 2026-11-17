import { Actor, event, machine, state } from "@mantaq/core";

/** Listening, but nothing is wired up. */
const idle = state("idle")();
/** Busy with a poke. */
const busy = state("busy")();

/** Something nudged the machine. */
const poke = event("poke")();

export const deaf = machine("deaf", {
  create: ({ clock }) => {
    return Actor({
      clock,
      inputs: [poke],
      states: [idle, busy],
      initial: idle,
      setup: (m) => {
        m.on(busy, { event: poke, to: [idle], handler: () => ({ state: idle }) });
      },
    });
  },
});
