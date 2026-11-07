import { Actor, VirtualClock, event, state } from "@mantaq/core";

/** Waiting for a tap. */
const idle = state("idle")();

/** Something tapped the machine. */
const tap = event("tap")();

export function createStayActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    clock,
    inputs: [tap],
    states: [idle],
    initial: idle,
    setup: (m) => {
      m.on(idle, { event: tap, to: [idle], handler: () => ({ state: idle }) });
    },
  });
}
