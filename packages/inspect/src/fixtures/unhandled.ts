import { Actor, VirtualClock, event, state } from "@mantaq/core";

/** Waiting for work. */
const idle = state("idle")();
/** The work is finished. */
const finished = state("finished")().final();
/** Work was started. */
const start = event("start")();
/** Work was called off. */
const callOff = event("callOff")();

export function createUnhandledActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    clock,
    inputs: [start, callOff],
    states: [idle, finished],
    initial: idle,
    setup: (m) => {
      m.on(idle, { event: start, to: [finished], handler: () => ({ state: finished }) });
    },
  });
}
