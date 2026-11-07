/** A machine with one vague state, one vague event and one state without a comment. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

/** Waiting for the visitor. */
const ready = state("ready")();
const showingCart = state("showingCart")().final();

/** The visitor finished. */
const DONE = event("DONE")();

export function createVagueNamesActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [DONE],
    states: [ready, showingCart],
    initial: ready,
    clock,
    setup: (m) => {
      m.on(ready, { event: DONE, to: [showingCart], handler: () => ({ state: showingCart }) });
    },
  });
}
