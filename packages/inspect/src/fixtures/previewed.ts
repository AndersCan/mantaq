/** A door that opens and closes; has a sibling preview file. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

/** Shut. */
const closed = state("closed")();
/** Ajar. */
const open = state("open")();
/** Someone pushed it. */
const toggle = event("toggle")();

export function createDoorActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: [toggle],
    states: [closed, open],
    initial: closed,
    clock,
    setup: (m) => {
      m.on(closed, { event: toggle, to: [open], handler: () => ({ state: open }) });
      m.on(open, { event: toggle, to: [closed], handler: () => ({ state: closed }) });
    },
  });
}
