import { Actor, VirtualClock, event, state } from "@mantaq/core";

/** Listening, but nothing is wired up. */
const idle = state("idle")();
/** Busy with a poke. */
const busy = state("busy")();

/** Something nudged the machine. */
const poke = event("poke")();

export function createDeafActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    clock,
    inputs: [poke],
    states: [idle, busy],
    initial: idle,
    setup: (m) => {
      m.on(busy, { event: poke, to: [idle], handler: () => ({ state: idle }) });
    },
  });
}
