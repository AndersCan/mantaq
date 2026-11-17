import { Actor, event, state } from "@mantaq/core";

const idle = state("idle")();
const done = state("done")();
const go = event("go")();

/** Right library: the same shape as left. */
export function rightActor() {
  return Actor({
    inputs: [go],
    states: [idle, done],
    initial: idle,
    setup: (m) => {
      /** Right goes. */
      m.on(idle, { event: go, to: [done], handler: () => ({ state: done }) });
    },
  });
}
