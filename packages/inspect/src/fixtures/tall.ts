/** A hub with twenty exits, so its graph is taller than a window; has a sibling preview file. */
import { Actor, VirtualClock, event, state } from "@mantaq/core";

const hub = state("hub")();
const leaves = Array.from({ length: 20 }, (_, i) => state(`leaf${i}`)());
const goes = Array.from({ length: 20 }, (_, i) => event(`go${i}`)());

export function createTallActor(clock: VirtualClock = VirtualClock()) {
  return Actor({
    inputs: goes,
    states: [hub, ...leaves],
    initial: hub,
    clock,
    setup: (m) => {
      leaves.forEach((leaf, i) => {
        m.on(hub, { event: goes[i]!, to: [leaf], handler: () => ({ state: leaf }) });
      });
    },
  });
}
