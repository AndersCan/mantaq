import { Actor, event, machine, state } from "@mantaq/core";

/** Waiting for work. */
const idle = state("idle")();
/** The work is finished. */
const finished = state("finished")().final();
/** Work was started. */
const start = event("start")();
/** Work was called off. */
const callOff = event("callOff")();

export const unhandled = machine("unhandled", {
  create: ({ clock }) => {
    return Actor({
      clock,
      inputs: [start, callOff],
      states: [idle, finished],
      initial: idle,
      setup: (m) => {
        m.on(idle, { event: start, to: [finished], handler: () => ({ state: finished }) });
      },
    });
  },
});
